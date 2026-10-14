import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { cutRuleOf } from "@/lib/domain/cut-ready";
import { readSource } from "./source";

/**
 * A ROUND'S CUT SETTINGS ARE READ IN ONE PLACE: `cutRuleOf`.
 *
 * Until 2026-10-14 four places turned `cutScope` / `cutMode` / `cutCount` /
 * `cutPercent` into a rule — the cut itself, the field-size arithmetic, the
 * board's highlight and the round-robin cut. They agreed, which is the reason
 * to make them one before a fifth kind of cut makes them disagree.
 */
describe("a round's cut settings", () => {
  it("read as the rule they describe, and anything unknown as the plain overall count", () => {
    expect(cutRuleOf({ cutScope: "perFlight", cutMode: "percent", cutCount: 16, cutPercent: 25 })).toEqual({
      scope: "perFlight",
      mode: "percent",
      count: 16,
      percent: 25,
    });
    expect(cutRuleOf({ cutScope: "nonsense", cutMode: "", cutCount: 8, cutPercent: 50 })).toEqual({
      scope: "overall",
      mode: "count",
      count: 8,
      percent: 50,
    });
  });

  function sources(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "__tests__" || e.name === "node_modules") continue;
        sources(rel, out);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
    }
    return out;
  }
  const READS = /\.cut(Mode|Scope)\s*===\s*"(percent|perFlight)"/;

  it("CONTROL: the sweep recognises the copies it replaced", () => {
    expect(READS.test('mode: round.cutMode === "percent" ? "percent" : "count",')).toBe(true);
    expect(READS.test('scope: next.cutScope === "perFlight" ? "perFlight" : "overall",')).toBe(true);
    expect(READS.test("const rule = cutRuleOf(next);")).toBe(false);
  });

  it("are read nowhere else", () => {
    const strays = sources("src").filter((f) => !f.endsWith("domain/cut-ready.ts") && READS.test(readSource(f)));
    expect(strays, "read a round's cut with cutRuleOf(round)").toEqual([]);
  });
});
