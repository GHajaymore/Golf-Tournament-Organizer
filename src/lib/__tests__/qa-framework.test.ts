import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource, readVerbatim } from "./source";
// Plain JavaScript on purpose: the framework runs on a bare runner, before anything is installed.
import { ABROAD, CRAWL_PARTS, SCENARIOS, SCREEN_SPECS, TIER_RULES, TIERS, WALK, layersFor, partsFor, tierOf } from "../../../scripts/qa/layers.mjs";
import { BASELINE, VERDICTS, applyBreak } from "../../../scripts/qa/breaks.mjs";

/**
 * THE TESTING FRAMEWORK IS HELD TO THE FILES ON DISK.
 *
 * `scripts/qa/layers.mjs` is the one list of what a round of testing is, which
 * tournaments it plays, and how much testing a changed file asks for. A list
 * like that goes stale in the direction nobody notices: a spec is renamed and
 * the layer that named it runs nothing; a scenario is added and never listed,
 * so no round plays it; the scoring engine is moved and its line under "core"
 * points at nothing, so a change to it is graded as "function in one area".
 * Each of those leaves every round green.
 *
 * So the list is compared with the repository here, on every push. Ajay,
 * 2026-10-13: "Keep it updated whenever we add any functionality and changes
 * in the app." This is the part of that which a machine can hold us to.
 */
const root = process.cwd();
const at = (p: string) => join(root, p);

describe("a round names things that exist", () => {
  it("CONTROL: the lists are found at all", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(11);
    expect(layersFor(1).length).toBeGreaterThanOrEqual(12);
    expect(SCREEN_SPECS.length).toBeGreaterThan(4);
  });

  it("every spec a layer names is a file", () => {
    for (const round of [1, 2, 3]) {
      for (const layer of layersFor(round)) {
        for (const spec of layer.specs ?? []) expect(existsSync(at(spec)), `${layer.key} names ${spec}, which is not there`).toBe(true);
      }
    }
    for (const spec of [...SCREEN_SPECS, ...WALK]) expect(existsSync(at(spec)), spec).toBe(true);
  });

  it("every scenario on disk is played, and every scenario played is on disk", () => {
    const onDisk = readdirSync(at("e2e/scenarios")).filter((f) => f.endsWith(".spec.ts")).map((f) => `e2e/scenarios/${f}`).sort();
    const listed = SCENARIOS.map((s: { file: string }) => s.file).sort();
    expect(listed, "a tournament in e2e/scenarios that no round plays, or one a round names that is gone").toEqual(onDisk);
  });

  it("every scenario runs the phases its own file has, and reads its own notes for trouble", () => {
    for (const s of SCENARIOS as Array<{ key: string; file: string; phases: string[]; flags: string }>) {
      const source = readSource(s.file);
      for (const phase of s.phases) {
        // Its phases are its own letter and a number (some files count them in a loop, so only the first is spelled out).
        expect(phase.startsWith(s.key.toUpperCase()), `${s.key} lists a phase called ${phase}`).toBe(true);
      }
      expect(s.phases.length, `${s.key} plays no phases`).toBeGreaterThan(1);
      // And the file itself starts where the list does.
      expect(source.includes(`"${s.phases[0]}"`), `${s.file} does not know a phase called ${s.phases[0]}`).toBe(true);
      // The flags are a pattern a phase's notes are read with: it has to compile, and it has to
      // include the three every scenario shares — a thrown page, a sideways scroll, a 5xx.
      expect(() => new RegExp(s.flags)).not.toThrow();
      expect(new RegExp(s.flags).test("page errors: 2")).toBe(true);
      expect(new RegExp(s.flags).test("sideways=14")).toBe(true);
      expect(new RegExp(s.flags).test("[500 → /entry")).toBe(true);
      expect(new RegExp(s.flags).test("page errors: 0, sideways=0")).toBe(false);
    }
  });

  it("the standing suite leaves the scenarios out unless a round asks for them", () => {
    const config = readSource("playwright.config.ts");
    expect(config).toMatch(/testIgnore:\s*process\.env\.E2E_SCENARIOS === "1" \? \[\] : \["\*\*\/scenarios\/\*\*"\]/);
  });

  it("every switch a layer sets is one the suite reads", () => {
    const readers = ["playwright.config.ts", "e2e/coverage.ts", "scripts/seed-club.mjs", "e2e/everything.spec.ts", "e2e/every-control.spec.ts", "e2e/every-action-vs-a-stranger.spec.ts"].map((f) => readSource(f)).join("\n");
    for (const round of [1, 2, 3]) {
      for (const layer of layersFor(round)) {
        for (const name of Object.keys(layer.env ?? {})) expect(readers.includes(`process.env.${name}`), `${layer.key} sets ${name}, which nothing reads`).toBe(true);
      }
    }
  });

  it("three rounds visit every country the framework names, and the seeded club can be put in each", () => {
    const seed = readSource("scripts/seed-club.mjs");
    const visited = new Set<string>();
    for (const trio of ABROAD as Array<Array<{ club: string }>>) for (const place of trio) visited.add(place.club);
    for (const club of visited) expect(seed).toMatch(new RegExp(`\\b${club}: \\{ city:`));
    expect(ABROAD.length).toBe(3);
    // And the round number really does change which are visited.
    const keys = (n: number) => layersFor(n).map((l: { key: string }) => l.key).filter((k: string) => k.startsWith("abroad-")).join(",");
    expect(new Set([keys(1), keys(2), keys(3)]).size).toBe(3);
    expect(keys(4)).toBe(keys(1));
  });
});

describe("the parts of a round add up to the round", () => {
  it("every layer is run by at least one part, and no part runs a layer that is not there", () => {
    for (const round of [1, 2, 3]) {
      const layers = layersFor(round).map((l: { key: string }) => l.key);
      const parts = partsFor(round) as Array<{ id: string; layer: string; args: string }>;
      expect([...new Set(parts.map((p) => p.layer))].sort()).toEqual([...layers].sort());
      expect(new Set(parts.map((p) => p.id)).size, "two parts share a name").toBe(parts.length);
    }
  });

  it("a layer cut by screen size is cut into all of its sizes, and by shard into all of its shards", () => {
    const parts = partsFor(1) as Array<{ id: string; layer: string; args: string }>;
    for (const layer of layersFor(1) as Array<{ key: string; kind?: string; specs: string[]; projects: string[] }>) {
      // Only a layer that runs every spec is cut; a scenario and a plain command are a part each.
      if (layer.kind === "scenarios" || layer.kind === "command" || layer.specs.length) continue;
      const sizes = layer.projects.length ? layer.projects : ["phone", "small-phone", "desktop"];
      const mine = parts.filter((p) => p.layer === layer.key);
      for (const size of sizes) {
        const forSize = mine.filter((p) => p.args.includes(`--projects=${size}`) && !p.args.includes(`--projects=${size}-`));
        expect(forSize.length, `${layer.key} has no part for ${size}`).toBeGreaterThan(0);
        // A share of the console crawl is a part of its own, beside the shards: `--crawl=2/4`.
        const crawlOf = (p: { args: string }) => (p.args.match(/--crawl=(\d+)\/(\d+)/) ?? []).slice(1).map(Number);
        const crawling = forSize.filter((p) => (crawlOf(p)[0] ?? 0) > 0);
        const rest = forSize.filter((p) => !crawling.includes(p));
        const shards = rest.map((p) => (p.args.match(/--shard=(\d+)\/(\d+)/) ?? []).slice(1).map(Number));
        if (shards.some((s) => s.length)) {
          const of = shards[0][1];
          expect(shards.map((s) => s[0]).sort()).toEqual(Array.from({ length: of }, (_, i) => i + 1));
          expect(shards.every((s) => s[1] === of)).toBe(true);
        }
        if (crawling.length) {
          // Every share is there once, they agree how many there are, and each runs nothing but the crawl...
          const of = crawlOf(crawling[0])[1];
          expect(of, `${layer.key} ${size}`).toBe(CRAWL_PARTS);
          expect(crawling.map((p) => crawlOf(p)[0]).sort()).toEqual(Array.from({ length: of }, (_, i) => i + 1));
          expect(crawling.every((p) => crawlOf(p)[1] === of && !p.args.includes("--shard="))).toBe(true);
          // ...and every other part of that size leaves the crawl to them, or it would be run twice — or, with
          // the flag forgotten on one shard, by a part that takes an hour again.
          expect(rest.length).toBeGreaterThan(0);
          expect(rest.every((p) => p.args.includes(`--crawl=0/${of}`)), `${layer.key} ${size}: a part beside the crawl's does not skip it`).toBe(true);
        } else {
          expect(rest.some((p) => p.args.includes("--crawl=")), `${layer.key} ${size} skips a crawl nobody runs`).toBe(false);
        }
      }
    }
  });

  it("a layer that runs a list of specs is one part, or every share of it once", () => {
    // Chrome as installed, an iPad, an Android tablet, Safari: each was one machine for
    // twenty to thirty minutes, and is cut by `--shard` (SHARDS in layers.mjs). A share
    // left out is a third of an iPad nobody looked at, under a round that reads clean.
    const parts = partsFor(1) as Array<{ id: string; layer: string; args: string }>;
    let cut = 0;
    for (const layer of layersFor(1) as Array<{ key: string; kind?: string; specs: string[] }>) {
      if (layer.kind === "scenarios" || layer.kind === "command" || layer.specs.length === 0) continue;
      const mine = parts.filter((p) => p.layer === layer.key);
      const shards = mine.map((p) => (p.args.match(/--shard=(\d+)\/(\d+)/) ?? []).slice(1).map(Number));
      if (mine.length === 1) {
        expect(mine[0].args, `${layer.key} is one part and is told to run a share of itself`).toBe(`--only=${layer.key}`);
        continue;
      }
      cut += 1;
      const of = shards[0][1];
      expect(of, layer.key).toBe(mine.length);
      expect(shards.map((s) => s[0]).sort((a, b) => a - b), layer.key).toEqual(Array.from({ length: of }, (_, i) => i + 1));
      expect(shards.every((s) => s[1] === of), layer.key).toBe(true);
      expect(mine.every((p) => p.args.startsWith(`--only=${layer.key} --shard=`)), layer.key).toBe(true);
    }
    // CONTROL: some layer of this kind really is cut, or the check above looked at nothing.
    expect(cut).toBeGreaterThanOrEqual(3);
  });

  it("every scenario is a part", () => {
    const parts = partsFor(1) as Array<{ id: string; args: string }>;
    for (const s of SCENARIOS as Array<{ key: string }>) {
      expect(parts.filter((p) => p.args === `--only=scenarios --scenario=${s.key}`).length, `scenario ${s.key}`).toBe(1);
    }
  });
});

describe("how much testing a changed file asks for", () => {
  it("grades by what a file is, with the safe answer for a file nothing names", () => {
    expect(tierOf("docs/testing.md")).toBe("words");
    expect(tierOf("src/lib/guide-steps.ts")).toBe("words");
    expect(tierOf("src/app/page.tsx")).toBe("landing");
    expect(tierOf("src/lib/landing/home-styles.ts")).toBe("landing");
    expect(tierOf("e2e/members.spec.ts")).toBe("tests");
    expect(tierOf("src/lib/__tests__/matrix.test.ts")).toBe("tests");
    expect(tierOf("src/components/RosterClient.tsx")).toBe("function");
    expect(tierOf("src/lib/domain/handicap-label.ts")).toBe("function");
    // What every screen stands on, and the arithmetic.
    expect(tierOf("prisma/schema.prisma")).toBe("core");
    expect(tierOf("prisma/migrations/20260101000000_x/migration.sql")).toBe("core");
    expect(tierOf("src/app/globals.css")).toBe("core");
    expect(tierOf("src/lib/domain/stroke.ts")).toBe("core");
    expect(tierOf("src/lib/domain/money.ts")).toBe("core");
    expect(tierOf("src/lib/auth.ts")).toBe("core");
    expect(tierOf("package.json")).toBe("core");
    // A test beside the code it tests is a test, even in a core folder.
    expect(tierOf("src/lib/domain/__tests__/stroke.test.ts")).toBe("tests");
    // Nothing names these: core, which is the safe mistake.
    expect(tierOf("some-new-top-level-file.ts")).toBe("core");
    expect(tierOf("infra/anything.tf")).toBe("core");
    // Windows separators are the same path.
    expect(tierOf("src\\lib\\domain\\stroke.ts")).toBe("core");
  });

  it("every file named as core, by its own name, is there — a rename cannot quietly demote it", () => {
    const gone: string[] = [];
    for (const [tier, patterns] of TIER_RULES as Array<[string, string[]]>) {
      for (const pattern of patterns) {
        if (pattern.endsWith("/") || pattern.includes("*")) {
          const dir = pattern.includes("*") ? pattern.slice(0, pattern.lastIndexOf("/") + 1) : pattern;
          if (!existsSync(at(dir))) gone.push(`${tier}: ${pattern}`);
        } else if (!existsSync(at(pattern))) gone.push(`${tier}: ${pattern}`);
      }
    }
    expect(gone, "TIER_RULES names a path that is not in the repository").toEqual([]);
  });

  it("every tier a rule can give says what it needs", () => {
    for (const [tier] of TIER_RULES as Array<[string, string[]]>) {
      expect((TIERS as Record<string, { needs: string }>)[tier]?.needs, tier).toBeTruthy();
    }
    // More risk never asks for less.
    expect(TIERS.core.rank).toBeGreaterThan(TIERS.function.rank);
    expect(TIERS.function.rank).toBeGreaterThan(TIERS.landing.rank);
    expect(TIERS.landing.rank).toBeGreaterThan(TIERS.tests.rank);
  });

  it("the guide to all this names the commands that exist", () => {
    const guide = readVerbatim("docs/testing.md");
    const scripts = JSON.parse(readVerbatim("package.json")).scripts as Record<string, string>;
    for (const name of ["qa:changed", "qa:round", "qa:status"]) {
      expect(scripts[name], `package.json has no ${name}`).toBeTruthy();
      expect(existsSync(at(scripts[name].replace("node ", ""))), `${name} runs a file that is not there`).toBe(true);
      expect(guide).toContain(`npm run ${name}`);
    }
    expect(existsSync(at(".github/workflows/round.yml"))).toBe(true);
  });
});

/**
 * THE LIST OF ACTIONS NOTHING PERFORMS IS THERE, AND IS ABOUT THIS APP.
 *
 * `merge.mjs` fails a round when an action arrives that no screen test calls and
 * the list does not already admit to. From the day that was written to
 * 2026-10-13 the list did not exist, the check was skipped without a word, and
 * three documents said it ran. So the file is held here, on every push:
 * present, and every name on it an action the app still exports — a list that
 * names what was deleted or renamed is a list nobody is keeping.
 */
describe("the list of actions no screen test performs", () => {
  const path = "scripts/qa/reach-baseline.json";
  const list = () => JSON.parse(readVerbatim(path)) as { measuredOn: string; neverCalled: Record<string, string[]> };

  it("exists, and says what it was measured on", () => {
    expect(existsSync(at(path)), `${path} is missing: no round can check for an action nothing performs`).toBe(true);
    expect(list().measuredOn.length).toBeGreaterThan(10);
    expect(Object.keys(list().neverCalled).length).toBeGreaterThan(0);
  });

  it("names only actions the app still exports", () => {
    const gone: string[] = [];
    for (const [listed, names] of Object.entries(list().neverCalled)) {
      // As a round on GitHub names it: `app/actions/x.ts`, which is `src/app/actions/x.ts` here.
      const file = existsSync(at(listed)) ? listed : `src/${listed}`;
      if (!existsSync(at(file))) {
        gone.push(`${listed} (the file)`);
        continue;
      }
      const source = readSource(file);
      for (const name of names) {
        if (!source.includes(`export async function ${name}(`) && !source.includes(`export const ${name} =`)) gone.push(`${file}: ${name}`);
      }
    }
    expect(gone, "the list names actions that are no longer there — take them off").toEqual([]);
  });

  it("holds no name twice, and no file with nothing in it", () => {
    for (const [file, names] of Object.entries(list().neverCalled)) {
      expect(names.length, `${file} is listed with nothing under it`).toBeGreaterThan(0);
      expect(new Set(names).size, `${file} lists a name twice`).toBe(names.length);
    }
  });

  it("is what the round's verdict reads, and a missing one is a finding there", () => {
    const merge = readSource("scripts/qa/merge.mjs");
    expect(merge).toContain(`join("scripts", "qa", "reach-baseline.json")`);
    expect(merge).toContain("baselineMissing");
  });
});

/**
 * PROVING A TEST BY BREAKING THE APP (`scripts/qa/breaks.mjs`, `breaks.yml`).
 *
 * The one thing this tool must never do is report a break as tried when it was
 * not. A replace that silently matched nothing leaves every test green, which
 * reads exactly like "the tests cannot catch this" — the result that gets a
 * good test weakened. It happened three times in one day by hand (CLAUDE.md,
 * "A `node -e` string replace on a checked-out file usually does nothing").
 */
describe("a deliberate break is applied exactly, or is said not to have been", () => {
  const one = { what: "w", file: "f.ts", from: "return a + b;", to: "return a - b;" };

  it("changes the one line it names and nothing else", () => {
    const out = applyBreak("const x = 1;\n  return a + b;\nconst y = 2;\n", one);
    expect(out.text).toBe("const x = 1;\n  return a - b;\nconst y = 2;\n");
    expect(out.seen).toBe(1);
  });

  it("keeps a checked-out file's line endings, and finds a line written with \\n across them", () => {
    const twoLines = { ...one, from: "const x = 1;\n  return a + b;", to: "const x = 1;\n  return a - b;" };
    const out = applyBreak("const x = 1;\r\n  return a + b;\r\nconst y = 2;\r\n", twoLines);
    expect(out.text).toBe("const x = 1;\r\n  return a - b;\r\nconst y = 2;\r\n");
  });

  it("refuses a line that is not there, and one that is there twice", () => {
    expect(applyBreak("nothing like it\n", one)).toEqual({ text: null, seen: 0 });
    expect(applyBreak("return a + b;\nreturn a + b;\n", one)).toEqual({ text: null, seen: 2 });
  });

  it("takes the nth of several when the list says which", () => {
    const text = "return a + b;\nother\nreturn a + b;\n";
    expect(applyBreak(text, { ...one, nth: 2 }).text).toBe("return a + b;\nother\nreturn a - b;\n");
    expect(applyBreak(text, { ...one, nth: 1 }).text).toBe("return a - b;\nother\nreturn a + b;\n");
    expect(applyBreak(text, { ...one, nth: 3 }).text).toBeNull();
  });

  it("only a test going red counts as caught, and the three ways of proving nothing have their own words", () => {
    expect(VERDICTS).toEqual(["CAUGHT", "NOT CAUGHT", "NOT APPLIED", "DOES NOT COMPILE", "DID NOT RUN"]);
    const script = readSource("scripts/qa/breaks.mjs");
    // The job is green on CAUGHT and on nothing else.
    expect(script).toContain('process.exit(result.verdict === "CAUGHT" ? 0 : 1);');
    // A browser run that never ran a test is not a failure of a test.
    expect(script).toMatch(/if \(!ran\) \{\s*result\.verdict = "DID NOT RUN";/);
    // The verdict counts against how many breaks were asked for, so one that never reported is missed, not ignored.
    expect(script).toContain("caught === (expected || results.length) && results.length > 0");
  });

  it("no break counts as caught unless the same tests pass with nothing broken", () => {
    // The first browser list this tool was given: the fix under test was wrong, the test failed
    // on its own, and a break that undid the fix came back CAUGHT. A test that is already red
    // catches everything.
    expect(BASELINE).toEqual(["PASSES UNBROKEN", "FAILS UNBROKEN"]);
    const script = readSource("scripts/qa/breaks.mjs");
    expect(script).toContain('const sound = base?.verdict === "PASSES UNBROKEN";');
    expect(script).toContain('const caught = sound ? results.filter((r) => r.verdict === "CAUGHT").length : 0;');
    expect(script).toContain("return sound && caught === (expected || results.length) && results.length > 0 ? 0 : 1;");
    const flow = readVerbatim(".github/workflows/breaks.yml");
    expect(flow).toContain("node scripts/qa/breaks.mjs --baseline qa-breaks.json");
    expect(flow).toContain("needs: [plan, baseline, break]");
  });

  it("the workflow gives each break a machine, and the every-push checks leave its branches alone", () => {
    const flow = readVerbatim(".github/workflows/breaks.yml");
    expect(flow).toContain('branches: ["breaks/**"]');
    expect(flow).toContain("node scripts/qa/breaks.mjs --plan qa-breaks.json");
    expect(flow).toContain("node scripts/qa/breaks.mjs --run=${{ matrix.break.index }} qa-breaks.json");
    expect(flow).toContain("--expect=${{ needs.plan.outputs.count }}");
    expect(flow).toContain("fail-fast: false");
    const ci = readVerbatim(".github/workflows/ci.yml");
    expect(ci).toContain('branches: ["**", "!round/**", "!breaks/**"]');
  });
});
