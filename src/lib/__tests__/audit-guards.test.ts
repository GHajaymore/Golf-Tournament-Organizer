import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard checks that read the source rather than the behaviour.
 *
 * These exist because the failures they catch are invisible at runtime in the
 * happy path: an action with no guard works perfectly for the person who is
 * allowed to call it. Each one below corresponds to a real defect found in an
 * audit, so they are regression tests, not style rules.
 */

const ACTIONS_DIR = join(process.cwd(), "src", "app", "actions");
const read = (f: string) => readFileSync(join(ACTIONS_DIR, f), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Every exported action in a file, with its body, comments removed. */
function actions(file: string): { name: string; body: string }[] {
  const src = stripComments(read(file));
  const out: { name: string; body: string }[] = [];
  const re = /export async function (\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const start = m.index;
    const next = src.indexOf("\nexport ", start + 1);
    out.push({ name: m[1], body: src.slice(start, next === -1 ? undefined : next) });
  }
  return out;
}

describe("every server action is guarded", () => {
  // Auth actions are reachable before sign-in by definition; play actions have
  // their own code-based auth, checked separately below.
  const UNAUTHENTICATED_BY_DESIGN: Record<string, string[]> = {
    "auth.ts": [
      "signInWithPassword",
      "claimPassword",
      "requestPasswordReset",
      "resetPassword",
      "signUp",
      "signOutAction",
      // The "Viewing as" toggle. Sets a cookie on the caller and nothing else,
      // and the value is whitelisted to assistant/player — anything else
      // clears it — so it can only ever *reduce* what its own caller sees.
      //
      // This used to be justified by "no write guard reads viewRole". That
      // stopped being true (S8 of the 2026-08-12 audit: four now do), so the
      // exemption rests on the real invariant instead — viewRole can never be
      // MORE privileged than role — which is asserted directly in
      // "the preview toggle can only ever reduce" below rather than asserted
      // here in a comment. A guard whose safety argument lives only in prose
      // is a guard nobody re-checks.
      "setPreviewAction",
    ],
    "play.ts": ["redeemRoundCode", "claimPlayerSlot", "leavePlay"],
    // Open (self-service) registration is public by design: a stranger on a
    // shared link, no account. Its own defences replace a session guard, and
    // they are asserted separately below — token-shape check, a rate limit on
    // both the token and the email before any lookup, and a server-side
    // re-check of the capacity/deadline/open state.
    "register.ts": ["registerForEvent"],
  };

  const GUARDS = [
    "getSession",
    "requireEvent",
    "requireAdminEvent",
    "requireStaffEvent",
    "requireScoreEntry",
    "requireOrganizerOrg",
    "requireRosterOrg",
    "requireOrganizer",
    "requireStaff",
    "currentOrganization",
    // series.ts: getSession, admin-only, then resolves the owning club so every
    // query is scoped to it. Verified before being listed — adding a name here
    // without checking would defeat the point of the test.
    "requireOrg",
    "getPlaySession",
    "effectiveAccess",
  ];

  const files = readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".ts"));

  it("finds the action files", () => {
    // A broken directory read would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    it(`${file} — no action reaches the database unguarded`, () => {
      const exempt = UNAUTHENTICATED_BY_DESIGN[file] ?? [];
      for (const { name, body } of actions(file)) {
        if (exempt.includes(name)) continue;
        const guarded = GUARDS.some((g) => body.includes(g));
        expect(guarded, `${file}:${name} has no recognizable auth guard`).toBe(true);
      }
    });
  }
});

describe("round code guessing", () => {
  const play = stripComments(read("play.ts"));

  it("rate limits every action that looks a code up", () => {
    // claimPlayerSlot performed the identical accessCode lookup with no limit,
    // so an attacker could enumerate codes through it and redeemRoundCode's
    // limit counted for nothing.
    for (const { name, body } of actions("play.ts")) {
      if (!body.includes("accessCode")) continue;
      expect(body, `${name} looks up a code without rate limiting`).toMatch(/checkRateLimit\(/);
    }
  });

  it("shares one budget across both entry points", () => {
    // Separate keys would give an attacker two budgets per code.
    const kinds = [...play.matchAll(/checkRateLimit\("([^"]+)"/g)].map((m) => m[1]);
    expect(kinds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(kinds).size).toBe(1);
  });

  it("counts the attempts somewhere shared, not in process memory", () => {
    // The limiter was a Map in the instance's memory, which on serverless
    // hosting means each cold start handed the attacker a fresh budget — so
    // the limit that /play's entire security rests on was mostly theatre.
    const store = readFileSync(join(process.cwd(), "src", "lib", "rate-limit.ts"), "utf8");
    expect(store).toMatch(/RateLimitHit/);
    expect(stripComments(store), "counters must not live in a module-level Map").not.toMatch(
      /new Map\(/,
    );
  });

  it("never confirms that a code was real", () => {
    // "Pick your name from the list" on a failed claim told an attacker the
    // code existed, which is the whole thing being guessed.
    expect(play).not.toMatch(/Pick your name from the list/);
  });
});

describe("team score entry authorization", () => {
  const body = actions("tournament.ts").find((a) => a.name === "saveTeamScorecard")!.body;

  it("exists and is gated on the tournament's entry rules", () => {
    expect(body).toBeTruthy();
    expect(body).toMatch(/requireScoreEntry\(\)/);
  });

  it("checks the caller is on the side", () => {
    expect(body).toMatch(/You're not on this team/);
  });

  it("stops a player entering a partner's card", () => {
    expect(body).toMatch(/only enter your own card/);
  });

  it("rejects a card whose shape disagrees with the format", () => {
    // A per-player card stored for a scramble would be read back under
    // single-ball rules — a wrong score rather than an error.
    expect(body).toMatch(/one ball per side/);
    expect(body).toMatch(/needs a card for each partner/);
  });

  it("scopes the team and the match to this tournament", () => {
    expect(body).toMatch(/team\.eventId !== eventId/);
    expect(body).toMatch(/m\.eventId !== eventId/);
  });
});

describe("team match generation", () => {
  const src = () =>
    readFileSync(join(ACTIONS_DIR, "teams.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

  it("exists — the team columns were dead until it did", () => {
    // Match gained teamAId/teamBId, the entry screen read them and
    // recomputeTeamMatch scored them, but nothing ever wrote them. Team match
    // play silently degraded to team stroke play.
    expect(src()).toMatch(/export async function generateTeamMatches/);
  });

  it("pairs sides rather than players", () => {
    const body = src().slice(src().indexOf("generateTeamMatches"));
    expect(body).toMatch(/teamAId: pairing\.aId/);
    expect(body).toMatch(/teamBId: pairing\.bId/);
    // The player columns stay empty rather than being repurposed.
    expect(body).toMatch(/playerAId: ""/);
  });

  it("refuses on an individual format", () => {
    expect(src()).toMatch(/is played by individuals/);
  });

  it("will not silently discard scored matches", () => {
    const body = src().slice(src().indexOf("generateTeamMatches"));
    expect(body).toMatch(/needsConfirm: true/);
    expect(body).toMatch(/Scores have already been recorded/);
  });
});

describe("the flight generator leaves team rounds alone", () => {
  it("skips a team round instead of pairing its players", () => {
    // Player-vs-player matches in a four-ball round are matches nobody plays,
    // and they would count toward the standings.
    const regroup = readFileSync(
      join(process.cwd(), "src", "lib", "services", "regroup.ts"),
      "utf8",
    ).replace(/\/\/.*$/gm, "");
    expect(regroup).toMatch(/if \(needsTeams\(rrStage\.format\)\) continue;/);
  });
});

describe("roster CSV import", () => {
  const roster = stripComments(read("roster.ts"));
  const body = roster.slice(roster.indexOf("export async function importCsvMembers"));

  it("is organizer-or-assistant only, like the rest of the roster", () => {
    expect(body).toMatch(/requireRosterOrg\(\)/);
  });

  it("scopes every lookup and write to the caller's club", () => {
    // Without this, uploading a file could read or overwrite another club's
    // roster by matching on an email that exists there.
    expect(body).toMatch(/where:\s*\{\s*organizationId\s*\}/);
    expect(body).toMatch(/organizationId\s*\}\s*\}\)/);
  });

  it("does not require an email, unlike the entry-list importer", () => {
    // A club roster is a record of members and plenty have no email on file.
    // Requiring one would mean the roster could never match the membership
    // list it was copied from.
    expect(body).toMatch(/if \(email && !EMAIL_RE\.test\(email\)\)/);
  });

  it("never blanks a stored field from an absent column", () => {
    // The destructive failure: a handicaps-only sheet uploaded after a full
    // export would otherwise erase every phone number and GHIN on the roster.
    expect(body).toMatch(/Object\.entries\(data\)\.filter/);
    // The handicap condition used to be `rawHandicap.trim() !== ""`, which
    // asked whether the CELL had anything in it. It now asks whether that
    // something was a handicap — strictly stronger, because "n/a" and "12.4
    // (est)" are not blank and are not numbers either, and the old reading
    // wrote a 0 over a stored index for both. See D4 and parseHandicapInput.
    expect(body).toMatch(/hcp\.ok && hcp\.source === "manual"/);
    expect(body).toMatch(/handicapText\.trim\(\) !== ""/);
  });

  it("keeps its in-file index current so one file can't duplicate a person", () => {
    expect(body).toMatch(/byEmail\.set\(/);
    expect(body).toMatch(/byName\.set\(/);
  });

  it("shares one parser with the entry-list importer", () => {
    // Two parsers drift: a club whose spreadsheet says "Hcp Index" would be
    // understood by one screen and rejected by the other.
    expect(roster).toMatch(/from "@\/lib\/csv"/);
    expect(stripComments(read("tournament.ts"))).toMatch(/from "@\/lib\/csv"/);
    // And no second copy of the splitter survives in either file.
    expect(roster).not.toMatch(/function splitCsvLine/);
    expect(stripComments(read("tournament.ts"))).not.toMatch(/function splitCsvLine/);
  });
});

describe("the styleguide never ships", () => {
  const page = readFileSync(
    join(process.cwd(), "src", "app", "styleguide", "page.tsx"),
    "utf8",
  );

  it("returns a 404 in production", () => {
    // It is an unauthenticated page whose whole job is to enumerate the
    // interface. Useful in development, and nobody's business in production.
    expect(page).toMatch(/if \(process\.env\.NODE_ENV === "production"\) notFound\(\);/);
    expect(page).toMatch(/from "next\/navigation"/);
  });

  it("is not linked from anywhere in the app", () => {
    // A dev-only route reachable from the sidebar would be a dead link for
    // every real user.
    const nav = readFileSync(join(process.cwd(), "src", "lib", "nav.ts"), "utf8");
    expect(nav).not.toMatch(/styleguide/);
  });
});

describe("moving a player between flights", () => {
  const body = actions("tournament.ts").find((a) => a.name === "movePlayerToGroup")!.body;

  it("exists — manual formation had no way to actually move anyone", () => {
    expect(body).toBeTruthy();
  });

  it("is staff-only and refuses once setup is locked", () => {
    expect(body).toMatch(/requireStaffEvent\(\)/);
    expect(body).toMatch(/assertUnlocked\(eventId\)/);
  });

  it("scopes BOTH ids to the caller's tournament", () => {
    // Either one unscoped lets an organizer of any event move a stranger's
    // player into a stranger's flight by posting two ids.
    expect(body).toMatch(/prisma\.player\.findFirst\(\{ where: \{ id: playerId, eventId \}/);
    expect(body).toMatch(/prisma\.group\.findFirst\(\{ where: \{ id: groupId, eventId \}/);
  });

  it("will not silently move someone after matches are scored", () => {
    expect(body).toMatch(/scoredMatchCount\(eventId\)/);
    expect(body).toMatch(/needsConfirm: true/);
  });
});

describe("flight naming and sign-off", () => {
  const rename = actions("tournament.ts").find((a) => a.name === "renameGroup")!.body;
  const confirm = actions("tournament.ts").find((a) => a.name === "setFlightsConfirmed")!.body;

  it("renaming is staff-only, scoped, and bounded", () => {
    expect(rename).toMatch(/requireStaffEvent\(\)/);
    expect(rename).toMatch(/where: \{ id: groupId, eventId \}/);
    // Unbounded, a name is a free text field on a public endpoint.
    expect(rename).toMatch(/\.slice\(0, 40\)/);
  });

  it("sign-off is staff-only and refuses on a computed rule", () => {
    // The other rules regenerate from a policy, so "confirmed" would be a
    // promise the next regenerate breaks.
    expect(confirm).toMatch(/requireStaffEvent\(\)/);
    expect(confirm).toMatch(/formationRule !== "manual"/);
  });

  it("flight formation uses the same handicap the round is scored on", () => {
    // It built its players from the raw stored handicap while scoring used a
    // Course Handicap — so a handicap-balanced draw was balanced on indexes,
    // and over nine holes on doubled ones.
    const regroup = stripComments(
      readFileSync(join(process.cwd(), "src", "lib", "services", "regroup.ts"), "utf8"),
    );
    expect(regroup).toMatch(/courseHandicapMap\(/);
    expect(regroup).toMatch(/handicap: courseHcp\.get\(p\.id\) \?\? p\.handicap/);
    expect(regroup).toMatch(/\?\.holes === 9 \? 9 : 18/);
  });
});

describe("registration close / extend", () => {
  const body = actions("tournament.ts").find((a) => a.name === "setRegistrationOverride")!.body;

  it("is staff-only, and deliberately NOT lock-gated", () => {
    // This asserted assertUnlocked until D2 of the 2026-08-12 audit showed
    // what that cost: the lock throws for status live|completed, so an
    // organizer whose tournament had started could not close registration at
    // all — the single control that stops public entries was unreachable from
    // the moment it started mattering, and the only way round it was unlocking
    // the whole configuration of a live event.
    //
    // The lock protects the SHAPE of a tournament — field, draw, schedule.
    // This changes none of that; it decides whether the door is open. The
    // matching rule that a finished tournament refuses entries whatever this
    // says lives in registrationStatus, where both public paths read it.
    expect(body).toMatch(/requireStaffEvent\(\)/);
    expect(body).not.toMatch(/assertUnlocked/);
  });

  it("never blocks an organizer adding a late entry", () => {
    // Closing registration is a statement about what members may do. The
    // organizer adding a late entry by hand is how a closed event still takes
    // one, and it is their job.
    const add = actions("tournament.ts").find((a) => a.name === "addSignup")!.body;
    expect(add).not.toMatch(/registrationOverride/);
    expect(add).not.toMatch(/registrationStatus/);
  });

  it("the screen derives status from the deadline rather than capacity alone", () => {
    // The bug: a tournament whose deadline passed still read "Open · unlimited".
    const client = readFileSync(
      join(process.cwd(), "src", "components", "RegistrationClient.tsx"),
      "utf8",
    );
    expect(client).toMatch(/registrationStatus\(\{/);
    expect(client).toMatch(/deadline: event\.regDeadline/);
    expect(client).not.toMatch(/const status = unlimited \? "Open · unlimited"/);
  });
});

describe("the event switcher never lists another club's tournaments", () => {
  it("scopes the query to the user's accessible events", () => {
    // This was an unscoped findMany: every signed-in user of any organization
    // saw every club's event names, dates, venues and field sizes, and the
    // switcher offered rows the actions then refused. The access list is the
    // single source of what appears, exactly as it is for what switches.
    const src = readFileSync(join(process.cwd(), "src/app/(app)/event/page.tsx"), "utf8");
    expect(src).toMatch(/prisma\.event\.findMany\(\{\s*\n\s*where: \{ id: \{ in: \[\.\.\.accessible\.keys\(\)\] \} \}/);
  });
});

describe("a four-ball partner may score their own match", () => {
  it("checks team membership when the sides are teams", () => {
    // Match.playerAId/playerBId are empty in a team format — the sides live in
    // teamAId/teamBId. Checking only the player columns refused every partner
    // in a four-ball their own match, while the comment above the guard still
    // claimed "a match this player is actually in".
    const src = read("play.ts");
    const guard = src.slice(src.indexOf("savePlayMatchHoles"));
    expect(guard).toMatch(/teamMember\.findFirst/);
    expect(guard).toMatch(/teamId: \{ in: teamIds \}/);
    // And the refusal still exists for genuine outsiders.
    expect(guard).toMatch(/You can only enter scores for your own match/);
  });
});

describe("a player writes their own scores and nobody else's", () => {
  const src = read("tournament.ts");

  it("every score write a player can reach checks whose score it is", () => {
    // requireScoreEntry answers "may this role enter scores at all" and never
    // asked "for whom" — any signed-in player could overwrite any match or
    // card in the event. The round-code path had this check from day one; the
    // console path did not.
    for (const fn of ["saveMatchHoles", "applyMatchResult", "clearMatch", "saveMatchScorecard", "saveTeamScorecard"]) {
      const body = src.slice(src.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 400), fn).toMatch(/assertOwnMatch\(session, eventId, matchId\)/);
    }
    const card = src.slice(src.indexOf("export async function saveScorecard"));
    // Window widened past 300 when the two event-scope assertions landed above
    // this one — whose-card-is-it now runs after which-tournament-is-it.
    expect(card.slice(0, 900)).toMatch(/assertOwnCard\(session, eventId, playerId\)/);
  });

  it("links the session to its Player rows by registration email", () => {
    expect(src).toMatch(/email: \{ equals: email, mode: "insensitive" \}/);
  });

  it("recognises team membership as being in the match", () => {
    const guard = src.slice(src.indexOf("async function assertOwnMatch"));
    expect(guard.slice(0, 900)).toMatch(/teamMember\.findFirst/);
  });

  it("scopes the entry screen with the same rule it enforces", () => {
    const page = readFileSync(join(process.cwd(), "src/app/(app)/entry/page.tsx"), "utf8");
    expect(page).toMatch(/\.filter\(mine\)/);
    expect(page).toMatch(/ownIds\.has\(p\.id\)/);
  });
});

describe("the console refuses impossible match margins", () => {
  it("validates N&M in applyMatchResult the same way the importer does", () => {
    // "2&3" — up two with three to play — is not a closed-out match. The
    // importer has refused these since it existed; the console path took them
    // silently and reconstructed a card the standings read as in progress
    // forever.
    const src = read("tournament.ts");
    const body = src.slice(src.indexOf("export async function applyMatchResult"));
    expect(body.slice(0, 1200)).toMatch(/lead <= toPlay/);
    expect(body.slice(0, 1200)).toMatch(/Did you mean/);
    expect(body.slice(0, 1200)).toMatch(/lead > total/);
  });
});

describe("league attendance answers are scoped like scores", () => {
  const src = readFileSync(join(process.cwd(), "src/app/actions/attendance.ts"), "utf8");

  it("a player answers for themself, by registration email", () => {
    expect(src).toMatch(/own\.has\(playerId\)/);
    expect(src).toMatch(/email: \{ equals: email, mode: "insensitive" \}/);
    expect(src).toMatch(/You can only answer for yourself/);
  });

  it("the opt deadline binds players and never staff", () => {
    const fn = src.slice(src.indexOf("export async function setAttendance"));
    expect(fn).toMatch(/if \(!isStaff\) \{[\s\S]*?playerMayChange\(stage\.optDeadline\)/);
  });

  it("captains and vices must be members of the flight they lead", () => {
    expect(src).toMatch(/eventId: session\.eventId, groupId/);
    expect(src).toMatch(/has to be a member of the flight/);
  });

  it("every write is scoped to the session's event", () => {
    expect(src).toMatch(/where: \{ id: stageId, eventId: session\.eventId \}/);
    expect(src).toMatch(/where: \{ id: groupId, eventId: session\.eventId \}/);
  });
});

describe("the round-code result path carries every guard the hole path has", () => {
  const src = readFileSync(join(process.cwd(), "src/app/actions/play.ts"), "utf8");
  const fn = src.slice(src.indexOf("export async function savePlayMatchResult"));

  it("requires a play session scoped to the match's round", () => {
    expect(fn).toMatch(/getPlaySession/);
    expect(fn).toMatch(/match\.stageId !== session\.stageId/);
  });

  it("requires membership, teams included", () => {
    expect(fn).toMatch(/teamMember\.findFirst/);
    expect(fn).toMatch(/You can only enter scores for your own match/);
  });

  it("refuses impossible margins with the transposition suggested", () => {
    expect(fn).toMatch(/lead <= toPlay/);
    expect(fn).toMatch(/did you mean/i);
  });

  it("reconstructs holes so a phoned-in result equals a tapped one", () => {
    expect(fn).toMatch(/marginToHoles\(winner, margin, total\)/);
  });
});

describe("a round code obeys the tournament's score-entry setting", () => {
  const play = stripComments(read("play.ts"));

  it("gates both write actions on canEnterScores, as every other path does", () => {
    // Neither one asked. A tournament set to `scoreEntryBy: "staff"` that
    // hands out round codes purely for sign-in believed the committee held
    // the cards, while any code holder could write a full result — and since
    // a score edit resets approval, un-confirm a card the committee had
    // already signed off, leaving no sign on any screen that it happened.
    for (const fn of ["savePlayMatchHoles", "savePlayMatchResult"]) {
      const body = actions("play.ts").find((a) => a.name === fn)!.body;
      expect(body, fn).toMatch(/canEnterScores\(/);
      expect(body, fn).toMatch(/entered by the organizer/);
    }
  });

  it("asks as a player, because a code is never a staff credential", () => {
    // A play session carries no role: the holder typed a code that was read
    // out to the field. Passing anything staff-shaped here would pass every
    // check by definition.
    expect(play.match(/canEnterScores\(\s*settings(Of\(event\))?,\s*"player"\)/g)?.length).toBe(2);
  });

  it("refuses by returning, not by throwing", () => {
    // These actions are called straight from the client component, which
    // renders res.error. A thrown error reaches the player as an unhandled
    // server-action failure with no wording of its own.
    for (const fn of ["savePlayMatchHoles", "savePlayMatchResult"]) {
      const body = actions("play.ts").find((a) => a.name === fn)!.body;
      expect(body, fn).not.toMatch(/throw new Error/);
    }
  });

  it("checks before it writes anything", () => {
    for (const fn of ["savePlayMatchHoles", "savePlayMatchResult"]) {
      const body = actions("play.ts").find((a) => a.name === fn)!.body;
      const gate = body.indexOf("canEnterScores(");
      expect(gate, fn).toBeGreaterThan(-1);
      for (const write of ["match.update", "auditLog.create"]) {
        expect(body.indexOf(write), `${fn} / ${write}`).toBeGreaterThan(gate);
      }
    }
  });

  it("still honours the entry window on the hole-by-hole path", () => {
    // `scoreEntryWindow: "after"` means the organizer does not want partial
    // cards on the leaderboard as a group plays. Only this path can produce
    // one — a phoned-in result is a finished round by definition.
    const holes = actions("play.ts").find((a) => a.name === "savePlayMatchHoles")!.body;
    expect(holes).toMatch(/canPlayerSavePartial\(settings\)/);
    expect(holes).toMatch(/Enter the full round, then submit it/);
  });

  it("leaves signing in ungated, so the code still gets a player to their round", () => {
    // The gate belongs on the write. Refusing the code itself would break
    // every staff-scored tournament that uses codes for sign-in, which is
    // precisely the tournament this whole guard exists to protect.
    for (const fn of ["redeemRoundCode", "claimPlayerSlot", "leavePlay"]) {
      const body = actions("play.ts").find((a) => a.name === fn)!.body;
      expect(body, fn).not.toMatch(/canEnterScores\(/);
    }
  });
});

describe("the tee sheet is the organizer's to save and announce", () => {
  const src = readFileSync(join(process.cwd(), "src/app/actions/tee-sheet.ts"), "utf8");

  it("both actions require staff and scope to the session's event", () => {
    expect(src).toMatch(/requireStaffSession/);
    expect(src.match(/where: \{ id: stageId, eventId: session\.eventId \}/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it("stores only what the parser accepts, capped", () => {
    // Whatever arrived is arbitrary caller input, not the component's object.
    expect(src).toMatch(/parseTeeSheet\(JSON\.stringify/);
    expect(src).toMatch(/MAX_SHEET_BYTES/);
  });

  it("validates against the confirmed field before storing", () => {
    expect(src).toMatch(/validateTeeSheet\(clean, new Set/);
  });

  it("cannot publish a sheet that was never saved", () => {
    expect(src).toMatch(/Save a sheet before publishing/);
  });
});

describe("net imports are converted where the real handicap lives", () => {
  const src = read("tournament.ts");
  const fn = src.slice(src.indexOf("export async function importScores"));

  it("resolves the Playing Handicap server-side, not from the client", () => {
    // The authoritative number depends on the round's allowance, the player's
    // tees and the holes played — none of which the browser knows.
    expect(fn).toMatch(/courseHandicapMap\(players, teeRatings/);
    expect(fn).toMatch(/effectiveAllowance\(stage\.format, stage\.handicapAllowance\)/);
  });

  it("adds the shots back per hole off the stroke index", () => {
    expect(fn).toMatch(/v \+ holeStrokesReceived\(netHcp\.get/);
  });

  it("refuses rather than spreading shots evenly with no stroke index", () => {
    expect(fn).toMatch(/no stroke index, so net scores can't be converted/);
  });
});

describe("a card is written to the round and the player it names, not to an id", () => {
  const src = read("tournament.ts");

  it("saveScorecard proves both halves of its composite key", () => {
    // The upsert is keyed on (stageId, playerId). Neither id was checked
    // against the caller's tournament: assertOwnCard returns immediately for
    // staff and, for a player, only vouches for the playerId — so a staff
    // member of any event could post another club's stage and player and
    // overwrite that tournament's card outright. The `eventId` in the upsert's
    // `create` branch reads like scoping and is not; it decorates a new row
    // and constrains nothing about which row the upsert lands on.
    const fn = src.slice(src.indexOf("export async function saveScorecard"));
    expect(fn.slice(0, 900)).toMatch(/assertEventStage\(eventId, stageId\)/);
    expect(fn.slice(0, 900)).toMatch(/assertEventPlayer\(eventId, playerId\)/);
    expect(fn.slice(0, 900)).toMatch(/assertOwnCard\(session, eventId, playerId\)/);
  });

  it("both assertions narrow by eventId and refuse rather than fall through", () => {
    const stage = src.slice(src.indexOf("async function assertEventStage"));
    expect(stage.slice(0, 400)).toMatch(/stage\.findFirst\(\{ where: \{ id: stageId, eventId \}/);
    expect(stage.slice(0, 400)).toMatch(/throw new Error/);
    const player = src.slice(src.indexOf("async function assertEventPlayer"));
    expect(player.slice(0, 400)).toMatch(/player\.findFirst\(\{ where: \{ id: playerId, eventId \}/);
    expect(player.slice(0, 400)).toMatch(/throw new Error/);
  });
});

describe("an accepted result is only undone by someone entitled to undo it", () => {
  // Bodies bounded by the next export and stripped of comments, so a fixed
  // character window can't cut a long action in half and an assertion can
  // never be satisfied by prose describing the check.
  const bodies = actions("tournament.ts");
  const fn = (name: string) => bodies.find((a) => a.name === name)?.body ?? "";

  it("finds the actions it is about to assert on", () => {
    for (const name of ["saveScorecard", "disputeScorecard", "certifyScorecard", "clearMatch", "reopenScorecard"]) {
      expect(fn(name).length, `${name} not found — this whole block would pass vacuously`).toBeGreaterThan(200);
    }
  });

  it("every path that changes a stored card asks what state it is in", () => {
    // S2/S3 of the 2026-08-12 audit. certifyScorecard refused an approved card
    // from the day it was written; the two actions that change what the card
    // SAYS did not ask at all, so the same row was writable through a
    // neighbouring door. One shared predicate now, rather than three copies of
    // a condition that were never going to stay in step.
    for (const name of ["saveScorecard", "disputeScorecard", "certifyScorecard"]) {
      expect(fn(name), name).toMatch(/isCardLocked\(/);
      expect(fn(name), name).toMatch(/LOCKED_CARD_REFUSAL/);
    }
  });

  it("reads the card's state before it writes, not after", () => {
    // A check that runs after the upsert is a comment.
    const save = fn("saveScorecard");
    expect(save.indexOf("isCardLocked")).toBeLessThan(save.indexOf("scorecard.upsert"));
  });

  it("leaves exactly one way out of approved, and it is organizer-only", () => {
    // reopenScorecard is the documented route back. If it ever stops requiring
    // an organizer, the refusals above become a formality.
    expect(fn("reopenScorecard")).toMatch(/requireAdminEvent\(\)/);
  });

  it("clearMatch reads the EFFECTIVE status, not the stored column", () => {
    // S4, and the part a column check would have missed: under player approval
    // a result auto-confirms after 24 hours while scoreStatus still reads
    // "pending". A guard on the raw column would have been true and useless
    // for every auto-confirmed match in the field.
    const clear = fn("clearMatch");
    expect(clear).toMatch(/effectiveScoreStatus\(match, allowsAutoConfirm\(settings\)\)/);
    expect(clear).toMatch(/auto-confirmed/);
    expect(clear).toMatch(/reopen/i);
    // And the refusal comes before the blanking it prevents.
    expect(clear.indexOf("effectiveScoreStatus")).toBeLessThan(clear.indexOf("match.updateMany"));
  });

  it("records the two erasures that left no trace", () => {
    // Both were flagged "unaudited" in the audit for the same reason: every
    // match-play counterpart has written a row since it existed, and the
    // scorecard family wrote none. A result that vanishes with nothing naming
    // who removed it is one a committee cannot defend.
    expect(fn("clearMatch")).toMatch(/logAudit\(eventId, matchId, "match\.clear"/);
    expect(fn("disputeScorecard")).toMatch(/logAudit\(eventId, null, "card\.dispute"/);
  });
});

describe("naming a venue can only reach this club's own courses", () => {
  const src = readFileSync(join(process.cwd(), "src/app/actions/courses.ts"), "utf8");
  const fn = src.slice(src.indexOf("export async function nameMatchVenue"));

  it("checks the course id it was handed against the organization", () => {
    // Whoever may enter a score may call this, and the courseId arrives inside
    // an object — so it never appeared in the parameter list the structural
    // IDOR sweep reads, and went unchecked. Unscoped it did three things at
    // once with a stranger's course: scored the match against that club's par
    // and stroke index, added the course to this tournament's venues, and
    // created a Tee row on a course this organization does not own.
    expect(fn).toMatch(/course\.findFirst\(\{[\s\S]{0,200}organizationId: event\.organizationId/);
    expect(fn).toMatch(/isn't in this club's library/);
  });

  it("runs that check before the tee and venue writes it protects", () => {
    const check = fn.indexOf("organizationId: event.organizationId");
    expect(check).toBeGreaterThan(-1);
    for (const write of ["tee.create", "eventCourse.upsert", "match.update"]) {
      expect(fn.indexOf(write), write).toBeGreaterThan(check);
    }
  });

  it("still lets a genuinely new course be created for the match", () => {
    // The scope check must not turn "we played somewhere new" into an error —
    // that path passes no courseId at all and is the reason this action exists.
    expect(fn).toMatch(/if \(!courseId\) \{/);
    expect(fn).toMatch(/course\.create/);
  });
});

describe("open (self-service) registration defends its own endpoint", () => {
  const src = stripComments(read("register.ts"));
  const body = actions("register.ts").find((a) => a.name === "registerForEvent")!.body;

  it("rate limits on BOTH the token and the email, before any lookup", () => {
    // The token cap slows a script hammering one link; the email cap stops one
    // person submitting over and over. Either alone leaves a hole — and both
    // must run before the database is touched, so a refusal costs no query and
    // reveals nothing about whether the event exists.
    expect(body).toMatch(/checkRateLimit\("register-token", cleanToken\)/);
    expect(body).toMatch(/checkRateLimit\("register-email", person\.email\)/);
    // The event lookup comes after both checks.
    const tokenAt = body.indexOf('checkRateLimit("register-token"');
    const emailAt = body.indexOf('checkRateLimit("register-email"');
    const lookupAt = body.indexOf("event.findFirst");
    expect(tokenAt).toBeGreaterThan(-1);
    expect(emailAt).toBeGreaterThan(tokenAt);
    expect(lookupAt).toBeGreaterThan(emailAt);
  });

  it("re-checks capacity, the deadline and the open switch on the server", () => {
    // The browser's "spots left" is a hint, never the authority: capacity and
    // placement are decided here from a fresh confirmed count via the pure rule.
    expect(body).toMatch(/registrationOpen/);
    expect(body).toMatch(/player\.count\(\{\s*where: \{ eventId: event\.id, status: "confirmed" \}/);
    expect(body).toMatch(/decideIntake\(/);
  });

  it("gives the same neutral refusal for a bogus token and a closed link", () => {
    // No existence oracle — the action-side of the /live rule. Every "not live"
    // path returns the one NOT_OPEN message rather than saying which it was.
    expect(src).toMatch(/const NOT_OPEN =/);
    expect(body).toMatch(/!event \|\| !event\.registrationOpen/);
  });

  it("writes through the roster and grants sign-in, like the organizer add", () => {
    expect(body).toMatch(/upsertMember\(/);
    expect(body).toMatch(/syncPlayerAccount\(/);
  });

  it("de-duplicates by email so one person can't become two entries", () => {
    expect(body).toMatch(/already: true/);
  });

  it("never lets a failed confirmation email undo a real entry", () => {
    // The email is best-effort and comes last, after the row is written.
    const sendAt = body.indexOf("sendRegistrationEmail");
    const createAt = body.indexOf("player.create");
    expect(createAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(createAt);
  });
});

describe("the preview toggle can only ever reduce", () => {
  /**
   * S8 of the 2026-08-12 audit, closed at the argument rather than the symptom.
   *
   * `setPreviewAction` is exempt from the "every action is guarded" sweep
   * because it writes one cookie about its own caller. That exemption used to
   * be justified by "no write guard reads viewRole" — and four now do
   * (skins.ts, card-photo.ts, draft-message.ts, setup-suggest.ts). Reading
   * viewRole is not itself wrong: those guards become MORE restrictive while
   * an organizer previews, which is what preview is for.
   *
   * What matters is that viewRole can never be more privileged than role. That
   * is the whole safety argument, so it is asserted here instead of asserted
   * in a comment nobody re-checks.
   */
  const src = readFileSync(join(process.cwd(), "src", "lib", "auth.ts"), "utf8");

  it("only ever accepts a LOWER role than admin", () => {
    // The whitelist is the mechanism: anything not assistant/player clears the
    // cookie, and neither of those outranks admin.
    const fn = src.slice(src.indexOf("export async function setPreviewRole"));
    expect(fn.slice(0, 600)).toMatch(/previewRole === "assistant" \|\| previewRole === "player"/);
    expect(fn.slice(0, 600), "anything else must clear it, not store it").toMatch(/jar\.delete\(PREVIEW_COOKIE\)/);
    expect(fn.slice(0, 600)).not.toMatch(/"admin"/);
  });

  it("is only honoured for an admin in the first place", () => {
    // A player who forges the cookie gets nothing: the session applies it only
    // when the REAL role is admin, so viewRole <= role holds by construction.
    const session = src.slice(src.indexOf("export async function getSession"));
    expect(session).toMatch(/role === "admin" && \(preview === "assistant" \|\| preview === "player"\)/);
  });

  it("leaves the real role untouched, so no guard can be widened by it", () => {
    // Both are on the session; the actions that read viewRole can only ever
    // read something at or below role.
    expect(src).toMatch(/const role: Role = access\?\.role \?\? current\.role/);
    expect(src).toMatch(/viewRole: Role =/);
  });
});

describe("nothing builds a CSV by hand", () => {
  /**
   * D9 of the 2026-08-12 audit. The reports export escaped inline, in a client
   * component, with `/[",\n]/` — no `\r`, and nothing at all about formula
   * injection. A player name of `=HYPERLINK(...)`, which the unauthenticated
   * public registration form accepts, ran when the club opened the file.
   *
   * The fix is only durable if the next export reuses it, and the reason this
   * one did not is that the rule was never anywhere reusable. So the guard is
   * on the shape: cells go through `csvCell`/`toCsv` in
   * `domain/csv-export.ts`, which is tested, and not through a join written on
   * the spot.
   */
  const SRC = join(process.cwd(), "src");

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(p);
      return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
    });
  }

  it("uses the shared escaper everywhere a CSV is written", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file.endsWith(join("domain", "csv-export.ts"))) continue;
      const src = stripComments(readFileSync(file, "utf8"));
      // A CSV is being emitted here if it declares the MIME type or names a
      // .csv download.
      if (!/text\/csv|\.csv["'`]/.test(src)) continue;
      // Reading one is fine — score-import and the roster upload both parse.
      // Writing one without the escaper is not.
      const writes = /new Blob\(|download\s*=|Content-Disposition/.test(src);
      if (writes && !/csvCell|toCsv/.test(src)) offenders.push(file.slice(SRC.length + 1));
    }
    expect(offenders, "escape via domain/csv-export.ts, not inline").toEqual([]);
  });

  it("still has the escaper the guard points at", () => {
    // So the sweep above cannot pass by the file having been renamed away.
    const src = readFileSync(join(SRC, "lib", "domain", "csv-export.ts"), "utf8");
    expect(src).toMatch(/export function csvCell/);
    expect(src).toMatch(/export function toCsv/);
  });
});
