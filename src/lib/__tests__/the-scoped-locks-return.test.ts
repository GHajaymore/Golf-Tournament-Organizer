import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * THE SCOPED LOCKS RETURN, NEVER THROW (state machine PR 5a and 5b; J10).
 *
 * `assertUnlocked` THREW, and a throw inside a transition is "This screen didn't
 * load" — so a press on a screen drawn before the lock (the tournament launched
 * in another tab) took the screen down, and a client could only survive by
 * never offering the press. Every lock site in `actions/teams.ts`,
 * `actions/setup-suggest.ts` and `actions/tournament.ts` now asks its SCOPE's
 * lock and returns `{ ok: false, error, lock }`: the reason and the way out in
 * words. `assertUnlocked` and `lockedRefusal` are deleted (PR 5b).
 *
 * Pinned by name and scope, so a site cannot quietly go back to throwing, ask the
 * wrong scope, or ask and forget to return (`await refuseIfLocked(…)` alone
 * refuses nothing).
 */

const TEAMS = "src/app/actions/teams.ts";
const SUGGEST = "src/app/actions/setup-suggest.ts";
const TOURNAMENT = "src/app/actions/tournament.ts";
const FILES = [TEAMS, SUGGEST, TOURNAMENT];

const SITES: Record<string, { file: string; scope: string; what: string; except?: string }> = {
  // PR 5a
  createTeam: { file: TEAMS, scope: "sides", what: "change teams" },
  deleteTeam: { file: TEAMS, scope: "sides", what: "change teams" },
  addTeamMember: { file: TEAMS, scope: "sides", what: "change teams" },
  removeTeamMember: { file: TEAMS, scope: "sides", what: "change teams" },
  generateTeamMatches: { file: TEAMS, scope: "sides", what: "change teams" },
  autoDrawTeams: { file: TEAMS, scope: "sides", what: "change teams" },
  setStageAllowance: { file: TEAMS, scope: "rounds", what: "change a round’s handicap allowance" },
  setStageCountBest: { file: TEAMS, scope: "rounds", what: "change how many scores count" },
  setStageAllowanceWeights: { file: TEAMS, scope: "rounds", what: "change the handicap split" },
  // PR 5b: the 28 sites of tournament.ts (section 3's Lock column)
  saveEvent: { file: TOURNAMENT, scope: "details", what: "change the tournament’s details" },
  applyManualCount: { file: TOURNAMENT, scope: "field", what: "change the field limit" },
  regenGroups: { file: TOURNAMENT, scope: "flights", what: "make the flights again" },
  // generateNextRound asks NO lock: a round with scores is refused by `redrawRefusal` (below).
  saveScoring: { file: TOURNAMENT, scope: "rounds", what: "change the points" },
  setQualifyPerGroup: { file: TOURNAMENT, scope: "rounds", what: "change who qualifies" },
  setStageCarry: { file: TOURNAMENT, scope: "rounds", what: "change the points carried forward" },
  setStageCut: { file: TOURNAMENT, scope: "rounds", what: "change the cut" },
  setStageScoringBasis: { file: TOURNAMENT, scope: "rounds", what: "change how a round is scored" },
  setStageScoreInput: { file: TOURNAMENT, scope: "rounds", what: "change how scores are entered" },
  setStageMatchKeptBy: { file: TOURNAMENT, scope: "rounds", what: "change who keeps the match card" },
  setStageFormat: { file: TOURNAMENT, scope: "rounds", what: "change a round’s format" },
  setStageHoles: { file: TOURNAMENT, scope: "rounds", what: "change a round’s holes" },
  saveTiebreakers: { file: TOURNAMENT, scope: "rounds", what: "change the tie-breakers" },
  setQualifyMode: { file: TOURNAMENT, scope: "rounds", what: "change who qualifies" },
  removeStage: { file: TOURNAMENT, scope: "rounds", what: "delete a round" },
  setBracketMode: { file: TOURNAMENT, scope: "draw", what: "change the bracket’s arrangement" },
  renameGroup: { file: TOURNAMENT, scope: "flights", what: "rename a flight", except: "draw" },
  setFlightsConfirmed: { file: TOURNAMENT, scope: "flights", what: "confirm or reopen the draw", except: "draw" },
  setMatchTiebreakers: { file: TOURNAMENT, scope: "rounds", what: "change the match tie-breakers" },
  saveEntryTerms: { file: TOURNAMENT, scope: "field", what: "change the entry terms" },
  setRegistrationApproval: { file: TOURNAMENT, scope: "field", what: "change how entries are approved" },
  setStageCutScope: { file: TOURNAMENT, scope: "rounds", what: "change the cut" },
  setStageCutTies: { file: TOURNAMENT, scope: "rounds", what: "change the cut" },
  clearRoundScores: { file: TOURNAMENT, scope: "rounds", what: "clear scores" },
  setRequirePhone: { file: TOURNAMENT, scope: "field", what: "change the entry terms" },
  setSingleMatchRule: { file: TOURNAMENT, scope: "rounds", what: "change the match’s rule" },
  setThirdPlace: { file: TOURNAMENT, scope: "rounds", what: "change the play-off for third" },
};

/** An exported action's body, up to the next export. */
function body(file: string, name: string): string {
  const src = readSource(file);
  const at = src.indexOf(`export async function ${name}(`);
  expect(at, `${name} is not in ${file}`).toBeGreaterThan(-1);
  const next = src.indexOf("export ", at + 1);
  return src.slice(at, next === -1 ? undefined : next);
}

/**
 * The site, asked and returned:
 * `const locked = await refuseIfLocked(eventId, "<scope>", "<what>"[, { except: ["<by>"] }]); if (locked) return locked;`
 * (`clearRoundScores` returns `{ ...locked, cleared: 0 }`, its own shape.)
 */
function asks(b: string): { scope: string; what: string; except?: string } | null {
  const m = b.match(
    /const locked = await refuseIfLocked\(eventId, "(\w+)", "([^"]+)"(?:, \{ except: \["(\w+)"\] \})?\);\s*if \(locked\) return (?:locked|\{ \.\.\.locked, cleared: 0 \});/,
  );
  return m ? { scope: m[1], what: m[2], ...(m[3] ? { except: m[3] } : {}) } : null;
}

/** Where the action first writes. */
const FIRST_WRITE = /prisma\.\w+\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(/;

describe("the scoped locks return, never throw", () => {
  it("CONTROL: the matcher sees a site asked and returned, and not one asked and dropped", () => {
    expect(asks(`const locked = await refuseIfLocked(eventId, "sides", "change teams");\n  if (locked) return locked;`)).toEqual({
      scope: "sides",
      what: "change teams",
    });
    expect(asks(`const locked = await refuseIfLocked(eventId, "flights", "rename a flight", { except: ["draw"] });\n  if (locked) return locked;`)).toEqual({
      scope: "flights",
      what: "rename a flight",
      except: "draw",
    });
    expect(asks(`await refuseIfLocked(eventId, "sides", "change teams");`)).toBeNull();
    expect(asks(`const locked = await refuseIfLocked(eventId, "sides", "change teams");\n  if (locked) throw new Error(locked.error);`)).toBeNull();
  });

  it("no action file asks the throwing lock any more, and the helpers themselves are gone", () => {
    for (const file of FILES) {
      expect(readSource(file), file).not.toMatch(/\bassertUnlocked\b|\blockedRefusal\b|\bconfigurationLocked\b|\bisSetupLocked\b/);
    }
    const shared = readSource("src/lib/services/action-shared.ts");
    expect(shared).not.toMatch(/function assertUnlocked|function lockedRefusal/);
    expect(readSource("src/lib/page-helpers.ts")).not.toMatch(/function isSetupLocked/);
  });

  for (const [name, want] of Object.entries(SITES)) {
    it(`${name} asks the ${want.scope} lock, returns it, and before it writes anything`, () => {
      const b = body(want.file, name);
      expect(asks(b), `${name} does not ask and return its lock`).toEqual(want.except ? { scope: want.scope, what: want.what, except: want.except } : { scope: want.scope, what: want.what });
      const write = b.search(FIRST_WRITE);
      if (write > -1) expect(b.indexOf("refuseIfLocked("), `${name} writes before it asks the lock`).toBeLessThan(write);
    });
  }

  it("thirty-six sites, and no other lock-asking action in the three files goes unlisted", () => {
    const listed = new Set(Object.keys(SITES));
    for (const file of FILES) {
      for (const part of readSource(file).split(/export async function /).slice(1)) {
        const name = part.slice(0, part.indexOf("("));
        if (/refuseIfLocked\(/.test(part)) expect(listed.has(name), `${name} asks a lock and is not pinned here`).toBe(true);
      }
    }
    expect(listed.size).toBe(36);
  });

  /**
   * A REDRAW NEVER GOES OVER RECORDED SCORES (panel review of 5b, must-fix 2).
   * `generateNextRound` asked the draw's lock, which in a flighted knockout is
   * OPEN while live until the first knockout result — so a re-press on a scored
   * qualifying round wiped its cards with no refusal — and where it did refuse,
   * it offered a committee correction as a way to wipe scores. It asks the
   * round's cards instead (`redrawRefusal`), before the draw, and no lock.
   */
  it("generateNextRound asks the round's cards, not a lock, and refuses before it draws", () => {
    const b = body(TOURNAMENT, "generateNextRound");
    expect(b).not.toMatch(/refuseIfLocked\(/);
    const refused = b.indexOf("redrawRefusal(");
    expect(refused, "the redraw rule is not asked").toBeGreaterThan(-1);
    expect(b).toMatch(/redrawRefusal\(roundLabel\(stages, stageId\), await enteredCardCount\(eventId, stageId\)\);\s*if \(refused\) return \{ ok: false as const, error: refused \};/);
    expect(refused).toBeLessThan(b.indexOf("generateCutRound("));
  });

  it("the only lock whose own controls are excepted is the draw's, on the two flights controls that ARE its way out", () => {
    const excepted = Object.entries(SITES).filter(([, s]) => s.except);
    expect(excepted.map(([n]) => n).sort()).toEqual(["renameGroup", "setFlightsConfirmed"]);
    for (const [, s] of excepted) expect(s).toMatchObject({ scope: "flights", except: "draw" });
  });
});

describe("adding a round asks ONE rule, in both doors (TD ruling on 5a, Q2)", () => {
  it("addStage and applySetupProposal ask refuseIfAddingARoundIsLocked and return it, before any write", () => {
    for (const [file, name] of [
      [TOURNAMENT, "addStage"],
      [SUGGEST, "applySetupProposal"],
    ] as const) {
      const b = body(file, name);
      expect(b, `${name} does not ask the add-a-round rule`).toMatch(/const locked = await refuseIfAddingARoundIsLocked\(eventId\);\s*if \(locked\) return/);
      const write = b.search(FIRST_WRITE);
      if (write > -1) expect(b.indexOf("refuseIfAddingARoundIsLocked("), `${name} writes before it asks`).toBeLessThan(write);
      expect(b).not.toMatch(/refuseIfLocked\(/);
    }
  });

  it("the rule itself refuses only a completed tournament's rounds lock", () => {
    const domain = readSource("src/lib/domain/tournament-status.ts");
    expect(domain).toMatch(/export function addRoundLockOf\(locks: Record<LockScope, Lock>\): ScopeLock \| null \{\s*const l = scopeLockOf\(locks, "rounds"\);\s*return l && l\.by === "completed" \? l : null;/);
  });
});

describe("the screens draw the lock their actions ask", () => {
  it("Teams & pairs reads the machine's sides lock into the one shared banner", () => {
    const page = readSource("src", "app", "(app)", "teams", "page.tsx");
    expect(page).toMatch(/const sidesLock = await scopeLockFor\(session\.eventId, "sides"\);/);
    expect(page).toMatch(/<ScopeLockBanner locks=\{sidesLock \? \[sidesLock\] : \[\]\}/);
  });

  it("each set-up screen reads its scope's lock — details, flights, rounds, the field — into the one shared banner (PR 5b)", () => {
    for (const [screen, scope] of [
      ["event", "details"],
      ["grouping", "flights"],
      ["stages", "rounds"],
      ["registration", "field"],
    ] as const) {
      const page = readSource("src", "app", "(app)", screen, "page.tsx");
      expect(page, `${screen} does not ask the ${scope} lock`).toMatch(new RegExp(`await screenLocksFor\\(session\\.eventId, \\["${scope}"\\]\\)`));
      expect(page, `${screen} still draws the blanket banner`).not.toMatch(/SetupLockBanner|isSetupLocked/);
    }
    expect(readSource("src", "app", "(app)", "event", "page.tsx")).toMatch(/<ScopeLockBanner locks=\{details\.locks\} correction=\{details\.correction\}/);
    expect(readSource("src", "app", "(app)", "stages", "page.tsx")).toMatch(/<ScopeLockBanner locks=\{rounds\.locks\} correction=\{rounds\.correction\}/);
    expect(readSource("src", "components", "RegistrationClient.tsx")).toMatch(/<ScopeLockBanner locks=\{fieldLocks\} correction=\{correction\} isAdmin=\{isAdmin\} open=\{underWay\}/);
  });

  it("the Flights screen leaves the draw's own lock to its board, which is that lock's way out", () => {
    const page = readSource("src", "app", "(app)", "grouping", "page.tsx");
    expect(page).toMatch(/const flightLocks = flights\.locks\.filter\(\(l\) => l\.by !== "draw"\);/);
    expect(page).toMatch(/<ScopeLockBanner locks=\{flightLocks\}/);
  });

  it("the blanket banner is deleted, not left beside the scoped one", () => {
    expect(() => readSource("src", "components", "SetupLockBanner.tsx")).toThrow();
  });

  it("every refused press catches the screen up: once in useAction, and in each bespoke body", () => {
    const hook = readSource("src", "components", "useAction.ts");
    expect(hook).toMatch(/export function useCaughtUp\(\)/);
    expect(hook).toMatch(/if \(!res\.ok && res\.lock\) router\.refresh\(\);/);
    expect(hook).toMatch(/const res = caughtUp\(await fn\(\)\);/);
    // The 5a client keeps its own, pinned by the same line.
    expect(readSource("src", "components", "TeamsClient.tsx")).toMatch(/if \(!res\.ok && res\.lock\) router\.refresh\(\);/);
    // A bespoke body wraps its await; none calls a lock-refusing action bare.
    const BESPOKE: Record<string, string[]> = {
      "src/components/StagesClient.tsx": ["generateNextRound", "setStageCarry", "setStageFormat", "setStageHoles", "setStageScoringBasis", "setStageMatchKeptBy", "removeStage", "setStageScoreInput"],
      "src/components/EventSetupClient.tsx": ["saveEvent", "applyManualCount"],
      "src/components/GroupingControls.tsx": ["regenGroups"],
      "src/components/CutControl.tsx": ["setStageCut", "setStageCutScope", "setStageCutTies"],
      "src/components/FlightBoard.tsx": ["renameGroup", "setFlightsConfirmed"],
      "src/components/EntryTermsCard.tsx": ["saveEntryTerms", "setRegistrationApproval"],
      "src/components/ClearScores.tsx": ["clearRoundScores"],
      "src/components/RegistrationClient.tsx": ["setRequirePhone"],
      "src/components/SingleMatchRulePicker.tsx": ["setSingleMatchRule"],
      "src/components/ThirdPlaceControl.tsx": ["setThirdPlace"],
      "src/components/BracketModePicker.tsx": ["setBracketMode"],
      "src/components/ScoringClient.tsx": ["saveScoring", "saveTiebreakers"],
      "src/components/QualControl.tsx": ["setQualifyPerGroup", "setQualifyMode"],
      "src/components/MatchTiebreakControl.tsx": ["setMatchTiebreakers"],
    };
    for (const [file, actions] of Object.entries(BESPOKE)) {
      const client = readSource(file);
      for (const action of actions) {
        const calls = client.match(new RegExp(`await ${action}\\(`, "g"))?.length ?? 0;
        const caught = client.match(new RegExp(`caughtUp\\(await ${action}\\(`, "g"))?.length ?? 0;
        expect(calls, `${file}: ${action} is not called`).toBeGreaterThan(0);
        // The "every round" bulk edit in StagesClient awaits inside its own try/catch and reads the answer (`note`): excepted by shape.
        const bulk = file.endsWith("StagesClient.tsx") ? (client.match(new RegExp(`note\\(s\\.id, await ${action}\\(`, "g"))?.length ?? 0) : 0;
        expect(caught + bulk, `${file}: a press of ${action} is not caught up`).toBe(calls);
      }
    }
  });

  it("the banner says the machine's reason and way out, offers the committee correction, and is the only scoped-lock banner", () => {
    const banner = readSource("src", "components", "ScopeLockBanner.tsx");
    expect(banner).toMatch(/\{l\.because\}/);
    expect(banner).toMatch(/\{l\.wayOut\.says\}/);
    expect(banner).toMatch(/locks\.slice\(0, 3\)/);
    expect(banner).toMatch(/<CorrectionButton scopes=\{correctable\} \/>/);
    expect(banner).not.toMatch(/setConfigUnlocked|Unlock setup/);
  });
});
