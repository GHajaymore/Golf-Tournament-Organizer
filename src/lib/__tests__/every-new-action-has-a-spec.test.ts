import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { readSource } from "./source";
import { ALWAYS_ON, AREAS, FULL_ONLY } from "../../../scripts/qa/specs-by-area.mjs";
import known from "../../../scripts/qa/known-actions.json";

/**
 * A NEW SERVER ACTION NAMES THE SPEC THAT PRESSES IT — CAUGHT IN THE UNIT JOB
 * (delivery panel, 2026-11-04: the static reach guard).
 *
 * The round's reach check fails on an action no screen test performs. That is
 * the true measure and it stays, but it speaks at minute 55 of a round: two of
 * the rounds the panel counted (`958-1`, `ai-one-account-1`) failed on nothing
 * else — a new action whose spec had not been written. Bookkeeping, checkable in
 * seconds.
 *
 * So `scripts/qa/known-actions.json` lists every exported action the reach was
 * last measured against, and an action that is not on it must be named in its
 * `newSince` with the spec that presses it. This test cannot see whether the spec
 * really presses it — the round still proves that — but "forgot the spec" can no
 * longer reach a round.
 */

type Known = { actions: Record<string, string[]>; newSince: Record<string, string> };

/** Every `export async function` of every action file, keyed as the reach report keys them. */
function exportedActions(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of readdirSync("src/app/actions").filter((f) => f.endsWith(".ts")).sort()) {
    const names = [...readSource("src/app/actions", f).matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
    if (names.length) out[`app/actions/${f}`] = names;
  }
  return out;
}

/** `file:name` for each exported action neither on the list nor named in `newSince`. */
function unlisted(exported: Record<string, string[]>, list: Known): string[] {
  return Object.entries(exported).flatMap(([file, names]) =>
    names.filter((n) => !list.actions[file]?.includes(n) && !(`${file}:${n}` in list.newSince)).map((n) => `${file}:${n}`),
  );
}

/** `file:name` on the list (either part) that no action file exports any more. */
function gone(exported: Record<string, string[]>, list: Known): string[] {
  const has = (file: string, n: string) => exported[file]?.includes(n) ?? false;
  return [
    ...Object.entries(list.actions).flatMap(([file, names]) => names.filter((n) => !has(file, n)).map((n) => `${file}:${n}`)),
    ...Object.keys(list.newSince).filter((key) => {
      const [file, n] = key.split(":");
      return !has(file, n);
    }),
  ];
}

/**
 * Keys that are not in sorted order. The file is kept SORTED BY KEY so two pull
 * requests that each add an action land at different places and merge without a
 * conflict (13 Nov: it conflicted on every update when entries were appended at
 * the end). Nothing reads the order; only the diff does.
 */
function outOfOrder(o: Record<string, unknown>): string[] {
  const keys = Object.keys(o);
  const sorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return keys.filter((k, i) => k !== sorted[i]);
}

const list = known as unknown as Known;

describe("every server action is on the list, or names the spec that presses it", () => {
  it("no action is new without a spec named for it", () => {
    const missing = unlisted(exportedActions(), list);
    expect(
      missing,
      "a new server action: write the spec that presses it as the person who would, and add `\"<file>:<name>\": \"e2e/<spec>.spec.ts\"` to newSince in scripts/qa/known-actions.json",
    ).toEqual([]);
  });

  it("each spec named in newSince exists and is placed in specs-by-area.mjs", () => {
    const placed = new Set<string>([...ALWAYS_ON, ...FULL_ONLY, ...Object.values(AREAS as Record<string, { specs?: string[] }>).flatMap((a) => a.specs ?? [])]);
    for (const [action, spec] of Object.entries(list.newSince)) {
      expect(existsSync(spec), `${action}: ${spec} does not exist`).toBe(true);
      expect(placed.has(spec), `${action}: ${spec} is not placed in scripts/qa/specs-by-area.mjs`).toBe(true);
    }
  });

  it("the list names nothing that is gone (it describes the app as it is)", () => {
    expect(gone(exportedActions(), list), "take these off scripts/qa/known-actions.json").toEqual([]);
  });

  it("the file's keys are sorted, so two PRs adding different actions do not conflict", () => {
    expect(outOfOrder(list.actions), "actions: keep the file keys sorted").toEqual([]);
    expect(outOfOrder(list.newSince), "newSince: put your new line at its sorted place (plain < order), not at the end").toEqual([]);
  });

  it("CONTROL: the sorted check sees an unsorted object and passes a sorted one", () => {
    expect(outOfOrder({ b: 1, a: 2 }).length).toBeGreaterThan(0);
    expect(outOfOrder({ a: 1, b: 2 })).toEqual([]);
  });

  it("CONTROL: the check sees a new action, and is satisfied only by naming its spec", () => {
    const exported = { "app/actions/x.ts": ["old", "brandNew"] };
    const without: Known = { actions: { "app/actions/x.ts": ["old"] }, newSince: {} };
    expect(unlisted(exported, without)).toEqual(["app/actions/x.ts:brandNew"]);
    expect(unlisted(exported, { ...without, newSince: { "app/actions/x.ts:brandNew": "e2e/x.spec.ts" } })).toEqual([]);
    expect(gone({ "app/actions/x.ts": ["old"] }, { ...without, newSince: { "app/actions/x.ts:brandNew": "e2e/x.spec.ts" } })).toEqual(["app/actions/x.ts:brandNew"]);
  });

  it("CONTROL: the export reader finds the actions there are (a reader that finds none passes on nothing)", () => {
    const n = Object.values(exportedActions()).flat().length;
    expect(n).toBeGreaterThan(250);
  });
});
