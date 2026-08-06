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
