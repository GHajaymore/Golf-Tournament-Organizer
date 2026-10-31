import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readVerbatim } from "./source";
// Plain JavaScript on purpose: the ratchet runs on a bare runner (scripts/mutation.mjs).
import { ARITHMETIC_CORE, headline, modulesOfScope, raisedBaseline, ratchetFalls, scoresOf } from "../../../scripts/qa/mutation-ratchet.mjs";
import { MUTATED_MODULES } from "../../../stryker.config.mjs";
import { layersFor } from "../../../scripts/qa/layers.mjs";

/**
 * THE MUTATION RATCHET CAN ONLY GO UP (backlog A7, 2026-10-31).
 *
 * A ratchet whose failure looks like its success is not a ratchet. These hold
 * the arithmetic of it without running Stryker: a score below its floor FAILS,
 * a module nobody measured FAILS, a module with no floor FAILS, and writing a
 * baseline never lowers one. And they hold the wiring: the nightly runs it,
 * a change's round does not, and every module it names has a floor.
 */
const report = (files: Record<string, string[]>) => ({
  files: Object.fromEntries(Object.entries(files).map(([f, statuses]) => [f, { mutants: statuses.map((status) => ({ status })) }])),
});

describe("the score of a module", () => {
  it("is caught (killed or timed out) of all that could be caught; ignored and compile errors do not count", () => {
    const s = scoresOf(report({ "src/a.ts": ["Killed", "Killed", "Timeout", "Survived", "NoCoverage", "Ignored", "CompileError"] }));
    expect(s["src/a.ts"]).toMatchObject({ score: 60, detected: 3, undetected: 2 });
  });
});

describe("the ratchet", () => {
  const floor = { "src/a.ts": 80, "src/b.ts": 50 };
  const scope = ["src/a.ts", "src/b.ts"];

  it("holds at the floor and above", () => {
    const at = scoresOf(report({ "src/a.ts": ["Killed", "Killed", "Killed", "Killed", "Survived"], "src/b.ts": ["Killed", "Killed"] }));
    expect(ratchetFalls(at, floor, scope)).toEqual([]);
  });

  it("FAILS when one module's score drops below its floor, and names it", () => {
    const dropped = scoresOf(report({ "src/a.ts": ["Killed", "Killed", "Killed", "Survived", "Survived"], "src/b.ts": ["Killed"] }));
    const falls = ratchetFalls(dropped, floor, scope);
    expect(falls.map((f) => f.file)).toEqual(["src/a.ts"]);
    expect(falls[0].why).toMatch(/60% is below its baseline of 80%/);
  });

  it("FAILS when a module in scope was not measured — a run that tested nothing is not a pass", () => {
    expect(ratchetFalls({}, floor, scope).map((f) => f.file)).toEqual(scope);
  });

  it("FAILS when a module in scope has no floor", () => {
    const s = scoresOf(report({ "src/c.ts": ["Killed"] }));
    expect(ratchetFalls(s, floor, ["src/c.ts"])[0].why).toMatch(/no baseline/);
  });

  it("asks only of the modules in scope: the nightly's narrower run is not failed by the rest of the foundation", () => {
    const s = scoresOf(report({ "src/a.ts": ["Killed"] }));
    expect(ratchetFalls(s, floor, ["src/a.ts"])).toEqual([]);
  });
});

describe("writing a baseline", () => {
  it("raises a floor to a higher score, and never lowers one", () => {
    const s = scoresOf(report({ "src/a.ts": ["Killed", "Survived"], "src/b.ts": ["Killed", "Killed"] }));
    const { modules, kept } = raisedBaseline({ "src/a.ts": 80, "src/b.ts": 50, "src/z.ts": 70 }, s, ["src/a.ts", "src/b.ts"]);
    expect(modules).toEqual({ "src/a.ts": 80, "src/b.ts": 100, "src/z.ts": 70 });
    expect(kept).toEqual([{ file: "src/a.ts", score: 50, floor: 80 }]);
  });

  it("refuses a scope the report does not hold", () => {
    expect(raisedBaseline({}, {}, ["src/a.ts"]).missing).toEqual(["src/a.ts"]);
  });
});

describe("the arithmetic core, and the nightly that runs it", () => {
  const baseline = JSON.parse(readFileSync(join(process.cwd(), "mutation-baseline.json"), "utf8")).modules as Record<string, number>;

  it("every module in it exists, is in stryker.config.mjs, and has a floor", () => {
    for (const file of ARITHMETIC_CORE) {
      expect(existsSync(join(process.cwd(), file)), file).toBe(true);
      expect(MUTATED_MODULES, file).toContain(file);
      expect(typeof baseline[file], `${file} has no floor in mutation-baseline.json`).toBe("number");
    }
    // Every module the full run mutates has a floor too, so `npm run mutation -- --ratchet` can hold.
    for (const file of MUTATED_MODULES) expect(typeof baseline[file], file).toBe("number");
    expect(modulesOfScope("all", MUTATED_MODULES)).toBe(MUTATED_MODULES);
    expect(() => modulesOfScope("arithmatic", MUTATED_MODULES)).toThrow();
  });

  it("holds the handicap, the allowance, stroke allocation and the skins split", () => {
    for (const f of ["handicap.ts", "round-allowance.ts", "stroke.ts", "team.ts", "money.ts", "skins-pot.ts"]) {
      expect(ARITHMETIC_CORE.some((m: string) => m.endsWith(`/${f}`)), f).toBe(true);
    }
  });

  it("runs in the nightly, with the ratchet on, and in no change's round", () => {
    const nightly = (layersFor(1, { schedule: "nightly", countries: "all" }) as Array<{ key: string; command?: string; when: string[] }>).find((l) => l.key === "mutation");
    expect(nightly?.when).toEqual(["nightly"]);
    expect(nightly?.command).toContain("scripts/mutation.mjs --scope=arithmetic --ratchet --quiet");
    const pr = (layersFor(1, { schedule: "pr", countries: "all" }) as Array<{ key: string }>).map((l) => l.key);
    expect(pr).not.toContain("mutation");
    // The night keeps Stryker's incremental file, and the verdict prints the score.
    const round = readVerbatim(".github/workflows/round.yml");
    expect(round).toContain("path: reports/stryker-incremental.json");
    expect(readVerbatim("scripts/qa/merge.mjs")).toContain("**Mutation score:**");
  });

  it("the score line is the one the verdict reads, and says the scope", () => {
    const s = scoresOf(report({ "src/lib/domain/money.ts": ["Killed", "Survived"] }));
    expect(headline(s, ["src/lib/domain/money.ts"], "arithmetic")).toBe("Mutation score (arithmetic): 50.00% — 1 of 2 mutants caught; money.ts 50%");
  });
});
