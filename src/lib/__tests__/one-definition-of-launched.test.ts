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
   * The composite, which is the one that was really being copied: launched AND
   * not deliberately unlocked. A screen offering a control the server refuses
   * is a bug report filed against the wrong thing, and that is what five
   * copies of this buy you.
   */
  const CONFIG_UNLOCKED = /!\w*\.?configUnlocked/;

  it("nobody pairs a status test with a configUnlocked test by hand", () => {
    const offenders = files.filter((f) => {
      const src = readSource(f);
      return HAND_WRITTEN.test(src) && CONFIG_UNLOCKED.test(src);
    });
    expect(
      offenders,
      `these decide "is the configuration locked" by hand. Ask ` +
        `configurationLocked() — or isSetupLocked() on the server, which now ` +
        `delegates to it.`,
    ).toEqual([]);
  });

  it("finds the callers that should be asking — the sweep's own control", () => {
    /**
     * "Nobody writes it by hand" is also true of an app where nobody asks the
     * question at all. These are the five that were copies, and they must now
     * be readers: if one stops calling the shared predicate, it has either
     * gone back to a copy or lost the check entirely, and both are worth a
     * failure.
     */
    const readers = [
      "src/lib/page-helpers.ts",
      "src/lib/services/action-shared.ts",
      "src/app/actions/roster.ts",
      "src/app/(app)/roster/page.tsx",
      "src/components/LifecycleBar.tsx",
    ];
    for (const file of readers) {
      expect(readSource(file), `${file} no longer asks the shared question`).toMatch(
        /configurationLocked\(|isSetupLocked\(/,
      );
    }
  });
});
