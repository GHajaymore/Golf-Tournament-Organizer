import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { teeRatingFor } from "../services/handicaps";
import { courseHandicap } from "../domain/handicap";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("nine-hole rounds don't halve twice", () => {
  it("halves the rating for a nine-hole round", () => {
    const nine = teeRatingFor({ courseRating: 71.4, slopeRating: 125, par: 72 }, 9);
    expect(nine!.courseRating).toBeCloseTo(35.7, 5);
    expect(nine!.par).toBe(36);
  });

  it("leaves an eighteen-hole round alone", () => {
    const full = teeRatingFor({ courseRating: 71.4, slopeRating: 125, par: 72 }, 18);
    expect(full!.courseRating).toBe(71.4);
    expect(full!.par).toBe(72);
  });

  it("converts the index through the shared four-case rule", () => {
    // One rule, one place. The old inline conversion handled only stored
    // 9-hole indexes and silently doubled ordinary 18-hole indexes in
    // nine-hole rounds — see nine-hole-index.test.ts for the behaviour.
    const src = read("src/lib/services/handicaps.ts");
    expect(src).toMatch(/indexForHoles\(p\.handicap, p\.handicapType, holes\)/);
    expect(src).toMatch(/indexForHoles\(player\.handicap, player\.handicapType, holes\)/);
    expect(src).not.toMatch(/handicapType === "9" && holes !== 9/);
  });

  it("returns null for an absent tee rather than inventing a rating", () => {
    expect(teeRatingFor(null, 18)).toBeNull();
  });
});

describe("tee validation guards the whole field's strokes", () => {
  const src = read("src/app/actions/courses.ts");

  it("bounds the slope to the published range", () => {
    expect(src).toMatch(/MIN_SLOPE.*MAX_SLOPE|slopeRating < MIN_SLOPE/);
  });

  it("refuses a course rating with no slope", () => {
    // The rating term alone is small and misleading; the slope term is the one
    // that actually scales for difficulty.
    expect(src).toMatch(/Course Rating without a Slope Rating/);
  });

  it("treats zero as unrated rather than as a slope of zero", () => {
    expect(src).toMatch(/input\.slopeRating !== 0/);
    expect(courseHandicap(14.2, { slopeRating: 0 })).toBe(14);
  });

  it("scopes every tee action to the organization that owns the course", () => {
    // Without this a tee id from another club's course would be editable.
    const tail = src.slice(src.indexOf("saveTee"));
    expect(tail).toMatch(/organizationId/);
    expect(tail).toMatch(/course: \{ organizationId \}/);
  });

  it("nulls a player's tee rather than deleting the player", () => {
    const migration = read("prisma/migrations/17_tees/migration.sql");
    expect(migration).toMatch(/Player_teeId_fkey[\s\S]*ON DELETE SET NULL/);
  });
});

describe("the app tells an organizer when net scoring is approximate", () => {
  const src = read("src/lib/services/handicaps.ts");

  it("says nothing for a gross round, which needs no handicap", () => {
    expect(src).toMatch(/if \(basis === "gross"\) return null;/);
  });

  it("names the unrated tees rather than warning vaguely", () => {
    expect(src).toMatch(/unrated\.map\(\(t\) => t\.name\)/);
  });

  it("explains the consequence in both directions", () => {
    expect(src).toMatch(/understates strokes on a hard course and overstates them on an easy one/);
  });
});

describe("every engine receives a Course Handicap, not an Index", () => {
  // The reason this reads source: the bug has no runtime symptom on an unrated
  // course, which is every course until a club enters its ratings. A missed
  // call site would look perfectly correct in every test that doesn't happen
  // to use a rated tee.
  const service = read("src/lib/services/tournament.ts");
  const teams = read("src/lib/services/teams.ts");
  const actions = read("src/app/actions/tournament.ts");

  it("resolves the field once, where players are loaded", () => {
    expect(service).toMatch(/courseHandicapMap\(confirmed, teeRatings, defaultTeeId/);
  });

  it("builds every domain player from the resolved map", () => {
    // toDomainPlayer without a course handicap falls back to the raw index, so
    // any bare call inside loadEventState is a missed conversion.
    const inside = service.slice(service.indexOf("export async function loadEventState"));
    const bare = inside.match(/toDomainPlayer\((?!.*hcpOf)[^)]*\)/g) ?? [];
    expect(bare, `bare toDomainPlayer calls: ${bare.join(", ")}`).toEqual([]);
  });

  it("feeds stroke standings the resolved map rather than raw handicaps", () => {
    // The pricing of a stroke card moved into strokeHandicapResolver so the
    // weekly league view could share it instead of growing a second copy.
    // Same property, one function further down: the fallback the resolver is
    // handed is the RESOLVED course-handicap map, never the raw indexes.
    expect(service).toMatch(/fallback:\s*courseHcp,/);
    expect(service).not.toMatch(/new Map\(players\.map\(\(p\) => \[p\.id, p\.handicap\]\)\)/);
  });

  it("builds team side handicaps from Course Handicaps", () => {
    // A foursomes pair off the blues is owed different strokes to the same
    // pair off the reds.
    // Allows the call to wrap, and REQUIRES the tee policy: a side handicap
    // built without it silently ignores a single-tee competition.
    expect(teams).toMatch(
      /courseHandicapMap\(\s*allMembers,\s*teeRatings,\s*defaultTeeId,\s*holes,\s*await teePolicyFor\(eventId\),/,
    );
    expect(teams).toMatch(/courseHcp\.get\(m\.playerId\) \?\? m\.player\.handicap/);
  });

  it("scores a team match off the same handicaps the Teams screen shows", () => {
    // These were two different numbers. `recomputeTeamMatch` priced the side
    // off `Player.handicap` — the roster INDEX — while `teamsForStage` showed
    // the same side converted for its tees, so a club that rated its tees was
    // shown one side handicap and scored by another. One conversion, read the
    // same way in both places, and the round's own numbers on top of it.
    const recompute = actions.slice(actions.indexOf("async function recomputeTeamMatch"));
    expect(recompute).toMatch(/courseHandicapMap\(/);
    expect(recompute).toMatch(/roundHandicapOf\(teamRound\.get\(p\.id\), teamHcp\.get\(p\.id\)/);
    expect(recompute).toMatch(/members\.map\(\(m\) => playsOff\(m\.player\)\)/);
    expect(recompute).toMatch(/courseHandicap: playsOff\(m\.player\)/);
    expect(recompute).not.toMatch(/courseHandicap: m\.player\.handicap/);
  });

  it("allocates net match play off the round's Course Handicap", () => {
    // The guarantee, not a spelling: the strokes handed to deriveNetHoles pass
    // through BOTH resolutions — the tee conversion, and what this round says
    // the player plays off. Either one missing is a wrong answer with no
    // symptom, since an unrated course and a round with no override both leave
    // the number untouched.
    const save = actions.slice(actions.indexOf("saveMatchScorecard"));
    expect(save).toMatch(/roundHandicapOf\(netRound\.get\(p\.id\), netHcp\.get\(p\.id\)/);
    expect(save).toMatch(/netMode \? netFor\(playerA\) : 0/);
    expect(save).toMatch(/netMode \? netFor\(playerB\) : 0/);
    expect(save).not.toMatch(/netMode \? playerA\?\.handicap/);
    // Behaviour, against a rated tee and a real override:
    // round-handicap.audit.test.ts, "a net match is priced off the round".
  });

  it("falls back to the raw index everywhere, so unrated courses are unchanged", () => {
    // Every fallback is `?? p.handicap`. That is what makes this migration
    // invisible until a club actually enters a rating.
    expect(service).toMatch(/courseHcp\.get\(p\.id\) \?\? p\.handicap/);
    expect(teams).toMatch(/\?\? m\.player\.handicap/);
    // Net match play resolves both players through one helper now, so the
    // fallback is written once — `p` is whichever of the two is being priced.
    expect(actions).toMatch(/netHcp\.get\(p\.id\) \?\? p\.handicap/);
  });
});

describe("individual standings play off the Playing Handicap", () => {
  it("applies the stage's allowance to each scorecard", () => {
    // The format table has carried 95% for an individual medal (WHS Appendix
    // C) since it was written, and the team engines honoured it; the
    // individual standings used the raw Course Handicap, so every medal ran
    // off 100% and nobody could see why the numbers differed from the sheet.
    const src = read("src/lib/services/tournament.ts");
    expect(src).toMatch(/effectiveAllowance\(stage\.format, stage\.handicapAllowance\)/);
    // The per-round Course Handicap still reaches playingHandicapFrom with the
    // round's allowance. Asserted on the two facts rather than on one exact
    // expression: the round-handicap override put `resolveRoundHandicap`
    // between them, and a test pinned to the wording failed while the
    // behaviour it names was untouched. What matters is that the number going
    // in is this round's Course Handicap and the allowance is applied to it.
    expect(src).toMatch(/const member = byRound\.get\(playerId\) \?\? ctx\.fallback\.get\(playerId\) \?\? 0;/);
    expect(src).toMatch(/playingHandicapFrom\(resolved\.handicap, allowance\)/);
  });

  it("leaves flight formation on the Course Handicap", () => {
    // Flights measure ability; the allowance is a competition condition. The
    // draw must not shrink because the medal plays at 95%.
    const src = read("src/lib/services/tournament.ts");
    expect(src).toMatch(/const domainPlayers = confirmed\.map\(\(p\) => toDomainPlayer\(p, hcpOf\(p\)\)\)/);
  });
});

describe("handicap conversion follows each round's own hole count", () => {
  it("resolves both conversions and picks per card", () => {
    // A tournament mixing an 18-hole round with a 9-hole one used a single
    // map keyed to whichever round came first, so the other round's cards
    // were converted on the wrong hole count.
    const src = read("src/lib/services/tournament.ts");
    // The tee policy is required in both, and must be the SAME one: which
    // tees a player is held to cannot depend on whether the round is nine
    // holes or eighteen.
    expect(src).toMatch(/courseHandicapMap\(confirmed, teeRatings, defaultTeeId, 18, teePolicy\)/);
    expect(src).toMatch(/courseHandicapMap\(confirmed, teeRatings, defaultTeeId, 9, teePolicy\)/);
    expect(src).toMatch(/stage\?\.holes === 9 \? ctx\.courseHcp9 : ctx\.courseHcp18/);
  });

  it("gives the weekly view the same resolver rather than its own", () => {
    // The whole reason the pricing was extracted. A league night and the
    // event totals reading a player's net score differently is the worst
    // possible bug here: both look right, and only the member notices.
    const week = read("src/lib/services/week-view.ts");
    expect(week).toMatch(/state\.strokeHandicapFor/);
    // Rebuilding any of these here means it has started pricing cards itself.
    expect(week).not.toMatch(/playingHandicapFrom|effectiveAllowance|courseHandicapMap/);
  });
});
