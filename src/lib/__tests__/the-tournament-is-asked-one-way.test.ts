import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import { importedNames } from "./imported-names";
import {
  GONE,
  GONE_WITH_THE_COLUMN,
  MACHINE_ONLY,
  MACHINE_OWNERS,
  MACHINE_ONLY_EXCEPTIONS,
  OLD_READERS,
  asksOf,
  homesOf,
  identifiersIn,
} from "./retired-readers";

/**
 * THE TOURNAMENT IS ASKED ONE WAY — through `tournamentStatus`. A WALL over all of `src`
 * since state machine PR 9a (14 Nov).
 *
 * The state machine (proposal 3 Nov, section 5a; PR 1) answers "which step is it on, what is
 * next, what is locked". On main on 3 Nov 26 readers answered those questions. This file was a
 * RATCHET over `src/app` and `src/components` (`KNOWN_STRAYS`, 17 screens) until PR 5b emptied
 * it on 7 Nov; PR 9a deleted the dead twins the shadow test kept and made it a WALL over
 * `src/app`, `src/components` AND `src/lib`, in four classes. The names are in ONE list,
 * `retired-readers.ts`, which the other two sweeps read too.
 *
 *   A  GONE — a deleted reader's name, as an identifier, anywhere in src (tests included),
 *      e2e or scripts: imported, declared, destructured from an `await import`, or called.
 *   B  MACHINE ONLY — a live rule only the machine and the old modules may ask
 *      (`MACHINE_OWNERS`), with one named exception.
 *   C  THE STEP'S READERS — the nine files of PR 6 decide nothing about the step (below).
 *   D  A STORED STATUS COMPARED BY HAND with "draft" or "live", on any receiver, either way
 *      round, or a list of them asked `.includes(…)` — three named exceptions, capped.
 *      "registration" and "ready" are PR 8's (`no-tournament-keeps-an-old-word.test.ts`);
 *      "completed" is the one step the stored word decides alone (`isFinished`).
 *      KNOWN LIMIT: D reads the SPELLING `status` / `eventStatus` beside a word, not the value.
 *      A regular expression cannot follow one, so these pass it: `const s = event.status;
 *      if (s === "live")`, `switch (event.status) { case "live": }`, a renamed destructure
 *      (`const { status: where } = event`), and a named list (`EARLY.includes(event.status)`).
 *      None exists in src/app, src/components or src/lib (searched at PR 9a); review is the
 *      wall for them, and `switch (…status) … case "draft"|"live"` joins D as a fourth shape
 *      with the second half of 9a.
 *
 * Source is read through `readSource` (comments out) or, for class A, by the TypeScript
 * parser, so a comment or a string naming a reader is never a use of it. Each class has a
 * planted CONTROL below proving it can see a second copy.
 */

/** The names a source file imports — one reader, shared with `the-actions-ask-the-machine.test.ts`. */
export { importedNames };

/**
 * The hand-written spellings of "is it set up yet" on a SCREEN: a status compared with a
 * pre-launch word, or a list of them asked `.includes(…)`. Never
 * `playerCountMode === "registration"` — the trap of section 4a: a different column with the
 * same word — and never another thing's status (`view.handicap.status === "ready"`, the
 * handicap body's link): only a bare `status` or a tournament's (`event.status`, `e.status`,
 * `ev.status`, `tournament.status`, `state.event.status`).
 */
const EVENT_STATUS = String.raw`(?:(?<![\w.])|(?<![\w.])(?:state\.)?(?:event|ev|e|tournament)\??\.)status`;
const HAND_SPELLED = [
  new RegExp(String.raw`${EVENT_STATUS}\s*[!=]==\s*["'](?:draft|registration|ready)["']`),
  new RegExp(String.raw`\[\s*["'](?:draft|registration|ready)["'][^\]]*\]\s*\.includes\(\s*${EVENT_STATUS}\b`),
];

/** What a screen does that the machine should answer: the old readers it imports, and any hand spelling. */
export function strays(src: string): string[] {
  const found = importedNames(src).filter((n) => (OLD_READERS as readonly string[]).includes(n));
  if (HAND_SPELLED.some((re) => re.test(src))) found.push("(a hand-spelled status test)");
  return [...new Set(found)];
}

/* ---------------------------------------------------------------- class B */

/** The owners that declare a class-B name — what an `export * from` would launder one out of. */
const MACHINE_HOMES = homesOf(MACHINE_OWNERS, readSource, MACHINE_ONLY);

/** The class-B names a file asks that it may not: none for an owner, less its listed exception. */
export function machineOnlyStrays(path: string, src: string): string[] {
  if (MACHINE_OWNERS.includes(path)) return [];
  const allowed = MACHINE_ONLY_EXCEPTIONS[path]?.names ?? [];
  return asksOf(path, src, MACHINE_ONLY, MACHINE_HOMES).filter((n) => !allowed.includes(n));
}

/* ---------------------------------------------------------------- class D */

const DRAFT_OR_LIVE = `["'](?:draft|live)["']`;
const STATUS_NAME = String.raw`\b(?:status|eventStatus)\b`;
/** Every hand comparison of a stored status with "draft" or "live", in a file's code. */
const HAND_COMPARED = new RegExp(
  [
    String.raw`\b(?:status|eventStatus)\s*[!=]==?\s*${DRAFT_OR_LIVE}`,
    String.raw`${DRAFT_OR_LIVE}\s*[!=]==?\s*[\w$.?()[\]\s]*${STATUS_NAME}`,
    String.raw`\[[^\]]*${DRAFT_OR_LIVE}[^\]]*\]\s*\.includes\(\s*[\w$.?()[\]]*${STATUS_NAME}`,
  ].join("|"),
  "g",
);

export function handCompared(src: string): string[] {
  return [...src.matchAll(HAND_COMPARED)].map((m) => m[0].replace(/\s+/g, " "));
}

/**
 * THE THREE FILES ALLOWED ONE, exactly, each for its reason. A fourth file is a decision for
 * the tournament director, not an edit (the test caps the map); a count that changes, either
 * way, fails — a listed comparison that has gone says "lower the count, or delete the line".
 */
const HAND_COMPARED_EXCEPTIONS: Readonly<Record<string, { count: number; reason: string }>> = {
  "src/lib/domain/club-event-card.ts": { count: 2, reason: "the member's list band reads the stored word, by PR 6's ruling" },
  "src/lib/domain/landing-event.ts": { count: 1, reason: "the landing page's demo ordering" },
  "src/lib/domain/owner-metrics.ts": { count: 1, reason: "a count row keyed by status — not a tournament being asked where it is" },
};

/* ------------------------------------------------------------ what is swept */

function walk(dir: string, opts: { tests: boolean; ext: RegExp }, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      if (!opts.tests && entry.name === "__tests__") continue;
      walk(p, opts, out);
    } else if (opts.ext.test(p) && (opts.tests || !/\.test\.tsx?$/.test(p))) {
      out.push(p.replace(/\\/g, "/"));
    }
  }
  return out;
}

/** Classes B and D: every non-test `.ts`/`.tsx` under `src/app`, `src/components` and `src/lib`. */
function swept(): string[] {
  const opts = { tests: false, ext: /\.tsx?$/ };
  return ["src/app", "src/components", "src/lib"].flatMap((d) => walk(d, opts)).sort();
}

/** Class A: everything under `src` (tests included), `e2e` and `scripts`. */
function everywhere(): string[] {
  const opts = { tests: true, ext: /\.(tsx?|mjs|cjs|js)$/ };
  return ["src", "e2e", "scripts"].flatMap((d) => walk(d, opts)).sort();
}

/** The screens: `src/app` and `src/components`, as the sweep has read them since PR 3. */
function screens(): string[] {
  return swept().filter((f) => f.startsWith("src/app/") || f.startsWith("src/components/"));
}

/* ------------------------------------------------------------------ tests */

describe("the wall: what is swept (controls)", () => {
  const files = swept();

  it("CONTROL C7: the wall reaches src/lib as well as the screens, and no test file is in it", () => {
    expect(files.length, "the sweep found too few files — it is reading nothing").toBeGreaterThan(800);
    expect(files).toContain("src/lib/domain/field-change.ts");
    expect(files).toContain("src/lib/services/whats-next.ts");
    expect(files).toContain("src/app/actions/tournament.ts");
    expect(files).toContain("src/components/LifecycleBar.tsx");
    expect(files.filter((f) => f.includes("/__tests__/") || /\.test\.tsx?$/.test(f))).toEqual([]);
    // Class A reads further: the tests, the browser specs and the scripts.
    const all = everywhere();
    expect(all).toContain("src/lib/__tests__/launch-reads-setup.audit.test.ts");
    expect(all).toContain("e2e/fixture.mjs");
    expect(all).toContain("scripts/qa/specs-by-area.mjs");
  });

  it("CONTROL C8: every owner and every exception file exists and holds code", () => {
    for (const f of [...MACHINE_OWNERS, ...Object.keys(MACHINE_ONLY_EXCEPTIONS), ...Object.keys(HAND_COMPARED_EXCEPTIONS)]) {
      expect(readSource(f).length, `${f} is empty or missing`).toBeGreaterThan(0);
    }
  });
});

describe("class A — the deleted readers are gone, in any role, everywhere", () => {
  it("CONTROL C2: a twin written again under its old name is seen — declared, not imported", () => {
    const planted = `export function tournamentPhase(f: { status: string }) { return f.status; }`;
    expect(identifiersIn("src/lib/domain/zz-twin.ts", planted, GONE)).toEqual(["tournamentPhase"]);
  });

  it("CONTROL C3: a twin taken out of an await import is seen — and the import reader alone would miss it", () => {
    const planted = `const { launchCheckFor } = await import("@/lib/services/setup-flow");`;
    expect(identifiersIn("src/lib/__tests__/zz.audit.test.ts", planted, GONE)).toEqual(["launchCheckFor"]);
    // WHY this class is not import-only: two audit tests reached a dead twin exactly this way.
    expect(importedNames(planted)).toEqual([]);
  });

  it("CONTROL: a comment, a string or a regular expression naming one is not a use of it", () => {
    const prose = [
      `// nextLifecycleAction was deleted in PR 9a`,
      `/** \`lifecycleMismatch\` is the machine's underWayUnlaunched now */`,
      `const why = "launchCheckFor was the flow's own verdict";`,
      `expect(service).not.toMatch(/datesPassedUnlaunched|isLaunched/);`,
    ].join("\n");
    expect(identifiersIn("src/lib/zz.ts", prose, GONE)).toEqual([]);
  });

  it("no file in src, e2e or scripts names a deleted reader", () => {
    const found = everywhere()
      .map((f) => [f, goneIn(f, readFileSync(f, "utf8"))] as const)
      .filter(([, ids]) => ids.length > 0)
      .map(([f, ids]) => `${f}: ${ids.join(", ")}`);
    expect(
      found,
      "these were deleted — ask tournamentStatus(facts) (its refusals, nextAction, step, underWayUnlaunched); a lock asks setupLockedByLaunch(status, family), a test opens one part with openCorrectionOn",
    ).toEqual([]);
  });

  /**
   * THE BLANKET UNLOCK (PR 9b). Its flag is named nowhere as an identifier — no fixture can lean
   * on it, no reader can come back — except in the two files that must name the COLUMN until it
   * is dropped (`GONE_WITH_THE_COLUMN`). A test that needs an old-flag row writes it in SQL.
   */
  it("CONTROL C9: the flag as a fixture's property, a read or a select is seen; in SQL, a regular expression or a comment it is not", () => {
    for (const line of [
      `await prisma.event.create({ data: { name: "zz", status: "live", configUnlocked: true } });`,
      `if (event.configUnlocked) return;`,
      `select: { status: true, configUnlocked: true },`,
      `const locked = configurationLocked(event);`,
      `await setConfigUnlocked(false);`,
    ]) {
      expect(goneIn("src/lib/__tests__/zz.audit.test.ts", line).length, line).toBe(1);
    }
    for (const line of [
      `await prisma.$executeRawUnsafe('UPDATE "Event" SET "configUnlocked" = true WHERE id = $1', id);`,
      `const CONFIG_UNLOCKED = /!\\w*\\.?configUnlocked/;`,
      `// configUnlocked was read until PR 9b`,
      `for (const f of ["status", "configUnlocked"]) expect(copy).not.toHaveProperty(f);`,
    ]) {
      expect(goneIn("src/lib/__tests__/zz.audit.test.ts", line), line).toEqual([]);
    }
    // The column's exceptions cover the flag, in their own file only.
    expect(goneIn("src/lib/services/clone.ts", `const NOT_CLONED = { configUnlocked: "why" };`)).toEqual([]);
    expect(goneIn("src/lib/services/zz.ts", `const NOT_CLONED = { configUnlocked: "why" };`)).toEqual(["configUnlocked"]);
    expect(goneIn("src/lib/services/clone.ts", `configurationLocked(e);`)).toEqual(["configurationLocked"]);
  });

  it("the column's exceptions still hold, are two, and go with the column (9d)", () => {
    expect(Object.keys(GONE_WITH_THE_COLUMN).length, "a third file naming the retired flag is a decision, not an edit").toBeLessThanOrEqual(2);
    for (const [f, { names }] of Object.entries(GONE_WITH_THE_COLUMN)) {
      expect(identifiersIn(f, readFileSync(f, "utf8"), names), `${f} no longer names it — delete its line in retired-readers.ts`).toEqual([...names].sort());
    }
  });
});

/** A file's class-A identifiers, less what its column exception allows. */
function goneIn(path: string, text: string): string[] {
  const allowed = GONE_WITH_THE_COLUMN[path]?.names ?? [];
  return identifiersIn(path, text, GONE).filter((n) => !allowed.includes(n));
}

describe("class B — the old modules' live rules are asked only by the machine", () => {
  it("CONTROL C4: an import of one is seen outside the owners, renamed or not, and not inside them", () => {
    const planted = `import { playRefusal as refused } from "../domain/phase-gate";`;
    expect(machineOnlyStrays("src/lib/services/zz.ts", planted)).toEqual(["playRefusal"]);
    expect(machineOnlyStrays("src/lib/domain/tournament-status.ts", planted)).toEqual([]);
    // Taken out of an await import, or called by name, is asking it too.
    expect(machineOnlyStrays("src/app/zz.ts", `const { statusMove } = await import("@/lib/domain/phase-gate");`)).toEqual(["statusMove"]);
    expect(machineOnlyStrays("src/app/zz.ts", `const verdict = launchRefusal(facts);`)).toEqual(["launchRefusal"]);
    // The named exception covers its one name, and only in its one file.
    expect(machineOnlyStrays("src/lib/domain/tournament-name.ts", `import { PRE_LAUNCH_STATUSES } from "./lifecycle-state";`)).toEqual([]);
    expect(machineOnlyStrays("src/lib/domain/tournament-name.ts", `import { EVENT_STATUSES } from "./lifecycle-state";`)).toEqual(["EVENT_STATUSES"]);
    // A property of that name on something else is not asking the rule.
    expect(machineOnlyStrays("src/app/zz.ts", `const said = flow.launchCheck.refusal;`)).toEqual([]);
  });

  /**
   * CONTROL C4, continued (the Principal Engineer's review of #1156, C1): the shapes that reach a
   * class-B name WITHOUT naming it in an import specifier or calling it bare. Each was planted
   * against the first version of `asksOf` and was not seen; a re-export under a new name would
   * launder the rule for every later importer.
   */
  it.each([
    ["a namespace import, called through", `import * as gate from "../domain/phase-gate";\ngate.statusMove(a, b);`, ["statusMove"]],
    ["a namespace import, read but not called", `import * as gate from "../domain/lifecycle-state";\nconst all = gate.EVENT_STATUSES;`, ["EVENT_STATUSES"]],
    ["a namespace import, by element access", `import * as gate from "../domain/phase-gate";\nconst move = gate["statusMove"];`, ["statusMove"]],
    ["a whole-module await import, called through", `const m = await import("../domain/phase-gate");\nm.playRefusal(f);`, ["playRefusal"]],
    ["a whole-module await import, taken apart later", `const mod = await import("@/lib/domain/phase-gate");\nconst { statusMove: mv } = mod;`, ["statusMove"]],
    ["an await import called on the spot", `const verdict = (await import("@/lib/domain/phase-gate")).statusMove(a, b);`, ["statusMove"]],
    ["an import(...).then with the module as one parameter", `import("../domain/launch-check").then((mod) => mod.launchCheck(f));`, ["launchCheck"]],
    ["a re-export under a new name", `export { statusMove as move } from "../domain/phase-gate";`, ["statusMove"]],
    ["a re-export under its own name", `export { statusMove } from "../domain/phase-gate";`, ["statusMove"]],
    ["export * from an owner, relative", `export * from "../domain/phase-gate";`, [`export * from "../domain/phase-gate"`]],
    ["export * from an owner, by the @ alias", `export * from "@/lib/domain/lifecycle-state";`, [`export * from "@/lib/domain/lifecycle-state"`]],
    ["export * as a namespace from an owner", `export * as gate from "../domain/setup-flow";`, [`export * from "../domain/setup-flow"`]],
  ] as const)("CONTROL C4: %s is seen outside the owners", (_shape, planted, expected) => {
    expect(machineOnlyStrays("src/lib/services/zz.ts", planted)).toEqual([...expected]);
    expect(machineOnlyStrays("src/lib/domain/tournament-status.ts", planted)).toEqual([]);
  });

  it("CONTROL C4: the homes an export * is checked against are the four old modules, not the machine", () => {
    expect([...MACHINE_HOMES].sort()).toEqual([
      "src/lib/domain/launch-check.ts",
      "src/lib/domain/lifecycle-state.ts",
      "src/lib/domain/phase-gate.ts",
      "src/lib/domain/setup-flow.ts",
    ]);
  });

  it("CONTROL C4: a namespace or a re-export of anything else is not asking a class-B rule", () => {
    for (const line of [
      `export * from "../domain/tournament-name";`,
      `export * from "./format";`,
      // The machine is an owner but holds no class-B name: re-exporting it launders nothing.
      `export * from "@/lib/domain/tournament-status";`,
      `import * as words from "../domain/date-words";\nwords.statusLabel(a);`,
      `const said = flow.statusMove(a);`,
      `export { tournamentStatus as status } from "../domain/tournament-status";`,
    ]) {
      expect(machineOnlyStrays("src/lib/services/zz.ts", line), line).toEqual([]);
    }
  });

  it("nobody but the machine and the old modules asks them", () => {
    const found = swept()
      .map((f) => [f, machineOnlyStrays(f, readSource(f))] as const)
      .filter(([, n]) => n.length > 0)
      .map(([f, n]) => `${f}: ${n.join(", ")}`);
    expect(found, "ask tournamentStatus(facts) instead (refusals.launch / .complete / .play, statusRequestOf, the step)").toEqual([]);
  });

  it("each exception still holds — a listed name its file no longer asks comes off the list", () => {
    for (const [f, { names }] of Object.entries(MACHINE_ONLY_EXCEPTIONS)) {
      expect(asksOf(f, readSource(f), names), `delete the line for ${f} in retired-readers.ts`).toEqual([...names].sort());
    }
  });
});

describe("class D — a tournament's stored status is not compared by hand", () => {
  it("CONTROL C1: the deleted twin's own line is seen", () => {
    expect(handCompared(`if (facts.status === "live") return { label: "Make results final", kind: "status", to: "completed" };`)).toHaveLength(1);
  });

  it("CONTROL C5: on any receiver, either way round, and as a list asked .includes", () => {
    expect(handCompared(`const on = row.eventStatus === "live";`)).toHaveLength(1);
    expect(handCompared(`const first = "draft" === rows[0].status;`)).toHaveLength(1);
    expect(handCompared(`const early = ["draft"].includes(e.status);`)).toHaveLength(1);
    expect(handCompared(`if (event.status !== "draft") return;`)).toHaveLength(1);
  });

  it("CONTROL C6: never another column, another thing's status, the step, or the completed word", () => {
    for (const line of [
      `if (event.playerCountMode === "registration") return;`,
      `const mine = entrants.filter((p) => p.status === "confirmed");`,
      `const connected = view.handicap.status === "ready";`,
      `if (st.step === "live") return job;`,
      `const card = c.status === "entered";`,
      `const done = isFinished(event.status);`,
      `const over = event.status === "completed";`,
      `import { tournamentStatus } from "../domain/tournament-status";`,
    ]) {
      expect(handCompared(line), line).toEqual([]);
      expect(machineOnlyStrays("src/lib/services/zz.ts", line), line).toEqual([]);
      expect(identifiersIn("src/lib/services/zz.ts", line, GONE), line).toEqual([]);
    }
  });

  it("only the three listed files compare one, each exactly as often as listed", () => {
    expect(Object.keys(HAND_COMPARED_EXCEPTIONS).length, "a fourth exception is the tournament director's decision, not an edit").toBeLessThanOrEqual(3);
    const found: string[] = [];
    for (const f of swept()) {
      const hits = handCompared(readSource(f));
      const allowed = HAND_COMPARED_EXCEPTIONS[f]?.count ?? 0;
      if (hits.length !== allowed) found.push(`${f}: ${hits.length} (allowed ${allowed}) — ${hits.join(" | ")}`);
    }
    expect(found, "read the step from tournamentStatus (isLaunched / isFinished at most); a listed count that fell: lower it or delete the line").toEqual([]);
  });
});

describe("a screen asks the tournament one way (since PR 3; a wall since PR 5b emptied its list)", () => {
  it("CONTROL: the matcher sees what it is looking for, and nothing it is not", () => {
    // 1. A one-line import of an old reader.
    expect(strays(`import { configurationLocked } from "@/lib/domain/lifecycle-state";`)).toEqual(["configurationLocked"]);
    // 2. A three-line import naming one on its middle line.
    expect(strays(`import {\n  isFinished,\n  setupChecklist,\n  isLaunched,\n} from "@/lib/services/checklist";`)).toEqual(["setupChecklist"]);
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

  it("no screen or component imports an old reader or spells a status by hand", () => {
    const files = screens();
    expect(files.length, "no screens found — the sweep is broken").toBeGreaterThan(100);
    const found = files.filter((f) => strays(readSource(f)).length > 0).map((f) => `${f}: ${strays(readSource(f)).join(", ")}`);
    expect(found, "these ask an old reader instead of tournamentStatus(facts)").toEqual([]);
  });
});

/**
 * CLASS C — THE SCREENS THAT READ THE STEP, AND NOTHING ELSE (PR 6; readers #18, #19, #8 and
 * #3 of the proposal's table). The secretary's home, the player switcher's note, the public
 * event page's phase and the Tournaments list's status word each decided "where is this
 * tournament" for itself — and a knockout with its Final decided was "Live" on all four (D3).
 * They now read `tournamentStatus(facts)` (the home its `nextAction`; the other three its step
 * through `tournamentStepsFor` / `stepOf`).
 *
 * On these files a second reader of the step is refused outright. Wider than the screens,
 * because the deciding was done in the services and domain modules behind them, and stricter:
 *
 *   - no old reader, nor the chip's words keyed by the stored status (`STATUS_META`), nor
 *     `isLaunched` — the stored half of a step the machine refines (results in unlaunched,
 *     play over);
 *   - no stored status compared by hand with ANY of its words, under any name
 *     (`row.eventStatus === "live"` was the switcher's).
 *
 * `isFinished` is allowed: "completed" is the one step the stored word decides alone (the
 * machine's own `step` is "completed" exactly when it is), and the home asks it only to leave a
 * completed tournament out of the read.
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

const STEP_DECIDERS = [...OLD_READERS, "STATUS_META", "isLaunched"] as const;

/**
 * A stored status, on any receiver (`row.eventStatus`, `(row as X).status`, `rows[0].status`)
 * and either way round, compared with any of its words. Never `p.status === "confirmed"`: a
 * player's status has other words.
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
 * And the one service the switcher's rows come from (`clubEventsFor`) keeps the member's
 * events list's own readers (its bands, `openToMembers`, `canView`), which are not the step —
 * but it may not ask `playOverOf` again, the reader the switcher's note was built on.
 */
const SWITCHER_SOURCE = "src/lib/services/club-events.ts";

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
