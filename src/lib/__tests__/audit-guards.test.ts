import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { drawBrackets } from "@/lib/domain";

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
    // messaging.ts: getSession, then builds the caller's membership from their
    // OWN session — event id and email off the session, never an argument —
    // and throws when either is missing. Every read is then filtered to the
    // scopes that membership derives (see domain/messaging.ts), which is a
    // stronger shape than a role check: there is no thread-id parameter that
    // authorises anything. Verified by reading it, per the note above.
    "requireMembership",
    "getPlaySession",
    "effectiveAccess",
    /**
     * skins.ts: the one guard here that is deliberately NOT staff-only.
     *
     * A fourball running its own $20 skins should not need the organizer, so
     * `requirePotAccess` splits the answer: an empty groupKey is the FIELD's
     * pot and stays organizer-or-assistant exactly as before, while a named
     * group is writable by the players in that group — and only them.
     *
     * Listed per the note above only because it was verified, and the
     * verification is itself a test rather than a reading: see "requirePotAccess
     * is a real check, not a reassuring name" in audit-idor.test.ts, which pins
     * that it proves the stage belongs to the caller's event, refuses the
     * field's pot to non-staff, takes membership from the published tee sheet
     * rather than from the caller, and resolves the caller from the session.
     * Neutering any of those fails that suite.
     */
    "requirePotAccess",
    /**
     * side-games.ts: `requirePotAccess` reached through the game's own row.
     *
     * A side game is identified by its id alone, so the stage and group key
     * that `requirePotAccess` needs have to be read from the row before it can
     * be asked. This wrapper does that, calls it, and then compares the row's
     * eventId to the one it returned — refusing a game in another tournament.
     *
     * Listed per the note above only because it was verified, and the
     * verification is a test rather than a reading: "no action trusts a row id
     * it was handed" in audit-idor.test.ts requires every id parameter to be
     * narrowed to the caller's scope, and this is the only thing narrowing
     * `sideGameId`. Neutering it fails that suite.
     */
    "requireGameAccess",
    /**
     * handicap-policy.ts: `getSession`, then `organizationAccess`, then a
     * `canEdit` check — the same three steps `saveOrganizationDefaults` in
     * settings.ts performs inline, lifted into a helper because both actions
     * in that file need them and a rule written twice is a rule that drifts.
     *
     * Listed per the note above only because it was verified by reading it:
     * it refuses an unsigned caller, refuses a session with no organization,
     * and refuses anybody who is not an owner or admin — so a guest organizer
     * running one society day cannot change how the whole club is handicapped,
     * or turn on posting scores to a national association.
     */
    "requireClub",
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
    /**
     * Bounded by the function, not by a character count.
     *
     * This window was widened from 300 to 900 once already, when two
     * event-scope assertions landed above the check, and it broke again the
     * day the signature grew a documented parameter. A guard that has to be
     * re-tuned every time the code above it moves is a guard that will one day
     * be re-tuned to zero.
     */
    const start = src.indexOf("export async function saveScorecard");
    const after = src.indexOf("\nexport ", start + 1);
    const card = stripComments(src.slice(start, after === -1 ? undefined : after));
    expect(card).toMatch(/assertOwnCard\(session, eventId, playerId\)/);
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
    // Allowed to wrap, and required to use the ROUND's tees rather than
    // whichever set sorts first — an import converted off the wrong tee bakes
    // the wrong gross into stored strokes, which is the one place an error
    // stops being recomputable.
    expect(fn).toMatch(/courseHandicapMap\(\s*players\.map\([^;]*?\),\s*teeRatings,\s*roundTeeId\(tees, event\?\.defaultTeeId\),/);
    // This path writes STORED strokes, so it converts off the flight's tees
    // too — an error here is the one kind that cannot be recomputed away.
    expect(fn).toMatch(/flightTeeId: importFlightTee\.get\(p\.id\)/);
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
    /**
     * Bounded by the next top-level export and stripped of comments, rather
     * than by a fixed character window.
     *
     * The window was 900 characters and broke the day the signature grew a
     * documented parameter — reporting three guards as missing when all three
     * were there, a few lines further down than they used to be. That is the
     * same failure audit-idor.test.ts records against itself: a guard that
     * flags correct code is the one somebody deletes.
     */
    const start = src.indexOf("export async function saveScorecard");
    const after = src.indexOf("\nexport ", start + 1);
    const fn = stripComments(src.slice(start, after === -1 ? undefined : after));
    expect(fn).toMatch(/assertEventStage\(eventId, stageId\)/);
    expect(fn).toMatch(/assertEventPlayer\(eventId, playerId\)/);
    expect(fn).toMatch(/assertOwnCard\(session, eventId, playerId\)/);
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

describe("every screen that shows results makes the same branch", () => {
  /**
   * D8 of the 2026-08-12 audit. The leaderboard had four branches ahead of its
   * `standingRows` call — manual, team, skins/nassau/modified Stableford —
   * Reports had none of them, and `/live` had one. So a team round exported
   * from Reports as the whole field at gross 0 through 0, and a *manual* round
   * printed a branded "Final standings snapshot" with an Advancing column for
   * a format the leaderboard explicitly refuses to score.
   *
   * The branch is now one function, `boardKind`. This guard is on the thing
   * that actually went wrong: three screens each deciding for themselves. Any
   * screen calling `standingRows` has to have asked.
   */
  const SCREENS = [
    join("app", "(app)", "leaderboard", "page.tsx"),
    join("app", "(app)", "reports", "page.tsx"),
    // The public board CACHES its read, so the branch travels with the
    // computation into the service rather than staying on the page — both
    // `standingRows` and `boardKind` moved together, which is the property
    // this guard is actually about. The page is pinned separately below to
    // stop it deciding for itself again.
    join("lib", "services", "live-board.ts"),
  ];

  for (const screen of SCREENS) {
    it(`${screen} branches on boardKind`, () => {
      const src = stripComments(readFileSync(join(process.cwd(), "src", screen), "utf8"));
      expect(src, "must not call standingRows without deciding which board applies").toMatch(
        /boardKind\(/,
      );
      // Every kind that is not the ordinary board has to be handled, or the
      // fallthrough silently ranks a format on the wrong reading again.
      for (const kind of ["manual", "team", "skins", "nassau", "modified-stableford"]) {
        expect(src, `${screen} ignores the "${kind}" board`).toContain(`"${kind}"`);
      }
    });
  }

  it("the public board delegates rather than deciding for itself", () => {
    // D8 was three screens each choosing their own reading. The live page now
    // has no reading of its own at all: it checks the share token and asks
    // `liveBoard` for everything else. Re-adding `standingRows` here would
    // recreate a fourth opinion, which is the shape that caused the audit.
    const page = stripComments(
      readFileSync(join(process.cwd(), "src", "app", "live", "[token]", "page.tsx"), "utf8"),
    );
    expect(page, "the live page must not rank the field itself").not.toMatch(/standingRows\(/);
    expect(page, "it should be asking the cached reader instead").toMatch(/liveBoard\(/);
  });

  it("no other screen ranks the field without asking", () => {
    const APP = join(process.cwd(), "src", "app");
    const offenders: string[] = [];
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) ? [p] : [];
      });

    for (const file of walk(APP)) {
      const src = stripComments(readFileSync(file, "utf8"));
      if (!/\bstandingRows\(/.test(src)) continue;
      if (!/boardKind\(|usesStandardBoard\(/.test(src)) offenders.push(file.slice(APP.length + 1));
    }
    expect(offenders, "call boardKind before ranking — see lib/formats.ts").toEqual([]);
  });
});

describe("which model each AI call uses", () => {
  /**
   * Not a correctness rule — a cost one, and the only reason it is a test is
   * that nothing else would notice it changing.
   *
   * Card reading is by far the highest-volume model call in the product: one
   * per scorecard rather than one per round or per tournament, so at any real
   * scale it dominates the AI bill. It is also the narrowest task — reading a
   * grid of two-digit numbers off a photograph is extraction, not judgement —
   * and the action never saves what it reads, so a misread costs a correction
   * rather than a wrong result. Haiku is the right model and is a third of
   * Sonnet's price per token on both sides.
   *
   * The prose calls stay on Sonnet deliberately: they are low-volume and their
   * output is read by a person as writing.
   */
  const MODEL_FOR: Record<string, string> = {
    "card-photo.ts": "claude-haiku-4-5",
    "commentary.ts": "claude-sonnet-5",
    "draft-message.ts": "claude-sonnet-5",
    "setup-suggest.ts": "claude-sonnet-5",
  };

  for (const [file, expected] of Object.entries(MODEL_FOR)) {
    it(`${file} calls ${expected}`, () => {
      const src = stripComments(read(file));
      const found = [...src.matchAll(/model:\s*"([^"]+)"/g)].map((m) => m[1]);
      // Distinct models, not calls. A file may hold more than one call —
      // card-photo.ts reads a single card and a whole group — and what
      // matters is that every one of them is on the model decided above.
      // Asserting the call COUNT would make adding a second reading look
      // like a cost regression when it is the opposite: one call for a
      // fourball in place of four.
      expect(found.length, `${file} should call a model at all`).toBeGreaterThan(0);
      expect([...new Set(found)], `${file} uses one model throughout`).toEqual([expected]);
    });
  }

  it("has no AI call this guard has not been told about", () => {
    // So a new model call cannot be added without a deliberate decision about
    // which model it should use and what that costs per invocation.
    const unlisted = readdirSync(ACTIONS_DIR)
      .filter((f) => f.endsWith(".ts") && !MODEL_FOR[f])
      .filter((f) => /api\.anthropic\.com/.test(stripComments(read(f))));
    expect(unlisted, "add it to MODEL_FOR with a note on why that model").toEqual([]);
  });
});

describe("a round freezes the handicaps it is scored against", () => {
  /**
   * CLAUDE.md rule 5: a guard you must remember to call is a guard that will be
   * forgotten. `freezeRoundHandicaps` is exactly that shape — every door that
   * stores a returned card has to call it, and a door that forgets loses
   * nothing visible on the day. It silently leaves that round's handicaps live,
   * so a roster edit weeks later re-scores a finished round: the defect the
   * whole feature exists to prevent, reappearing through one missed path.
   *
   * So the doors are enumerated from the SOURCE rather than by hand. A fifth
   * way to store a card fails this test the day it is written.
   */
  const bodies = actions("tournament.ts");
  const stores = bodies.filter((a) => /(scorecard|matchScorecard|teamScorecard)\.upsert\(/.test(a.body));

  it("finds the actions that store cards", () => {
    expect(stores.map((a) => a.name).sort()).toEqual([
      "importScores",
      "saveMatchScorecard",
      "saveScorecard",
      "saveTeamScorecard",
    ]);
  });

  for (const a of stores) {
    it(`${a.name} freezes the round after storing the card`, () => {
      expect(a.body, `${a.name} stores a card without freezing its round`).toMatch(/freezeRoundHandicaps\(/);
      // After the write, not before. Freezing first would freeze a round on a
      // card that then failed to store — and a card refused for being invalid
      // would still have stopped an organizer fixing a handicap.
      expect(a.body.search(/scorecard\.upsert\(/i)).toBeLessThan(a.body.indexOf("freezeRoundHandicaps("));
    });

    it(`${a.name} only freezes on a card that carries a score`, () => {
      // An empty card row is a field, not a round that has been played: a cut
      // writes one for every survivor. Freezing on the row would tell an
      // organizer that cards are in a fortnight before anyone tees off.
      expect(a.body, `${a.name} freezes without asking whether a score arrived`).toMatch(
        /isReturnedCard\(|if \(returned\)/,
      );
    });
  }
});

/**
 * A match always belongs to a real group.
 *
 * `Match.groupId` is NOT NULL and carries a foreign key to `Group`, and every
 * Group id is a cuid — so `groupId: ""` is not a placeholder, it is a row
 * Postgres will always reject. `createSingleMatch` and `createThirdPlaceMatch`
 * both wrote it, which made the Single Match Stage and the play-off for third
 * one hundred percent non-functional against any real database: an organizer
 * could add the round, configure it, press the button, and get nothing. The
 * suite was green throughout, because no test had ever invoked either action
 * and the components that call them are rendered with the actions mocked away.
 *
 * Read from the source rather than exercised, because that is what makes it
 * cover the NEXT `match.create` as well as these two.
 */
describe("no match is created without a group", () => {
  const sourceFiles = () => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "__tests__" || e.name === "node_modules") continue;
          walk(p);
        } else if (/\.tsx?$/.test(e.name)) {
          out.push(p);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    return out;
  };

  it("never writes an empty string into groupId", () => {
    const offenders = sourceFiles().filter((f) =>
      /groupId:\s*(""|'')/.test(stripComments(readFileSync(f, "utf8"))),
    );
    expect(offenders).toEqual([]);
  });

  it("both one-off match creators go through the shared group helper", () => {
    // Two call sites independently forgetting the same required field is the
    // reason this is a helper rather than two more inline group lookups.
    const all = actions("tournament.ts");
    for (const name of ["createSingleMatch", "createThirdPlaceMatch"]) {
      const body = all.find((a) => a.name === name)?.body;
      expect(body, `${name} not found`).toBeTruthy();
      expect(body).toMatch(/matchCarrierGroup\(/);
      expect(body).toMatch(/groupId,/);
    }
  });

  it("sizes the empty card to the round, not to eighteen", () => {
    // The entry screen falls back to `holes.length || 18`, so a zero-length
    // card silently offers eighteen holes on a nine-hole round.
    const all = actions("tournament.ts");
    for (const name of ["createSingleMatch", "createThirdPlaceMatch"]) {
      const body = all.find((a) => a.name === name)!.body;
      expect(body).toMatch(/stage\.holes === 9 \? 9 : 18/);
      expect(body).not.toMatch(/holes: "\[\]"/);
    }
  });
});

/**
 * A conflict never reaches the code that deletes the device copy.
 *
 * The queue had two outcomes where the world has three. `send` could resolve
 * (taken) or throw (retry), so a conflict — the server answered and refused —
 * resolved, and everything after the await ran: `localStorage.removeItem`,
 * `setQueued(false)`, status "Saved". The scorer's holes then existed only in
 * React state, nothing would ever retry them, and the screen said it was safe
 * to walk away. Locking the phone lost them.
 *
 * `SendOutcome` makes the third case representable and the compiler makes it
 * unavoidable — a `send` that falls off the end no longer type-checks. What a
 * type cannot enforce is the ORDER: that the held branch returns BEFORE the
 * clear. Asserted here, because there is no hook-testing harness in this repo
 * and this is the line whose reordering costs a round.
 */
describe("the pending-card queue never clears a card it did not send", () => {
  const hook = () =>
    stripComments(
      readFileSync(join(process.cwd(), "src", "components", "usePendingCard.ts"), "utf8"),
    );

  it("returns on a held outcome before touching localStorage", () => {
    const src = hook();
    const held = src.indexOf('outcome === "held"');
    const clear = src.indexOf("localStorage.removeItem");
    expect(held, "the held branch must exist").toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(-1);
    expect(held, "the held branch must come before the clear").toBeLessThan(clear);
    // And it must actually leave, not merely set a flag and fall through.
    expect(src.slice(held, clear)).toMatch(/return;/);
  });

  it("asks send for an outcome rather than ignoring what it returned", () => {
    expect(hook()).toMatch(/const outcome = await send\(/);
    expect(hook()).not.toMatch(/^\s*await send\(value\.current\);\s*$/m);
  });

  it("stops retrying while a conflict is waiting on a person", () => {
    // Replaying it just conflicts again, and would overwrite their change the
    // moment it stopped disagreeing.
    expect(hook()).toMatch(/held,/);
    const domain = stripComments(
      readFileSync(join(process.cwd(), "src", "lib", "domain", "pending-card.ts"), "utf8"),
    );
    expect(domain.slice(domain.indexOf("export function shouldRetry"))).toMatch(
      /if \(s\.held\) return false;/,
    );
  });

  it("shows the player a card recovered from a previous visit", () => {
    // `recovered` was read from localStorage on mount and then rendered by
    // nobody, so the tab-eviction case the module exists for still lost holes.
    const card = readFileSync(join(process.cwd(), "src", "components", "PlayerCard.tsx"), "utf8");
    expect(card).toMatch(/recoveredDiffers/);
    expect(card).toMatch(/mine=\{recoveredFitted\}/);
  });

  /**
   * ...and tells them it is a RECOVERY, not somebody else's edit.
   *
   * The assertion above pins that the chooser is rendered, and that was all it
   * pinned — so the recovery case went on rendering the CONFLICT's words:
   * "Somebody else — usually the committee — edited this card while your phone
   * was offline", when nobody had, above a footnote reading "If you are not
   * sure, use theirs". In this case "theirs" runs `settle()`, which drops the
   * localStorage key holding the only copy of those holes.
   *
   * The two situations put the destructive button in different places, so the
   * component has to know which one it is in.
   */
  it("tells the recovery case apart from a concurrent edit", () => {
    const card = stripComments(
      readFileSync(join(process.cwd(), "src", "components", "PlayerCard.tsx"), "utf8"),
    );
    // The recovery chooser declares itself; the conflict one takes the default.
    expect(card).toMatch(/kind="recovered"[\s\S]{0,200}mine=\{recoveredFitted\}/);

    const chooser = stripComments(
      readFileSync(join(process.cwd(), "src", "components", "CardConflict.tsx"), "utf8"),
    );
    // It branches on the kind rather than describing one situation twice.
    expect(chooser).toMatch(/kind === "recovered"/);
    // And the committee-edit sentence is reachable only from the conflict copy.
    const recoveredCopy = chooser.slice(chooser.indexOf("recovered\n    ? {"), chooser.indexOf(": {", chooser.indexOf("recovered\n    ? {") + 20));
    expect(recoveredCopy).not.toMatch(/Somebody else/);
  });

  /**
   * A screen that loaded with NO card says so, rather than saying nothing.
   *
   * `card?.revision ?? ""` reached `saveScorecard` as a falsy revision, which
   * that action reads as "write unconditionally" — the CONSOLE's meaning, and
   * the opposite of this screen's. A player who opened an empty card, went
   * offline and entered nine holes then replaced the committee's full eighteen
   * with no conflict raised.
   */
  it("the player's card page reports an absent card as a revision", () => {
    const page = stripComments(
      readFileSync(join(process.cwd(), "src", "app", "(player)", "me", "card", "page.tsx"), "utf8"),
    );
    expect(page).toMatch(/initialRevision=\{me\.round\.card\?\.revision \?\? NO_CARD_REVISION\}/);
    expect(page).not.toMatch(/initialRevision=\{[^}]*\?\?\s*""\s*\}/);
  });
});

/**
 * No scoring path takes the first N holes off a raw card.
 *
 * `applyNine` has been correct since it was written, and the fault was that
 * calling it was OPTIONAL: thirteen scoring and money sites across seven files
 * wrote `course.strokeIndex.slice(0, holes)` instead, which takes the right
 * number of holes and the wrong values. An eighteen-hole stroke index is
 * ranked across eighteen holes, so the front nine of an ordinary card is
 * 1,3,5,...,17 — a player owed seven strokes over nine received four, and a
 * BACK-nine round was scored off the FRONT nine's indexes and pars entirely.
 *
 * The individual stroke board went through `applyNine` and was right, so a
 * club saw two boards for the same round three strokes apart with no way to
 * tell which to believe.
 *
 * This is the CLAUDE.md rule about a guard you must remember to call. Rather
 * than trusting fourteen call sites to remember `cardForStage`, the files that
 * settle money or produce a board are forbidden from slicing a card at all.
 */
/**
 * A draw a player can see is a draw the committee has published.
 *
 * `teeSheetPublished` is the whole difference between a saved sheet and an
 * announced one: a committee shuffles a fourball, saves, and shuffles again
 * before it goes out. `/me/money` read `stage.teeSheet` straight from the
 * round to offer side-bet groups, so the draft draw — group names and who is
 * in each group — was on every player's phone the moment it was saved.
 *
 * Swept from the filesystem rather than from a list, for the same reason the
 * layout suite is: a hand-written list covers the screens somebody remembered,
 * and the one that leaks is the one nobody thought of. Any PLAYER-facing file
 * that reads a stored sheet has to name the flag that says it may.
 */
describe("player screens only show a published tee sheet", () => {
  const PLAYER_DIR = join(process.cwd(), "src", "app", "(player)");

  function playerFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...playerFiles(full));
      else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) out.push(full);
    }
    return out;
  }

  const readers = playerFiles(PLAYER_DIR).filter((f) =>
    /\.teeSheet\b/.test(stripComments(readFileSync(f, "utf8"))),
  );

  it("finds the screens that read one at all", () => {
    // Guards the sweep itself: if this ever hits zero the assertions below are
    // vacuous and would pass however the draw is handled.
    expect(readers.length).toBeGreaterThan(0);
  });

  for (const file of readers) {
    const rel = file.slice(process.cwd().length + 1).replace(/\\/g, "/");
    it(`${rel} checks it was published`, () => {
      expect(stripComments(readFileSync(file, "utf8"))).toMatch(/teeSheetPublished/);
    });
  }
});

describe("a round's card is narrowed in exactly one place", () => {
  const SCORING_FILES = [
    "src/app/(app)/leaderboard/page.tsx",
    "src/app/(app)/reports/page.tsx",
    "src/lib/services/live-board.ts",
    "src/lib/services/season.ts",
    "src/lib/services/expenses.ts",
    "src/app/actions/tournament.ts",
    /**
     * SCORE ENTRY, which this list did not cover and should have.
     *
     * The rule above was written for "the files that settle money or produce a
     * board", and the entry screen is neither by that reading — so it went on
     * doing the banned thing in two places. Its team path used the literal
     * `teamCourse.pars.slice(0, holeCount)`, while `recomputeTeamMatch` — in a
     * file this list DOES cover — went through `cardForStage`. The running net
     * a scorer read while signing the card and the result stored for the same
     * round differed by one to three strokes.
     *
     * A screen somebody signs a card against is a scoring file. The narrow
     * reading of this list is the whole reason the fault survived the guard
     * built to prevent it.
     */
    "src/app/(app)/entry/page.tsx",
  ];

  for (const rel of SCORING_FILES) {
    it(`${rel} does not slice a raw stroke index or par list`, () => {
      const body = stripComments(readFileSync(join(process.cwd(), rel), "utf8"));
      // `slice(from, to)` in skins-pot is fine — it re-ranks straight after.
      // What is banned is taking the first N holes and using them as a card.
      expect(body).not.toMatch(/strokeIndex\.slice\(\s*0\s*,/);
      expect(body).not.toMatch(/pars\.slice\(\s*0\s*,\s*hole/);
    });
  }

  it("routes them through cardForStage instead", () => {
    for (const rel of SCORING_FILES) {
      const body = readFileSync(join(process.cwd(), rel), "utf8");
      expect(body, `${rel} should resolve its card through cardForStage`).toMatch(/cardForStage\(/);
    }
  });

  /**
   * Whether a match is played off handicap is asked ONCE, by name.
   *
   * `isNetBasis` exists, is documented, and answers "both" — which a match
   * needs, because you cannot be 2 up gross and 1 down net and have won.
   * `resolveMatchEntry` uses it. Three outer readers hand-rolled
   * `scoringBasis === "net"` instead, and disagreed with it and with each
   * other:
   *
   *   - the console's entry screen ALSO required `format === "Match Play"`, so
   *     a Nassau configured Net rendered with no strokes under a "Gross
   *     scoring" badge. On the hole-results path the organizer then taps
   *     winners decided scratch and `saveMatchHoles` stores them verbatim —
   *     three bets settled on the wrong basis in a round the club set to Net;
   *   - all three read "both" as gross, while the resolver read it as net and
   *     `needsCourseData` already demanded a card to allocate strokes from.
   *
   * A LABEL may still compare the raw value: `rules.ts` prints "Net" and
   * "Gross and net" differently and must. What is banned is deciding whether
   * strokes APPLY from a hand-rolled comparison.
   */
  it("decides net match play through isNetBasis, not a hand-rolled basis check", () => {
    const root = join(process.cwd(), "src");
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "__tests__" && e.name !== "node_modules") walk(full);
        } else if (/\.tsx?$/.test(e.name)) sources.push(full);
      }
    };
    walk(root);
    // A broken read would make the assertion below vacuous.
    expect(sources.length, "no sources scanned").toBeGreaterThan(100);

    const offenders = sources
      .filter((f) =>
        // A netMode decided on the same line as a raw scoringBasis comparison.
        /netMode[^\n]*scoringBasis[^\n]*[!=]==/.test(stripComments(readFileSync(f, "utf8"))),
      )
      .map((f) => f.slice(process.cwd().length + 1).replace(/\\/g, "/"));

    expect(offenders, "these decide net match play for themselves").toEqual([]);
  });

  /**
   * Score entry resolves a card PER ROUND, not one for the screen.
   *
   * The slice ban above cannot see this fault: the page resolved the event's
   * card once, outside the loop that builds the rounds, and handed the same
   * eighteen numbers to every one of them without slicing anything. So a
   * nine-hole round was drawn with eighteen-hole stroke indexes against a
   * nine-hole allocation base — a Playing Handicap of 7 printed four dots —
   * and a back-nine round printed the front nine's pars, which puts "to par"
   * out as well. The player's own card goes through `cardForStage` and was
   * right, so the two screens disagreed by three strokes.
   *
   * Asserted from the source because it is a server component that nothing
   * renders; the narrowing itself is tested properly in
   * `course-resolution.test.ts`.
   */
  it("score entry resolves each round's card inside the round loop", () => {
    const page = stripComments(
      readFileSync(join(process.cwd(), "src", "app", "(app)", "entry", "page.tsx"), "utf8"),
    );
    // The card is built from the ROUND's own stage, and carried on the round.
    expect(page).toMatch(/cardForStage\(roundCourse, stage\)/);
    expect(page).toMatch(/card:\s*\{[\s\S]{0,160}roundCard\?\.strokeIndex/);
    // The per-hole dots come off that same card rather than a screen-wide one.
    expect(page).toMatch(/roundCard\.strokeIndex\[h\]/);
    // And no screen-wide card survives to be handed to a round by mistake.
    expect(page).not.toMatch(/^\s*const pars = /m);
    expect(page).not.toMatch(/^\s*const strokeIndex = /m);
  });

  /**
   * The tee sheet is judged against the field it was DRAWN from.
   *
   * `teeSheetDrift` compares a published sheet with a set of ids, and the
   * foursomes page passed `state.confirmed` — the season's whole roster. A
   * league draws each week's sheet from that week's attendees, so a
   * twenty-player league with fourteen in produced "6 confirmed players have
   * no tee time" against a sheet that was exactly right, and republishing
   * could not clear it because the next draw excluded the same six.
   *
   * The domain function is fine and is tested with hand-built sets; the fault
   * was entirely in which set the page handed it. This is the only call site
   * in the app, and it is a server component nothing renders — same reason the
   * assertion above reads the source.
   *
   * A permanent false alarm is worse than no alarm: it trains an organizer to
   * ignore a banner that is real in other circumstances.
   */
  it("the tee sheet drift check uses the week's field, not the season roster", () => {
    const page = stripComments(
      readFileSync(join(process.cwd(), "src", "app", "(app)", "foursomes", "page.tsx"), "utf8"),
    );
    expect(page).toMatch(/teeSheetDrift\(savedSheet, new Set\(field\.map\(\(p\) => p\.id\)\)\)/);
    // And the roster is never what it is compared against.
    expect(page).not.toMatch(/teeSheetDrift\([^)]*state\.confirmed/);
    // `field` has to be resolved BEFORE the check, or it is the roster by
    // another name — this is what made the original a one-line fault.
    const fieldAt = page.indexOf("let field =");
    const driftAt = page.indexOf("teeSheetDrift(");
    expect(fieldAt, "field must be computed").toBeGreaterThan(-1);
    expect(fieldAt, "field must be resolved before the drift check").toBeLessThan(driftAt);
  });

  /**
   * NOTHING hands `aggregateStroke` a card that ignores which round it is for.
   *
   * `courseFor` takes a stageId precisely so a nine, or a second venue, is
   * resolved per round. An arrow that takes no argument and closes over one
   * card satisfies the type and throws that away — and it is invisible to both
   * guards above, because it slices nothing and the file need never mention
   * `cardForStage`.
   *
   * That is how the weekly league board came to score every week off the
   * event's whole eighteen. `week-view.ts` did it twice: once for the week on
   * screen, and once inside `through()`, which totals SEVERAL weeks against a
   * single card. Handicaps went through `state.strokeHandicapFor` and were
   * right for the nine actually played, so a back-nine league week allocated
   * off 18-hole stroke indexes — a player owed 9 drew 5 — and `/week` named a
   * different winner from the round's own leaderboard, every week, all season.
   *
   * Banned by SHAPE rather than by file, so a service written next year cannot
   * reintroduce it by not being on a list. The state exposes `strokeCourseFor`
   * for exactly this; pass that, or a function that reads its stageId.
   */
  it("no scoring path passes a courseFor that ignores its round", () => {
    const root = join(process.cwd(), "src");
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "__tests__" && e.name !== "node_modules") walk(full);
        } else if (/\.tsx?$/.test(e.name)) {
          sources.push(full);
        }
      }
    };
    walk(root);

    // A broken read would make the assertion below vacuous, which is the way
    // a filesystem-swept guard fails silently.
    expect(sources.length, "no sources scanned").toBeGreaterThan(100);

    const offenders = sources
      // `courseFor: () =>` and `courseFor: _ =>` both discard the stage.
      .filter((f) => /courseFor:\s*(\(\s*\)|\(\s*_\w*\s*\)|_\w*)\s*=>/.test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => f.slice(process.cwd().length + 1).replace(/\\/g, "/"));

    expect(offenders, "these resolve one card for every round").toEqual([]);
  });

  /**
   * The round-code screen is a scoring surface too.
   *
   * It handed the player the EVENT's card — ignoring the match's venue, the
   * round's, and which nine — and then sized its grid from that card's length,
   * so a nine-hole match drew eighteen cells and could never be submitted.
   * Asserted from the source because the page is a server component; what it
   * renders is covered in `render.test.tsx`.
   */
  it("the round-code play screen resolves the match's own card", () => {
    const page = stripComments(
      readFileSync(join(process.cwd(), "src", "app", "play", "page.tsx"), "utf8"),
    );
    expect(page).toMatch(/courseForMatch\(playMatchVenue, playStageVenue, event\)/);
    expect(page).toMatch(/cardForMatch\(playResolved, match, stage\)/);
    // The round's hole count travels explicitly, so the grid never has to
    // guess it from the length of a card.
    expect(page).toMatch(/holes=\{holeCount\}/);
    // And the event's whole card is no longer handed down.
    expect(page).not.toMatch(/pars=\{course\.pars\}/);
  });

  it("keeps the one place honest — cardForStage always goes through applyNine", () => {
    const src = stripComments(
      readFileSync(join(process.cwd(), "src", "lib", "services", "course-resolution.ts"), "utf8"),
    );
    const fn = src.slice(src.indexOf("export function cardForStage"));
    expect(fn).toMatch(/applyNine\(/);
    expect(fn).toMatch(/cleanNine\(/);
  });
});

/**
 * A tee sheet is drawn for the round the organizer picked.
 *
 * The page lets any playing round be selected and then computed its hole count
 * from `playingStages(state.stages)[0]` — always round one — while the tee
 * NAMES two dozen lines below already used the selected round. A nine-hole
 * round inside an eighteen-hole tournament is fully supported, and it broke in
 * both directions: a split start on a nine-hole Round 2 sent every second group
 * off the 10th tee of a nine-hole course, and a nine-hole Round 1 followed by
 * an eighteen-hole Round 2 printed a nine-column card for eighteen holes.
 *
 * Asserted from the source because the page is a server component: nothing
 * renders it, and `draw.test.ts` proves the domain function is right about the
 * `holes` it is GIVEN, which is exactly the half that was never wrong.
 */
describe("the tee sheet is drawn for the selected round", () => {
  const page = readFileSync(
    join(process.cwd(), "src", "app", "(app)", "foursomes", "page.tsx"),
    "utf8",
  );

  it("takes its hole count from the selected round, not the first one", () => {
    expect(page).toMatch(/const holes = stage\?\.holes === 9 \? 9 : 18;/);
  });

  it("never derives a hole count from the first playing round", () => {
    // The exact shape of the bug, so it cannot come back by another route.
    expect(stripComments(page)).not.toMatch(/playingStages\([^)]*\)\[0\]\??\.holes/);
  });

  it("prints the card the round is actually played on", () => {
    // It printed the EVENT's card, so a two-course tournament put round one's
    // par and stroke index on round two's scorecards.
    expect(page).toMatch(/cardForStage\(/);
    expect(page).toMatch(/courseForRound\(roundCourse, state\.event\)/);
  });
});

/**
 * Two screens that described something the app was not going to do.
 *
 * Both are server components that nothing renders, so they are asserted from
 * the source — and in the qualification case the arithmetic itself is checked
 * against the real `drawBrackets`, which is the thing the screen was inventing
 * its own version of.
 */
describe("the qualification screen counts the draw the tournament will make", () => {
  const page = readFileSync(
    join(process.cwd(), "src", "app", "(app)", "qualification", "page.tsx"),
    "utf8",
  );

  it("asks drawBrackets rather than halving the field", () => {
    // It hardcoded `ceil(n/2)` and `floor(n/2)` and never read bracketMode.
    expect(page).toMatch(/drawBrackets\(qualifiers, mode\)/);
    expect(stripComments(page)).not.toMatch(/Math\.ceil\(qualifiers\.length \/ 2\)/);
    expect(stripComments(page)).not.toMatch(/Math\.floor\(qualifiers\.length \/ 2\)/);
  });

  it("reads the organizer's bracket mode", () => {
    expect(page).toMatch(/isBracketMode\(event\.bracketMode\)/);
  });

  it("names the second bracket whatever the draw calls it", () => {
    expect(page).toMatch(/To \{secondLabel\}/);
  });
});

describe("what each bracket mode actually sends where", () => {
  // The numbers the screen used to state, against the numbers the draw makes.
  const eight = Array.from({ length: 8 }, (_, i) => ({
    id: `p${i + 1}`,
    name: `P${i + 1}`,
    handicap: 10,
    seed: i + 1,
    groupId: null,
  }));

  it("puts EVERY qualifier in one bracket under 'single'", () => {
    // The screen said four of the eight were going to a Consolation that does
    // not exist, and the bracket screen then showed all eight in one draw.
    const draw = drawBrackets(eight, "single");
    expect(draw.main).toHaveLength(8);
    expect(draw.second).toHaveLength(0);
    expect(draw.secondLabel).toBe("");
  });

  it("starts a plate EMPTY, because it is filled from the losers", () => {
    // It claimed four to a Consolation before anybody had lost.
    const draw = drawBrackets(eight, "plate");
    expect(draw.main).toHaveLength(8);
    expect(draw.second).toHaveLength(0);
    expect(draw.secondLabel).toBeTruthy();
  });

  it("really does halve under 'split', which is the only case the old sum fitted", () => {
    const draw = drawBrackets(eight, "split");
    expect(draw.main).toHaveLength(4);
    expect(draw.second).toHaveLength(4);
  });
});

describe("the payouts screen shows the CLUB's pots", () => {
  const page = readFileSync(
    join(process.cwd(), "src", "app", "(app)", "prizes", "page.tsx"),
    "utf8",
  );

  it("filters side games to the field's own, like the skins query above it", () => {
    /**
     * Without it, a fourball's private £5 birdie pot rendered under the club's
     * heading with the whole field lit as its entrants — and the controls
     * beneath acted on a different game entirely: ticking a chip was refused,
     * and re-pricing wrote the FIELD's row, creating the pot the screen was
     * only pretending to show.
     */
    expect(page).toMatch(/stageId: week\.id, groupKey: ""/);
  });

  it("still scopes both pot queries to the tournament", () => {
    // The narrowing must not have quietly replaced the event scope.
    const queries = page.match(/where: \{[^}]*stageId: week\.id[^}]*\}/g) ?? [];
    expect(queries.length).toBeGreaterThanOrEqual(2);
  });
});


/**
 * The round's tee is resolved in one place, by one rule.
 *
 * `roundTeeId` puts the round's configured `defaultTeeId` ahead of
 * first-by-position, and `handicaps.ts` records that the fallback "was
 * previously the ONLY rule, written out as `tees[0]?.id` at six separate call
 * sites — so a club whose first set is Blue scored every unassigned player off
 * Blue even when the medal was off the Whites, and no screen said so."
 *
 * Four of those six survived that clean-up: net match play, the team-match
 * recompute, the score-entry card's stroke dots, and the printed tee sheet. A
 * club whose rows run Blue, White and set the medal off the Whites had the
 * board price a 12.4 index at 12 and those paths price the same player at 19 —
 * and the net match's per-hole winners are derived from the 19 and STORED, so
 * the result was decided by a handicap no screen was showing.
 *
 * The entry screen had it BOTH ways in one file, correct on one line and wrong
 * fifty lines above. The tee sheet asserted the wrong rule in a comment as
 * though it had been checked, which is why nobody looked.
 *
 * Asserted over the whole source rather than at the four sites, so the fifth
 * cannot be written.
 */
describe("nothing resolves a tee as whichever one sorts first", () => {
  const sourceFiles = () => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "__tests__" || e.name === "node_modules") continue;
          walk(p);
        } else if (/\.tsx?$/.test(e.name)) {
          out.push(p);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    return out;
  };

  it("never takes the first tee by position outside roundTeeId itself", () => {
    // `handicaps.ts` is where the fallback legitimately lives — it IS
    // roundTeeId's last resort, for a club that has configured nothing.
    const home = join("src", "lib", "services", "handicaps.ts");
    const offenders = sourceFiles()
      .filter((f) => !f.endsWith(home))
      .filter((f) => /\w*[Tt]ees\w*\[0\]\??\.id/.test(stripComments(readFileSync(f, "utf8"))));
    expect(
      offenders.map((f) => f.replace(process.cwd(), "")),
      "resolve the round's tee with roundTeeId(tees, event.defaultTeeId)",
    ).toEqual([]);
  });

  it("keeps roundTeeId itself preferring the configured set", () => {
    // The guard above is only worth anything if the one reader is right.
    const fn = stripComments(
      readFileSync(join(process.cwd(), "src", "lib", "services", "handicaps.ts"), "utf8"),
    );
    const body = fn.slice(fn.indexOf("export function roundTeeId"));
    // It returns the configured set when the course still has it...
    expect(body).toMatch(/if \(configured && tees\.some/);
    // ...and only then falls back to first-by-position.
    expect(body.indexOf("configured")).toBeLessThan(body.indexOf("tees[0]"));
  });
});


/**
 * A preview deployment never touches the production database.
 *
 * Opening a pull request used to produce a preview that READ AND WROTE the
 * database holding real members' names, handicaps and money. The migration
 * gate had already stopped a branch changing production's SCHEMA, and said in
 * its own header that the real repair was "a separate database for the Preview
 * environment". Preview now has one, attached under the `PREVIEW_` prefix.
 *
 * Asserted from the source because the alternative is a test that connects to
 * a real database to prove it is the right one — and the whole point is that
 * the wrong one must never be reachable from a test run.
 */
describe("a preview deployment has its own database", () => {
  const db = readFileSync(join(process.cwd(), "src", "lib", "db.ts"), "utf8");
  const gate = readFileSync(join(process.cwd(), "scripts", "deploy-migrations.mjs"), "utf8");

  it("chooses the preview database only on a preview deployment", () => {
    // VERCEL_ENV is set by the platform, so local, CI and production runs all
    // behave exactly as they did before.
    expect(db).toMatch(/process\.env\.VERCEL_ENV !== "preview"/);
    expect(db).toMatch(/PREVIEW_DATABASE_URL/);
  });

  it("falls back rather than throwing if the preview database is detached", () => {
    // Returning undefined puts Prisma back on schema.prisma's datasource. A
    // throw here would break every screen at import time.
    expect(stripComments(db)).toMatch(/return undefined;/);
    expect(stripComments(db)).toMatch(/\|\| undefined;/);
  });

  it("leaves production and local runs on the schema's own datasource", () => {
    // The override is applied conditionally — an unconditional `datasourceUrl`
    // would point production at whatever the preview variable happened to be.
    expect(db).toMatch(/\.\.\.\(previewDatabaseUrl\(\) \? \{ datasourceUrl: previewDatabaseUrl\(\) \} : \{\}\)/);
  });

  it("migrates a preview against the PREVIEW database, not production's", () => {
    expect(gate).toMatch(/env === "preview" && previewDirect && previewPooled/);
    expect(gate).toMatch(/process\.env\.DATABASE_URL = previewDirect;/);
  });

  it("still refuses to migrate a preview that has no database of its own", () => {
    /**
     * The fail-safe. If the preview database is ever detached, this build's
     * DATABASE_URL may be production's again — so the original refusal has to
     * apply, rather than the gate assuming the separation is still in place.
     */
    expect(gate).toMatch(/else if \(env && env !== "production"\)/);
    expect(gate).toMatch(/process\.exit\(0\)/);
  });

  it("guards on the database being present, not on a flag", () => {
    // A boolean somebody can set is a boolean somebody can set wrongly. The
    // condition is the existence of the connection itself.
    const body = stripComments(gate);
    expect(body).toMatch(/const previewDirect = process\.env\.PREVIEW_DATABASE_URL_UNPOOLED;/);
    expect(body).not.toMatch(/PREVIEW_DB_ENABLED|USE_PREVIEW_DB/);
  });
});

/**
 * The privacy policy carries no hard-coded address.
 *
 * It shipped with `privacy@tourneyhq.example` and a comment saying to set it
 * before launch — a comment being the entire mechanism, which is the shape of
 * guard CLAUDE.md says will be forgotten. It was: the address was still there
 * on the day a real domain was bought.
 *
 * This is a source check rather than a render check on purpose. A render test
 * proves what one configuration produces; only reading the file proves there is
 * no literal left to go stale under a configuration nobody ran.
 */
describe("the privacy policy's contact address", () => {
  const page = stripComments(
    readFileSync(join(process.cwd(), "src", "app", "privacy", "page.tsx"), "utf8"),
  );

  it("contains no literal email address at all", () => {
    /**
     * Not "no .example address" — any literal is wrong here. Hard-coding a real
     * address would pass a placeholder-specific check and reintroduce the code
     * edit this removed, so the assertion is on the category.
     */
    const literal = page.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    expect(literal, `hard-coded address in the privacy page: ${literal?.[0]}`).toBeNull();
  });

  it("resolves the address through the rule that refuses a reserved one", () => {
    // Reading the variable directly would publish whatever was typed into it.
    expect(page).toMatch(/privacyContact\(process\.env\.PRIVACY_CONTACT_EMAIL\)/);
  });

  it("has prose for the case where no address is configured", () => {
    /**
     * The degradation is the point. Without it the page renders a sentence with
     * a hole in it — "If they cannot, write to us at  and we will act on it" —
     * which is worse than either branch done properly.
     */
    expect(page).toMatch(/contact\.kind === "address" \?/);
    expect(page).toMatch(/ask your club to raise it with us/);
  });
});
