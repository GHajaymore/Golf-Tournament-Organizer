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
      // Safe specifically because no write guard reads viewRole; every action
      // gates on session.role, which this cannot touch. If that ever changes,
      // this exemption becomes a privilege-escalation hole.
      "setPreviewAction",
    ],
    "play.ts": ["redeemRoundCode", "claimPlayerSlot", "leavePlay"],
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
      expect(body, `${name} looks up a code without rate limiting`).toMatch(/rateLimit\(/);
    }
  });

  it("shares one budget across both entry points", () => {
    // Separate keys would give an attacker two budgets per code.
    const keys = [...play.matchAll(/rateLimit\(`([^`]+)`/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(new Set(keys).size).toBe(1);
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
    expect(body).toMatch(/rawHandicap\.trim\(\) !== ""/);
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

  it("is staff-only and refuses once setup is locked", () => {
    expect(body).toMatch(/requireStaffEvent\(\)/);
    expect(body).toMatch(/assertUnlocked\(eventId\)/);
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
