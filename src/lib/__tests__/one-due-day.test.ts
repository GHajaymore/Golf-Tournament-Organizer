import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * ONE DUE DAY (design 2.1). Whether a round has a day is asked of `roundIsScheduled(playedOn, dueDay)`,
 * and its second argument is always `roundDueDay(stage)` (`knockout-play-by.ts`): a knockout dated by
 * its play-by dates has a due day though its `deadline` is empty. A caller that hands over `deadline`
 * alone is the defect this sweep was written for ("Round 2 has no date" on a dated knockout).
 */

/** Every call of `roundIsScheduled(` in the source, with its second argument. */
export function scheduledCalls(src: string): Array<{ second: string }> {
  const out: Array<{ second: string }> = [];
  let at = src.indexOf("roundIsScheduled(");
  while (at !== -1) {
    const open = at + "roundIsScheduled(".length;
    let depth = 1;
    let i = open;
    const args: string[] = [];
    let from = open;
    for (; i < src.length && depth > 0; i++) {
      const c = src[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth === 1) {
        args.push(src.slice(from, i));
        from = i + 1;
      }
    }
    args.push(src.slice(from, i - 1));
    out.push({ second: (args[1] ?? "").trim() });
    at = src.indexOf("roundIsScheduled(", i);
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "__tests__" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe("one due day", () => {
  it("every roundIsScheduled( call in src passes roundDueDay( as its second argument", () => {
    const bad: string[] = [];
    let seen = 0;
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      const rel = file.slice(process.cwd().length + 1);
      const src = readSource(rel);
      // The definition itself is `function roundIsScheduled(playedOn: string, dueDay: string)`.
      const calls = scheduledCalls(src.replace(/function roundIsScheduled\(/g, "function _def("));
      for (const c of calls) {
        seen++;
        if (!c.second.startsWith("roundDueDay(")) bad.push(`${rel}: roundIsScheduled(…, ${c.second})`);
      }
    }
    expect(seen, "the sweep found no call at all: it is reading nothing").toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it("control: the old spelling is caught", () => {
    const planted = readPlanted("const s = roundIsScheduled(r.playedOn, r.deadline);");
    expect(scheduledCalls(planted).map((c) => c.second.startsWith("roundDueDay("))).toEqual([false]);
    expect(scheduledCalls("roundIsScheduled(s.playedOn, roundDueDay(s))").map((c) => c.second.startsWith("roundDueDay("))).toEqual([true]);
  });
});

function readPlanted(s: string): string {
  return s;
}
