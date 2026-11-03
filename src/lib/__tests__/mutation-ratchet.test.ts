import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readVerbatim } from "./source";
// Plain JavaScript on purpose: the ratchet runs on a bare runner (scripts/mutation.mjs).
import {
  ARITHMETIC_CORE,
  SLACK_MUTANTS,
  floorCount,
  headline,
  modulesOfScope,
  raisedBaseline,
  ratchetFalls,
  ratchetSlack,
  scoresOf,
} from "../../../scripts/qa/mutation-ratchet.mjs";
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
  files: Object.fromEntries(
    Object.entries(files).map(([f, statuses]) => [
      f,
      // "Loop" is a Timeout Stryker stopped by its hit limit; "Timeout" is one that only ran slowly.
      { mutants: statuses.map((status) => (status === "Loop" ? { status: "Timeout", statusReason: "Hit limit reached (11531701/11531700)" } : { status })) },
    ]),
  ),
});

describe("the score of a module", () => {
  it("is caught (killed, or an endless loop stopped) of all that could be; ignored and compile errors do not count", () => {
    const s = scoresOf(report({ "src/a.ts": ["Killed", "Killed", "Loop", "Survived", "NoCoverage", "Ignored", "CompileError"] }));
    expect(s["src/a.ts"]).toMatchObject({ score: 60, detected: 3, undetected: 2 });
  });

  it("a timeout that was only slow counts as NOT caught — it depends on the machine's load, and a ratchet must not", () => {
    // Measured 2026-10-31: three equivalent mutants in skins.ts were Timeout at concurrency 8 and
    // Survived in the run after it. Counted as caught, the floor moved with the load.
    const slow = scoresOf(report({ "src/a.ts": ["Killed", "Timeout"] }));
    const survived = scoresOf(report({ "src/a.ts": ["Killed", "Survived"] }));
    expect(slow["src/a.ts"].score).toBe(survived["src/a.ts"].score);
    expect(slow["src/a.ts"].score).toBe(50);
  });
});

describe("the ratchet", () => {
  const floor = { "src/a.ts": 80, "src/b.ts": 50 };
  const scope = ["src/a.ts", "src/b.ts"];

  it("holds at the floor and above", () => {
    const at = scoresOf(report({ "src/a.ts": ["Killed", "Killed", "Killed", "Killed", "Survived"], "src/b.ts": ["Killed", "Killed"] }));
    expect(ratchetFalls(at, floor, scope)).toEqual([]);
  });

  it("FAILS when one module's score drops below its floor by more than one mutant, and names it", () => {
    // Floor 80% of five is four caught; two caught is two short.
    const dropped = scoresOf(report({ "src/a.ts": ["Killed", "Killed", "Survived", "Survived", "Survived"], "src/b.ts": ["Killed"] }));
    const falls = ratchetFalls(dropped, floor, scope);
    expect(falls.map((f) => f.file)).toEqual(["src/a.ts"]);
    expect(falls[0].why).toMatch(/40% is below its baseline of 80% — 2 of 5 caught, the floor asks 4/);
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

describe("one mutant of slack per module, counted in mutants (2026-11-02)", () => {
  // The night that wrote this: stroke.ts, 271 mutants, floor 76.75% (208 caught), and the runner
  // caught 207 because one mutant only ran slowly there.
  const FILE = "src/lib/domain/stroke.ts";
  const floor = { [FILE]: 76.75 };
  const run = (caught: number, total = 271) =>
    scoresOf(report({ [FILE]: [...Array(caught).fill("Killed"), ...Array(total - caught).fill("Survived")] }));

  it("a floor is turned into the count of mutants it asks of this run's total", () => {
    expect(floorCount(76.75, 271)).toBe(208);
    expect(floorCount(76.38, 271)).toBe(207);
    expect(floorCount(100, 271)).toBe(271);
    expect(floorCount(0, 271)).toBe(0);
    expect(floorCount(80, 5)).toBe(4);
    expect(floorCount(100.01, 5)).toBe(6);
    expect(SLACK_MUTANTS).toBe(1);
  });

  it("CONTROL: at the floor, the ratchet holds and no slack is used", () => {
    expect(run(208)[FILE].score).toBe(76.75);
    expect(ratchetFalls(run(208), floor, [FILE])).toEqual([]);
    expect(ratchetSlack(run(208), floor, [FILE])).toEqual([]);
  });

  it("ONE mutant lost: it holds, and the module is named as on its slack — in the score line the verdict prints", () => {
    const s = run(207);
    expect(s[FILE].score).toBe(76.38);
    expect(ratchetFalls(s, floor, [FILE])).toEqual([]);
    const slack = ratchetSlack(s, floor, [FILE]);
    expect(slack).toEqual([{ file: FILE, detected: 207, need: 208, total: 271, score: 76.38, floor: 76.75 }]);
    expect(headline(s, [FILE], "arithmetic", slack)).toBe(
      "Mutation score (arithmetic): 76.38% — 207 of 271 mutants caught; stroke.ts 76.38%; ON ITS ONE MUTANT OF SLACK: stroke.ts (207 of 271 caught, floor 208)",
    );
  });

  it("TWO mutants lost: it FAILS, and the module is not counted as on its slack", () => {
    const s = run(206);
    const falls = ratchetFalls(s, floor, [FILE]);
    expect(falls.map((f) => f.file)).toEqual([FILE]);
    expect(falls[0].why).toMatch(/206 of 271 caught, the floor asks 208/);
    expect(ratchetSlack(s, floor, [FILE])).toEqual([]);
  });

  it("the slack is one MUTANT, not a percentage: on a small module one lost is a big drop and still holds; two fail", () => {
    const f = { "src/a.ts": 100 };
    const small = (caught: number) => scoresOf(report({ "src/a.ts": [...Array(caught).fill("Killed"), ...Array(4 - caught).fill("Survived")] }));
    expect(ratchetFalls(small(3), f, ["src/a.ts"])).toEqual([]);
    expect(ratchetSlack(small(3), f, ["src/a.ts"]).map((x) => x.file)).toEqual(["src/a.ts"]);
    expect(ratchetFalls(small(2), f, ["src/a.ts"]).map((x) => x.file)).toEqual(["src/a.ts"]);
  });

  it("scripts/mutation.mjs puts the slack in the first line it prints, and never as a ✗ finding", () => {
    const src = readVerbatim("scripts/mutation.mjs");
    expect(src).toContain("headline(scores, inScope, scope, slack)");
    expect(src).toMatch(/ratchetSlack\(scores, baselineFile\.modules/);
    expect(src).not.toMatch(/✗[^\n]*of its slack/);
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
