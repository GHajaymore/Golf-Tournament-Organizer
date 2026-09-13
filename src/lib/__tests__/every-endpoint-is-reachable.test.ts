import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * EVERY `"use server"` EXPORT IS CALLED BY SOMETHING.
 *
 * A server action nothing calls is two bad things at once. It is a public HTTP
 * endpoint — this codebase says so about every such file it has — so it is
 * live attack surface for a capability the product does not offer. And far
 * more often, it is a FEATURE THAT DOES NOT WORK: the action is written,
 * authorized, scoped and audited, and no screen reaches it, so the rule it
 * enforces silently does not apply.
 *
 * That has happened at least three times:
 *
 *   removeSettlement   "shipped fully authorized and audit-tested and was
 *                      wired to no screen at all, so a handover marked
 *                      settled by mistake could not be taken back by
 *                      anybody" — its own comment, in MoneyClient.
 *
 *   setPotExcluded     the entire opt-out half of pot membership. The column,
 *                      the rule and the action all existed; the chip called
 *                      the ENTRANT setter instead, which cannot exclude
 *                      anybody, so a player who said they were out of a pot
 *                      was charged for it anyway. Found 2026-09-13.
 *
 *   five in messaging  one-line duplicates of service functions every screen
 *                      already imported directly. Removed the same day.
 *
 * Each was found by hand, twice by accident. This is that sweep, kept.
 *
 * IT SWEEPS THE FILESYSTEM rather than a list, for the reason this repo gives
 * every time it makes that choice: a hand-written list covered 14 of 22 routes
 * and the eight it missed had no assertion at all. An action added next month
 * is covered the day it is added.
 */

const SRC_DIRS = ["src", "e2e", "scripts"];

function allFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(p);
      } else if (/\.tsx?$/.test(e.name) || /\.mjs$/.test(e.name)) {
        out.push(p);
      }
    }
  };
  for (const d of SRC_DIRS) walk(d);
  return out;
}

/**
 * Actions that genuinely have no caller yet, each with the reason it is kept.
 *
 * A WAITING FEATURE, NOT DEAD CODE — that is the only thing this list may
 * mean, and each entry has to say which feature. Anything whose reason is
 * "we might need it" belongs deleted instead: an unreferenced endpoint is
 * reachable by anybody who can guess the action id, and "might need it" is not
 * a reason to leave a door open.
 */
const NO_CALLER_YET: Record<string, string> = {
  /**
   * EMPTY, AND THAT IS THE POINT.
   *
   * It opened with four entries the day this guard was written. All four have
   * since been wired to the screens they were waiting for — `forfeitMatch`
   * (#340), `disputeScorecard` (#341), and `removeSideGame` and `renameTeam`
   * here — so every `"use server"` export in the app is now reachable from
   * product code.
   *
   * Adding an entry is allowed and is meant to be uncomfortable: it says a
   * capability is built and nobody can use it, which is the state that
   * produced every one of those four.
   */
};

describe("no server action is unreachable", () => {
  /** name -> the file that defines it. */
  const actions = new Map<string, string>();
  const files = allFiles();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (!/^\s*["']use server["']/m.test(src)) continue;
    for (const m of src.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)/g)) {
      actions.set(m[1], f);
    }
  }

  /**
   * Comments stripped, for the reason `source-guard.test.ts` exists: the note
   * above an action almost always names it, so a file that no longer CALLS it
   * would still satisfy a plain text search. That is the one failure mode that
   * looks exactly like success.
   */
  const bodies = files
    /**
     * NOT THIS FILE. `NO_CALLER_YET` names every exemption, so without this
     * the list counts as a caller and every entry in it reads as reachable —
     * the guard exempting an action and then reporting it as fine. Caught
     * within a minute of writing it, by the exemption-honesty check below
     * insisting the opposite.
     */
    .filter((f) => !f.endsWith(join("__tests__", "every-endpoint-is-reachable.test.ts")))
    .map((f) => ({ file: f, src: readSource(f) }));

  /**
   * A caller in PRODUCT code — not a test.
   *
   * The first version counted any file, and a mutation that unwired
   * `setPotExcluded` from both chips still passed: the audit test written for
   * it imports and calls it, so the action looked reachable while no screen
   * could reach it. That is precisely the bug this guard exists to catch,
   * passing its own guard.
   *
   * So a test may PROVE an action works and may not stand in for a way to use
   * it. `scripts/` counts — those are the smoke tools an operator runs — but
   * anything under `__tests__` or `e2e/` does not.
   */
  const isProduct = (f: string) =>
    !f.includes(join("src", "lib", "__tests__")) && !f.includes("__tests__") && !f.startsWith("e2e");

  const usedElsewhere = (name: string, home: string) =>
    bodies.some(
      (b) =>
        b.file !== home &&
        isProduct(b.file) &&
        new RegExp(String.raw`\b` + name + String.raw`\b`).test(b.src),
    );

  it("finds the actions at all — the sweep's own control", () => {
    /**
     * WITHOUT THIS THE WHOLE FILE PASSES VACUOUSLY. The first version of this
     * sweep, run as a script, reported 211 of 211 actions unreachable because
     * a `\b` had been eaten before it reached the regex — every assertion
     * "passed" in the sense of finding nothing it recognised.
     *
     * So: a substantial number of actions, and a name known to be called must
     * read as called.
     */
    expect(actions.size, "no server actions found — the sweep is broken").toBeGreaterThan(150);
    expect(actions.has("addExpense")).toBe(true);
    expect(usedElsewhere("addExpense", actions.get("addExpense")!), "the matcher finds nothing").toBe(true);
  });

  it("has a caller for every one, or a stated reason", () => {
    const orphans = [...actions.keys()]
      .filter((n) => !usedElsewhere(n, actions.get(n)!))
      .filter((n) => !(n in NO_CALLER_YET))
      .sort();

    expect(
      orphans,
      "these are public HTTP endpoints nothing calls — wire them to a screen, delete them, " +
        "or add them to NO_CALLER_YET with the feature they are waiting for",
    ).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    /**
     * An exemption that has quietly acquired a caller is a stale exemption,
     * and the next unreachable action added beside it inherits the excuse.
     * Both directions, so the list cannot rot in either.
     */
    for (const [name, reason] of Object.entries(NO_CALLER_YET)) {
      expect(actions.has(name), `${name} is exempted and no longer exists`).toBe(true);
      expect(
        usedElsewhere(name, actions.get(name)!),
        `${name} has a caller now — take it out of NO_CALLER_YET`,
      ).toBe(false);
      // A reason, not a shrug. "unused" is not a reason.
      expect(reason.length, `${name} needs a real reason`).toBeGreaterThan(60);
    }
  });
});
