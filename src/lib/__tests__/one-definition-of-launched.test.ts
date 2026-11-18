import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * "LAUNCHED" AND "LOCKED" ARE EACH SAID IN ONE PLACE.
 *
 * `lifecycle-state.ts` has always owned `PRE_LAUNCH_STATUSES`, and its comment
 * has always said why: "a second copy is how the two would come to disagree
 * about what launched means." Seven places then wrote one, spelling
 * `status === "live" || status === "completed"` by hand — and four of those
 * went on to `&& !configUnlocked`, which is `isSetupLocked`, written out a
 * fifth time in four other files.
 *
 * THE MECHANISM WAS NOT CARELESSNESS, which is why a sweep is the right answer
 * rather than a note. `isSetupLocked` lived in `page-helpers.ts`, which is
 * `server-only` — so `LifecycleBar`, a client component, could not have called
 * it however much it wanted to. The rule was unreachable from half the app,
 * and the copies are what that looks like. Both predicates live in
 * `domain/lifecycle-state.ts` now, where both halves can reach them.
 *
 * AND THE TWO SPELLINGS ARE NOT THE SAME RULE. `isLaunched` is "not on the
 * pre-launch list"; the hand-written pair is "one of these two". They agree
 * today only because the two sets happen to cover every status, and a sixth —
 * a paused or abandoned tournament — would split them silently and in opposite
 * directions on different screens. See the test in
 * `domain/__tests__/lifecycle-state.test.ts` that asserts the divergence.
 */

/** The module that is allowed to say it, because it is where the list lives. */
const OWNER = "src/lib/domain/lifecycle-state.ts";

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "__tests__") walk(p);
      } else if (/\.tsx?$/.test(p)) {
        out.push(p.replace(/\\/g, "/"));
      }
    }
  };
  walk("src");
  return out;
}

/**
 * Read through `readSource`, which strips comments — and it matters here more
 * than usual. Several of these files EXPLAIN the old spelling in prose, and
 * `lifecycle-state`'s own header quotes it twice. A raw read would report the
 * explanations as the offence and the sweep would be unpassable.
 */
const files = sourceFiles().filter((f) => f !== OWNER);

/** `status === "live" || …=== "completed"`, in any of its spellings. */
const HAND_WRITTEN = /status === "live"\s*\|\|/;

describe("what launched means is written once", () => {
  it("has files to sweep, and the owner is excluded — the sweep's own control", () => {
    expect(files.length, "no source files found — the sweep is broken").toBeGreaterThan(100);
    expect(files, "the owner should be excluded, not swept").not.toContain(OWNER);
    expect(() => readSource(OWNER), "the owner module is missing").not.toThrow();
  });

  it("recognises the hand-written spelling — the matcher's control", () => {
    /**
     * The instrument, against a line in exactly the shape the seven took.
     * Without this a clean sweep is equally the answer from a pattern that has
     * stopped matching, which is how this file would quietly stop working.
     */
    expect(HAND_WRITTEN.test(`const locked = (status === "live" || status === "completed");`)).toBe(
      true,
    );
  });

  it.each(files)("%s does not spell it out again", (file) => {
    expect(
      HAND_WRITTEN.test(readSource(file)),
      `this decides "has it launched" by hand. Ask isLaunched() from ` +
        `domain/lifecycle-state — it is derived from PRE_LAUNCH_STATUSES, which ` +
        `is the list that actually defines it, and the pair written here is its ` +
        `inverse rather than the same rule.`,
    ).toBe(false);
  });
});

describe("what locked means is written once", () => {
  /**
   * THE ONE PREDICATE, SINCE STATE MACHINE PR 9b: `setupLockedByLaunch(status, family)` in the
   * machine — launched, and not a casual round (proposal 8.2, "Casual: locks none"). Until 9b it
   * was `configurationLocked`, launched AND not unlocked by the retired blanket flag, and a casual
   * round was open only because `createMatch` wrote that flag. Both arguments are REQUIRED, so the
   * compiler lists every caller the day the rule grows.
   */
  const ONE = /\bsetupLockedByLaunch\(/;
  /** A second spelling of the casual half beside a launched test: `isLaunched(…) && …"casual"`, either order. */
  const CASUAL_BESIDE_LAUNCHED = /isLaunched\([^)]*\)[^;\n]*["']casual["']|["']casual["'][^;\n]*isLaunched\(/;

  it("CONTROL: the matcher sees a second casual clause beside a launched test, and nothing else", () => {
    expect(CASUAL_BESIDE_LAUNCHED.test(`return isLaunched(f.status) && family !== "casual";`)).toBe(true);
    expect(CASUAL_BESIDE_LAUNCHED.test(`const open = f.family === "casual" || !isLaunched(f.status);`)).toBe(true);
    expect(CASUAL_BESIDE_LAUNCHED.test(`if (family === "casual") return 8;`)).toBe(false);
    expect(CASUAL_BESIDE_LAUNCHED.test(`const live = isLaunched(event.status);`)).toBe(false);
  });

  it("nobody but the machine writes the casual half beside a launched test", () => {
    const offenders = files.filter((f) => f !== "src/lib/domain/tournament-status.ts" && CASUAL_BESIDE_LAUNCHED.test(readSource(f)));
    expect(offenders, "ask setupLockedByLaunch(status, family) instead").toEqual([]);
    // And the machine writes it exactly once, in the predicate.
    const machine = readSource("src/lib/domain/tournament-status.ts");
    expect(machine).toMatch(/export function setupLockedByLaunch\(status: string, family: Family\): boolean \{\s*return isLaunched\(status\) && family !== "casual";\s*\}/);
    expect(machine.match(new RegExp(CASUAL_BESIDE_LAUNCHED.source, "g")) ?? []).toHaveLength(1);
  });

  it("every caller passes both, and none hands it a family by hand", () => {
    const callers = files.filter((f) => ONE.test(readSource(f)));
    // The machine's locks and the one field rule (four readings there): the readers the predicate replaced.
    expect(callers.sort()).toEqual(["src/lib/domain/field-change.ts", "src/lib/domain/tournament-status.ts"]);
    for (const f of callers) {
      const calls = [...readSource(f).matchAll(/\bsetupLockedByLaunch\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)].map((m) => m[1]);
      for (const args of calls.filter((a) => !/:\s*string/.test(a))) {
        expect(args.split(",").length, `${f}: setupLockedByLaunch(${args}) — both arguments`).toBe(2);
        expect(args, `${f}: setupLockedByLaunch(${args}) — a literal family is the rule written again`).not.toMatch(/["']/);
      }
    }
    expect(readSource("src/lib/domain/field-change.ts").match(/\bsetupLockedByLaunch\(/g) ?? []).toHaveLength(4);
  });

  it("the deleted readers hold no copy of the question (PR 5b), and LifecycleBar reads the machine's lock", () => {
    for (const file of ["src/lib/page-helpers.ts", "src/lib/services/action-shared.ts"]) {
      expect(readSource(file), `${file} has grown a lock of its own again`).not.toMatch(/configUnlocked|isSetupLocked\(|assertUnlocked\(|lockedRefusal\(/);
    }
    // The roster's two copies read the field rule: neither a copy nor a lost check.
    expect(readSource("src/app/actions/roster.ts")).toMatch(/await fieldRefusal\(eventId, "add"\)/);
    expect(readSource("src/app/(app)/roster/page.tsx")).toMatch(/await fieldRefusal\(session\.eventId, "add"\)/);
    // …and `LifecycleBar`, the fifth copy, reads the machine's lock rather than asking it again.
    expect(readSource("src/components/LifecycleBar.tsx")).toMatch(/const locked = status\.locked;/);
    expect(readSource("src/lib/domain/tournament-status.ts")).toMatch(/locked: st\.locks\.details\.locked,/);
  });
});
