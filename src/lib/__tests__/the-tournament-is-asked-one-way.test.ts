import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import { importedNames } from "./imported-names";

/**
 * A SCREEN ASKS THE TOURNAMENT ONE WAY — through `tournamentStatus`.
 *
 * The state machine (proposal 3 Nov, section 5a; PR 1) answers "which step is
 * it on, what is next, what is locked". On main 26 readers answer those
 * questions, and a screen that imports one of them is a screen holding its own
 * answer. This sweep is a RATCHET, not a wall: `KNOWN_STRAYS` is every screen
 * and component that imports an old reader today. It fails when a file is
 * ADDED to that set — a new screen going round the machine — and when a listed
 * file no longer imports one, so the line comes out in the PR that freed it.
 * PR 9 empties the list.
 *
 * Only `src/app` and `src/components` are swept: the old modules themselves,
 * the services that wrap them and the machine may still import them while
 * they remain. Source is read through `readSource`, so a comment naming an old
 * reader is not an import of it.
 */

const OLD_READERS = [
  "nextLifecycleAction",
  "tournamentPhase",
  "lifecycleMismatch",
  "setupChecklist",
  "isUnstarted",
  "setupFlowFor",
  "launchCheckFor",
  "finishRefusal",
  "completingCheckFor",
  "statusMove",
  "playRefusal",
  "playRefusalFor",
  "configurationLocked",
  "isSetupLocked",
  "assertUnlocked",
  "lockedRefusal",
  "PRE_LAUNCH_STATUSES",
  "EVENT_STATUSES",
  "playOverOf",
] as const;

/** The names a source file imports — one reader, shared with `the-actions-ask-the-machine.test.ts`. */
export { importedNames };

/**
 * The hand-written spellings of "is it set up yet": a status compared with a
 * pre-launch word, or a list of them asked `.includes(…)`. Never
 * `playerCountMode === "registration"` — the trap of section 4a: a different
 * column with the same word — and never another thing's status
 * (`view.handicap.status === "ready"`, the handicap body's link): only a bare
 * `status` or a tournament's (`event.status`, `e.status`, `ev.status`,
 * `tournament.status`, `state.event.status`).
 */
const EVENT_STATUS = String.raw`(?:(?<![\w.])|(?<![\w.])(?:state\.)?(?:event|ev|e|tournament)\??\.)status`;
const HAND_SPELLED = [
  new RegExp(String.raw`${EVENT_STATUS}\s*[!=]==\s*["'](?:draft|registration|ready)["']`),
  new RegExp(String.raw`\[\s*["'](?:draft|registration|ready)["'][^\]]*\]\s*\.includes\(\s*${EVENT_STATUS}\b`),
];

/** What a file does that the machine should answer: the old readers it imports, and any hand spelling. */
export function strays(src: string): string[] {
  const found = importedNames(src).filter((n) => (OLD_READERS as readonly string[]).includes(n));
  if (HAND_SPELLED.some((re) => re.test(src))) found.push("(a hand-spelled status test)");
  return [...new Set(found)];
}

/**
 * TODAY'S IMPORTERS, 3 Nov 2026 (origin/main at e933a3b5). Cut a line in the
 * same PR that frees its file; never add one.
 *
 * PR 3 (4 Nov) cut four: the dashboard, Prizes & payouts (its rail is
 * `setupRailFor` now), `LifecycleBar` and `TournamentJourney` — they read
 * `tournamentStatus(facts)`. The rest keep `isSetupLocked` / `assertUnlocked`
 * until the scoped locks (PR 5).
 *
 * PR 4 (6 Nov) cut `actions/play.ts`: its five saves and keeping a group's
 * card ask the machine's play refusal (`playRefusedBecause`). `actions/
 * tournament.ts` no longer asks `launchCheckFor`, `statusMove`,
 * `finishRefusal`, `completingCheckFor` or `playRefusalFor` either
 * (`the-actions-ask-the-machine.test.ts` holds that by name), but stays here
 * for `assertUnlocked`, `lockedRefusal` and `configurationLocked` until PR 5.
 *
 * PR 5a (6 Nov) cut three: `actions/teams.ts` and `actions/setup-suggest.ts`
 * ask their scope's lock (`refuseIfLocked`) instead of `assertUnlocked`, and
 * Teams & pairs draws `scopeLockFor(…, "sides")` in a `ScopeLockBanner`
 * instead of `isSetupLocked`.
 */
export const KNOWN_STRAYS: readonly string[] = [
  "src/app/(app)/bracket/page.tsx",
  "src/app/(app)/entry/page.tsx",
  "src/app/(app)/event/page.tsx",
  "src/app/(app)/grouping/page.tsx",
  "src/app/(app)/registration/page.tsx",
  "src/app/(app)/stages/page.tsx",
  "src/app/actions/tournament.ts",
];

/**
 * THE SCREENS THAT READ THE STEP, AND NOTHING ELSE (PR 6; readers #18, #19,
 * #8 and #3 of the proposal's table). The secretary's home, the player
 * switcher's note, the public event page's phase and the Tournaments list's
 * status word each decided "where is this tournament" for itself — and a
 * knockout with its Final decided was "Live" on all four (D3). They now read
 * `tournamentStatus(facts)` (the home its `nextAction`; the other three its step
 * through `tournamentStepsFor` / `stepOf`).
 *
 * This is a WALL, not a ratchet: on these files a second reader of the step is
 * refused outright. Wider than the screens' list above, because the deciding
 * was done in the services and domain modules behind them, and stricter:
 *
 *   - no old reader, and none of the three PR 6 retired (`tournamentPhase`,
 *     `datesPassedUnlaunched`, `playOverOf`), nor the chip's words keyed by the
 *     stored status (`STATUS_META`), nor `isLaunched` — the stored half of a
 *     step the machine refines (results in unlaunched, play over);
 *   - no stored status compared by hand with ANY of its five words, under any
 *     name (`row.eventStatus === "live"` was the switcher's).
 *
 * `isFinished` is allowed: "completed" is the one step the stored word decides
 * alone (the machine's own `step` is "completed" exactly when it is), and the
 * home asks it only to leave a completed tournament out of the read.
 */
export const READS_THE_STEP: readonly string[] = [
  "src/lib/services/whats-next.ts",
  "src/lib/domain/needs-you-now.ts",
  "src/lib/domain/tournament-switcher.ts",
  "src/lib/domain/event-page.ts",
  "src/lib/domain/tournament-step.ts",
  "src/app/live/[token]/event/page.tsx",
  "src/app/(app)/tournaments/page.tsx",
  "src/components/EventSwitcher.tsx",
  "src/components/NeedsYouNow.tsx",
];

const STEP_DECIDERS = [...OLD_READERS, "tournamentPhase", "datesPassedUnlaunched", "STATUS_META", "isLaunched"] as const;

/**
 * A stored status, on any receiver (`row.eventStatus`, `(row as X).status`,
 * `rows[0].status`) and either way round, compared with any of its five words.
 * Never `p.status === "confirmed"`: a player's status has other words.
 */
const STORED_WORD = `["'](?:draft|registration|ready|live|completed)["']`;
const ANY_STORED_WORD = new RegExp(
  String.raw`\b(?:status|eventStatus)\s*[!=]==?\s*${STORED_WORD}|${STORED_WORD}\s*[!=]==?\s*[\w$.?()[\]\s]*\b(?:status|eventStatus)\b`,
);

/** What a step-reading file does that only the machine may: decide the step. */
export function stepDeciders(src: string): string[] {
  const found = importedNames(src).filter((n) => (STEP_DECIDERS as readonly string[]).includes(n));
  if (ANY_STORED_WORD.test(src)) found.push("(a stored status compared by hand)");
  return [...new Set(found)];
}

/**
 * And the one service the switcher's rows come from (`clubEventsFor`) keeps the
 * member's events list's own readers (its bands, `openToMembers`, `canView`),
 * which are not the step — but it may not ask `playOverOf` again, the reader the
 * switcher's note was built on.
 */
const SWITCHER_SOURCE = "src/lib/services/club-events.ts";

function swept(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "__tests__") walk(p);
      } else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) {
        out.push(p.replace(/\\/g, "/"));
      }
    }
  };
  walk("src/app");
  walk("src/components");
  return out.sort();
}

describe("a screen asks the tournament one way", () => {
  const files = swept();

  it("CONTROL: the sweep has files, and the machine's own modules are not among them", () => {
    expect(files.length, "no screens found — the sweep is broken").toBeGreaterThan(100);
    expect(files).not.toContain("src/lib/domain/tournament-status.ts");
    expect(files).not.toContain("src/lib/services/tournament-facts.ts");
  });

  it("CONTROL: the matcher sees what it is looking for, and nothing it is not", () => {
    // 1. A one-line import of an old reader.
    expect(strays(`import { nextLifecycleAction } from "@/lib/domain/lifecycle-state";`)).toEqual(["nextLifecycleAction"]);
    // 2. A three-line import naming one on its middle line.
    expect(strays(`import {\n  isFinished,\n  isSetupLocked,\n  isLaunched,\n} from "@/lib/page-helpers";`)).toEqual(["isSetupLocked"]);
    // 3. The machine itself is not a stray.
    expect(strays(`import { tournamentStatus } from "@/lib/domain/tournament-status";`)).toEqual([]);
    // 4. The trap of section 4a: another column with the same word.
    expect(strays(`if (event.playerCountMode === "registration") return;`)).toEqual([]);
    // Nor another thing's status (HandicapSetup.tsx, the handicap body's link).
    expect(strays(`const connected = view.handicap.status === "ready";`)).toEqual([]);
    // 5. And the hand spellings.
    expect(strays(`const early = event.status === "draft";`)).toEqual(["(a hand-spelled status test)"]);
    expect(strays(`const early = ["draft", "ready"].includes(e.status);`)).toEqual(["(a hand-spelled status test)"]);
    expect(strays(`if (status !== "registration") return;`)).toEqual(["(a hand-spelled status test)"]);
    expect(strays(`const x = state.event.status === "ready";`)).toEqual(["(a hand-spelled status test)"]);
    // A renamed import is still the old reader.
    expect(strays(`import { playOverOf as over } from "@/lib/domain/tournament-switcher";`)).toEqual(["playOverOf"]);
  });

  it("no NEW screen or component goes round the machine", () => {
    const now = files.filter((f) => strays(readSource(f)).length > 0);
    const added = now.filter((f) => !KNOWN_STRAYS.includes(f)).map((f) => `${f}: ${strays(readSource(f)).join(", ")}`);
    expect(
      added,
      "these ask an old reader instead of tournamentStatus(facts). Ask the machine — do not add them to KNOWN_STRAYS.",
    ).toEqual([]);
  });

  it("the list only shrinks: a listed file that no longer asks an old reader comes off it", () => {
    const freed = KNOWN_STRAYS.filter((f) => !files.includes(f) || strays(readSource(f)).length === 0);
    expect(freed, "delete these lines from KNOWN_STRAYS in the-tournament-is-asked-one-way.test.ts").toEqual([]);
  });
});

describe("the home, the switcher, the Tournaments list and the public event page read the step (PR 6)", () => {
  it("CONTROL: the matcher sees a second reader of the step, and not the machine or another status", () => {
    // Each of the four as it was before PR 6, a line from its own source:
    expect(stepDeciders(`import { playOverOf } from "../domain/tournament-switcher";`)).toEqual(["playOverOf"]);
    expect(stepDeciders(`import { isFinished, isLaunched } from "../domain/lifecycle-state";`)).toEqual(["isLaunched"]);
    expect(stepDeciders(`import { isFinished, tournamentPhase } from "./lifecycle-state";`)).toEqual(["tournamentPhase"]);
    expect(stepDeciders(`import { datesPassedUnlaunched } from "@/lib/domain/lifecycle-state";`)).toEqual(["datesPassedUnlaunched"]);
    expect(stepDeciders(`import { STATUS_META } from "@/lib/format";`)).toEqual(["STATUS_META"]);
    expect(stepDeciders(`      ? row.eventStatus === "live"`)).toEqual(["(a stored status compared by hand)"]);
    expect(stepDeciders(`const done = e.status !== "completed";`)).toEqual(["(a stored status compared by hand)"]);
    // On any receiver, and either way round — the shape, not one spelling of it.
    expect(stepDeciders(`return (row as { eventStatus?: string }).eventStatus === "live";`)).toEqual(["(a stored status compared by hand)"]);
    expect(stepDeciders(`const first = rows[0].status == "draft";`)).toEqual(["(a stored status compared by hand)"]);
    expect(stepDeciders(`if ("live" === row.eventStatus) return;`)).toEqual(["(a stored status compared by hand)"]);
    // Not deciders: the machine, the stored word that IS the completed step, a player's status, a step.
    expect(stepDeciders(`import { tournamentStatus } from "../domain/tournament-status";`)).toEqual([]);
    expect(stepDeciders(`import { isFinished } from "../domain/lifecycle-state";`)).toEqual([]);
    expect(stepDeciders(`const mine = entrants.filter((p) => p.status === "confirmed");`)).toEqual([]);
    expect(stepDeciders(`if (st.step === "play-over" && next.kind === "complete") return job;`)).toEqual([]);
    expect(stepDeciders(`const card = c.status === "entered";`)).toEqual([]);
  });

  it("CONTROL: every listed file exists, and each one asks the machine", () => {
    for (const f of READS_THE_STEP) {
      const src = readSource(f);
      expect(src.length, `${f} is empty or missing`).toBeGreaterThan(0);
    }
    // The four readers themselves, by the name they ask the machine with.
    expect(readSource("src/lib/services/whats-next.ts")).toMatch(/tournamentStatus\(/);
    expect(readSource("src/lib/domain/needs-you-now.ts")).toMatch(/st\.nextAction/);
    expect(readSource("src/lib/services/club-events.ts")).toMatch(/tournamentStepsFor\(/);
    expect(readSource("src/app/live/[token]/event/page.tsx")).toMatch(/tournamentStepsFor\(/);
    expect(readSource("src/app/(app)/tournaments/page.tsx")).toMatch(/tournamentStepsFor\(/);
  });

  it("none of them decides the step a second way", () => {
    const found = READS_THE_STEP.map((f) => [f, stepDeciders(readSource(f))] as const)
      .filter(([, d]) => d.length > 0)
      .map(([f, d]) => `${f}: ${d.join(", ")}`);
    expect(found, "read the step from tournamentStatus (stepOf / tournamentStepsFor / nextAction) instead").toEqual([]);
  });

  it("the switcher's rows are not built on playOverOf again", () => {
    expect(importedNames(readSource(SWITCHER_SOURCE))).not.toContain("playOverOf");
    // CONTROL: the check reads the file it names.
    expect(importedNames(readSource(SWITCHER_SOURCE))).toContain("tournamentStepsFor");
  });
});
