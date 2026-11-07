import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readSource, stripComments } from "./source";

/**
 * ONE READING OF WHICH ROUND DECIDES A CUT (2026-11-07, ruled on the J31 review).
 *
 * A cut is stored on the round it feeds, and it is decided by the round whose
 * card or table it is taken on: the stroke round just before it, or the last
 * round robin before it by position (`cutFeederOf` in `domain/cut-ready.ts`).
 * Every reader that took "the round beside it" instead was right until a medal
 * stood between a round robin and its cut — and then the draw refused for a
 * tie the Stages card did not show, the record said there was no cut, and the
 * rules sheet printed the cut on the wrong round's sheet without its tie
 * method. Four readers, one mistake, found one at a time.
 *
 * So the shape is banned, not the spelling:
 *
 *   1. `cutLineKindOf` (two neighbouring rounds → what the line is drawn on)
 *      is private to `cut-ready.ts` and asked in ONE place, `cutFeederOf`.
 *   2. Anywhere else in the app, a round reached as the one after another by
 *      index (`rounds[i + 1]`, `[findIndex(…) + 1]`) and then asked for its cut
 *      is a second reading — unless it is on the list below, with its reason.
 *
 * Each has a control proving the matcher sees the shape it bans.
 */

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...sourceFiles(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Calls of `cutLineKindOf(` that are not its own declaration. */
function lineKindCalls(src: string): number[] {
  const at: number[] = [];
  const re = /\bcutLineKindOf\s*\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue;
    at.push(m.index);
  }
  return at;
}

/** A top-level `function name` in `src`: from its name to the `}` that closes it at the start of a line. */
function functionBody(src: string, name: string): { start: number; end: number } | null {
  const start = src.search(new RegExp(`function\\s+${name}\\b`));
  if (start < 0) return null;
  const close = /\r?\n\}/.exec(src.slice(start));
  return close ? { start, end: start + close.index + close[0].length } : null;
}

/**
 * Every round reached as the one AFTER another by index and then asked for its
 * cut: `const next = rounds[i + 1]` … `next.cutEnabled` / `cutRuleOf(next)` /
 * `next.cutTies`. Returns `name` per finding.
 */
const CUT_FIELD = "(?:cutEnabled|cutTies|cutTieDecisions|cutCount|cutMode|cutPercent|cutScope)";
function adjacentCutReadings(src: string): string[] {
  const found: string[] = [];
  // The round after (`+ 1`) or before (`- 1`) another, however the line is
  // written: `rounds[i + 1]`, `i >= 0 ? rounds[i + 1] : undefined`,
  // `rounds[rounds.findIndex(…) - 1]`.
  const re = /(?:const|let)\s+(\w+)\s*=\s*[^;\n]*?[\w.]+\[[^\[\]]*[-+]\s*1\s*\]/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const name = m[1];
    const after = src.slice(m.index, m.index + 2500);
    // Its cut field read off it, or it handed to a cut's reader (`cutRuleOf`, `roundRobinCutOf`, …).
    const asked = new RegExp(`\\b${name}\\??\\.${CUT_FIELD}\\b|\\b\\w*[cC]ut\\w*Of\\([^)]*\\b${name}\\b`);
    if (asked.test(after)) found.push(name);
  }
  return found;
}

/**
 * THE READINGS BY ADJACENCY THAT ARE RIGHT — each with why. A card cut's
 * feeder IS the round beside it; nothing else is listed.
 * A new one fails this test until somebody writes its line here.
 */
const ALLOWED: Record<string, string> = {
  // A CARD cut is by definition out of the round just played (`applyStrokeCut`):
  // the adjacency is the rule, and it is `cutFeederOf`'s card clause.
  "src/lib/domain/cut-ready.ts:before": "cutFeederOf itself — the card clause, the one place the round beside a cut is asked",
  "src/lib/domain/cut-ready.ts:next": "cutRoundAfter — a stroke cut's readiness: the card clause of cutFeederOf",
  "src/lib/services/stroke-cut.ts:next": "the stroke-cut engine: a card cut is out of the round just played",
  // No second readings. The board's "advancing" and the dashboard's cut label
  // (`currentRoundCutOf`) ask `cutDecidedBy` since 2026-11-07.
};

describe("one reading of which round decides a cut", () => {
  it("cutLineKindOf is private to cut-ready.ts and asked only inside cutFeederOf", () => {
    const src = readSource("src/lib/domain/cut-ready.ts");
    expect(src, "not exported").not.toMatch(/export\s+function\s+cutLineKindOf\b/);
    const calls = lineKindCalls(src);
    const body = functionBody(src, "cutFeederOf");
    expect(body, "cutFeederOf is found").not.toBeNull();
    const outside = calls.filter((at) => at < body!.start || at > body!.end);
    expect(calls.length, "asked at least once — by cutFeederOf").toBeGreaterThan(0);
    expect(outside, "asked outside cutFeederOf").toEqual([]);
  });

  it("CONTROL: the reading this replaced is seen — cutAfterRound asking the round beside the cut", () => {
    const before = stripComments(
      [
        "export function cutAfterRound(rounds, roundId) {",
        "  const i = rounds.findIndex((r) => r.id === roundId);",
        "  const next = i >= 0 ? rounds[i + 1] : undefined;",
        "  const decidedOn = cutLineKindOf(rounds[i], next);",
        "  return decidedOn;",
        "}",
        "export function cutFeederOf(stages, stageId) {",
        '  if (cutLineKindOf(before, next) === "card") return 1;',
        "}",
        "function cutLineKindOf(feeder, next) { return null; }",
      ].join("\n"),
    );
    const calls = lineKindCalls(before);
    const body = functionBody(before, "cutFeederOf")!;
    expect(calls.filter((at) => at < body.start || at > body.end)).toHaveLength(1);
  });

  it("no other file reads a cut off the round after another by index", () => {
    const findings: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(ROOT, file).split("\\").join("/");
      for (const name of adjacentCutReadings(readSource(rel))) {
        const key = `${rel}:${name}`;
        if (!(key in ALLOWED)) findings.push(key);
      }
    }
    expect(findings, "a second reading of which round decides a cut — ask cutFeederOf / cutDecidedBy").toEqual([]);
  });

  it("every allowed reading is still there (a stale line is a hole in the list)", () => {
    const seen = new Set<string>();
    for (const file of sourceFiles(SRC)) {
      const rel = relative(ROOT, file).split("\\").join("/");
      for (const name of adjacentCutReadings(readSource(rel))) seen.add(`${rel}:${name}`);
    }
    expect(Object.keys(ALLOWED).filter((k) => !seen.has(k))).toEqual([]);
  });

  it("CONTROL: the matcher sees the shapes it bans, and not a carry-forward", () => {
    expect(adjacentCutReadings("const next = rounds[i + 1];\n if (!next || !next.cutEnabled) return null;")).toEqual(["next"]);
    expect(
      adjacentCutReadings("const next = rounds[rounds.findIndex((s) => s.id === feederId) + 1];\n const made = await roundRobinCutOf(eventId, next.id);"),
    ).toEqual(["next"]);
    expect(adjacentCutReadings("const nextStage = allStages[idx + 1];\n const t = cutTieRuleOf(nextStage.cutTies);")).toEqual(["nextStage"]);
    // The two readings this replaced, as they were written.
    expect(adjacentCutReadings("const next = i >= 0 ? rounds[i + 1] : undefined;\n if (!next || !next.cutEnabled) return null;")).toEqual(["next"]);
    expect(
      adjacentCutReadings("const before = rounds[rounds.findIndex((s) => s.id === stage.id) - 1];\n if (cutLineKindOf(before, stage) !== \"table\") return null;"),
    ).toEqual(["before"]);
    // Not a cut: carrying points into the next round robin.
    expect(adjacentCutReadings("const next = rrStages[i + 1];\n next?.carryForwardEnabled && next.carryForwardPct;")).toEqual([]);
  });
});
