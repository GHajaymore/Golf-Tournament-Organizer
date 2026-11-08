import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * THE SCOPED LOCKS RETURN, NEVER THROW (state machine PR 5a; J10).
 *
 * `assertUnlocked` THREW, and a throw inside a transition is "This screen didn't
 * load" — so a press on Teams & pairs drawn before the lock (the tournament
 * launched in another tab) took the screen down, and `TeamsClient` could only
 * survive by never offering the press. The ten lock sites in `actions/teams.ts`
 * and `actions/setup-suggest.ts` now ask their SCOPE's lock and return
 * `{ ok: false, error, lock }`: the reason and the way out in words.
 *
 * Pinned by name and scope, so a site cannot quietly go back to throwing, ask the
 * wrong scope, or ask and forget to return (`await refuseIfLocked(…)` alone
 * refuses nothing). Tournament.ts's 28 sites and roster.ts are PR 5b's.
 */

const SITES: Record<string, { file: string; scope: string; what: string }> = {
  createTeam: { file: "src/app/actions/teams.ts", scope: "sides", what: "change teams" },
  deleteTeam: { file: "src/app/actions/teams.ts", scope: "sides", what: "change teams" },
  addTeamMember: { file: "src/app/actions/teams.ts", scope: "sides", what: "change teams" },
  removeTeamMember: { file: "src/app/actions/teams.ts", scope: "sides", what: "change teams" },
  generateTeamMatches: { file: "src/app/actions/teams.ts", scope: "sides", what: "change teams" },
  autoDrawTeams: { file: "src/app/actions/teams.ts", scope: "sides", what: "change teams" },
  setStageAllowance: { file: "src/app/actions/teams.ts", scope: "rounds", what: "change a round’s handicap allowance" },
  setStageCountBest: { file: "src/app/actions/teams.ts", scope: "rounds", what: "change how many scores count" },
  setStageAllowanceWeights: { file: "src/app/actions/teams.ts", scope: "rounds", what: "change the handicap split" },
  applySetupProposal: { file: "src/app/actions/setup-suggest.ts", scope: "rounds", what: "add rounds" },
};

/** An exported action's body, up to the next export. */
function body(file: string, name: string): string {
  const src = readSource(file);
  const at = src.indexOf(`export async function ${name}(`);
  expect(at, `${name} is not in ${file}`).toBeGreaterThan(-1);
  const next = src.indexOf("export ", at + 1);
  return src.slice(at, next === -1 ? undefined : next);
}

/** The site, asked and returned: `const locked = await refuseIfLocked(eventId, "<scope>", "<what>"); if (locked) return locked;` */
function asks(b: string): { scope: string; what: string } | null {
  const m = b.match(/const locked = await refuseIfLocked\(eventId, "(\w+)", "([^"]+)"\);\s*if \(locked\) return locked;/);
  return m ? { scope: m[1], what: m[2] } : null;
}

/** Where the action first writes. */
const FIRST_WRITE = /prisma\.\w+\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(/;

describe("the scoped locks return, never throw", () => {
  it("CONTROL: the matcher sees a site asked and returned, and not one asked and dropped", () => {
    expect(asks(`const locked = await refuseIfLocked(eventId, "sides", "change teams");\n  if (locked) return locked;`)).toEqual({
      scope: "sides",
      what: "change teams",
    });
    expect(asks(`await refuseIfLocked(eventId, "sides", "change teams");`)).toBeNull();
    expect(asks(`const locked = await refuseIfLocked(eventId, "sides", "change teams");\n  if (locked) throw new Error(locked.error);`)).toBeNull();
  });

  it("neither file asks the throwing lock any more", () => {
    for (const file of ["src/app/actions/teams.ts", "src/app/actions/setup-suggest.ts"]) {
      expect(readSource(file), file).not.toMatch(/\bassertUnlocked\b|\blockedRefusal\b|\bconfigurationLocked\b/);
    }
  });

  for (const [name, want] of Object.entries(SITES)) {
    it(`${name} asks the ${want.scope} lock, returns it, and before it writes anything`, () => {
      const b = body(want.file, name);
      expect(asks(b), `${name} does not ask and return its lock`).toEqual({ scope: want.scope, what: want.what });
      const write = b.search(FIRST_WRITE);
      if (write > -1) expect(b.indexOf("refuseIfLocked("), `${name} writes before it asks the lock`).toBeLessThan(write);
    });
  }

  it("ten sites, and no other lock-asking action in the two files goes unlisted", () => {
    const listed = new Set(Object.keys(SITES));
    for (const file of ["src/app/actions/teams.ts", "src/app/actions/setup-suggest.ts"]) {
      for (const part of readSource(file).split(/export async function /).slice(1)) {
        const name = part.slice(0, part.indexOf("("));
        if (/refuseIfLocked\(/.test(part)) expect(listed.has(name), `${name} asks a lock and is not pinned here`).toBe(true);
      }
    }
    expect(listed.size).toBe(10);
  });
});

describe("Teams & pairs draws the lock its actions ask", () => {
  it("the page reads the machine's sides lock into the one shared banner, not the blanket lock", () => {
    const page = readSource("src", "app", "(app)", "teams", "page.tsx");
    expect(page).toMatch(/const sidesLock = await scopeLockFor\(session\.eventId, "sides"\);/);
    expect(page).toMatch(/<ScopeLockBanner locks=\{sidesLock \? \[sidesLock\] : \[\]\}/);
    expect(page).not.toMatch(/\bisSetupLocked\b|\bSetupLockBanner\b/);
  });

  it("every press that reaches a locked action catches the screen up when it is refused by the lock", () => {
    const client = readSource("src", "components", "TeamsClient.tsx");
    expect(client).toMatch(/if \(!res\.ok && res\.lock\) router\.refresh\(\);/);
    for (const action of ["createTeam", "deleteTeam", "addTeamMember", "removeTeamMember", "autoDrawTeams", "generateTeamMatches"]) {
      const calls = client.match(new RegExp(`await ${action}\\(`, "g"))?.length ?? 0;
      const caught = client.match(new RegExp(`caughtUp\\(await ${action}\\(`, "g"))?.length ?? 0;
      expect(calls, `${action} is not called`).toBeGreaterThan(0);
      expect(caught, `a press of ${action} is not caught up`).toBe(calls);
    }
  });

  it("the banner says the machine's reason and way out, and is the only scoped-lock banner", () => {
    const banner = readSource("src", "components", "ScopeLockBanner.tsx");
    expect(banner).toMatch(/\{l\.because\}/);
    expect(banner).toMatch(/\{l\.wayOut\.says\}/);
    expect(banner).toMatch(/locks\.slice\(0, 3\)/);
  });
});
