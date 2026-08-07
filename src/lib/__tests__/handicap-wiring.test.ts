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

  it("does not compound a 9-hole index with a 9-hole rating", () => {
    // A player holding a 9-hole index of 7 has an 18-hole index of 14.
    // Playing nine holes, the rating is halved and the index is not — halving
    // both would give them roughly a quarter of the strokes they are due.
    const src = read("src/lib/services/handicaps.ts");
    expect(src).toMatch(/handicapType === "9" && holes !== 9 \? p\.handicap \* 2 : p\.handicap/);
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
    expect(service).toMatch(/const handicapById = courseHcp;/);
    expect(service).not.toMatch(/new Map\(players\.map\(\(p\) => \[p\.id, p\.handicap\]\)\)/);
  });

  it("builds team side handicaps from Course Handicaps", () => {
    // A foursomes pair off the blues is owed different strokes to the same
    // pair off the reds.
    expect(teams).toMatch(/courseHandicapMap\(allMembers, teeRatings, defaultTeeId, holes\)/);
    expect(teams).toMatch(/courseHcp\.get\(m\.playerId\) \?\? m\.player\.handicap/);
  });

  it("allocates net match play off Course Handicaps", () => {
    const save = actions.slice(actions.indexOf("saveMatchScorecard"));
    expect(save).toMatch(/netHcp\.get\(playerA\.id\)/);
    expect(save).toMatch(/netHcp\.get\(playerB\.id\)/);
    expect(save).not.toMatch(/netMode \? playerA\?\.handicap/);
  });

  it("falls back to the raw index everywhere, so unrated courses are unchanged", () => {
    // Every fallback is `?? p.handicap`. That is what makes this migration
    // invisible until a club actually enters a rating.
    expect(service).toMatch(/courseHcp\.get\(p\.id\) \?\? p\.handicap/);
    expect(teams).toMatch(/\?\? m\.player\.handicap/);
    expect(actions).toMatch(/\?\? playerA\.handicap/);
  });
});
