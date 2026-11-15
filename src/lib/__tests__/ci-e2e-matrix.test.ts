import { describe, it, expect } from "vitest";
import { readVerbatim } from "./source";

/**
 * CI runs end-to-end jobs per viewport — since 2026-11-04 per SHARD of a
 * viewport (desktop and phone in three, small-phone in two, cut by time) — and the list of viewports is
 * written down twice.
 *
 * `playwright.config.ts` declares the projects; `ci.yml` fans out over a
 * matrix naming them. That duplication is forced — a GitHub Actions matrix
 * cannot import a TypeScript config — so the only thing left is to make the
 * two disagree loudly.
 *
 * THE FAILURE THIS EXISTS FOR IS ONE-DIRECTIONAL AND SILENT. Renaming a
 * project already fails loudly: `playwright test --project=gone` errors with
 * "Project(s) not found" and the leg goes red. But ADDING a project to the
 * config without adding it to the matrix fails in the direction nothing
 * reports — the new viewport is simply never run, every leg stays green, and
 * the suite quietly covers less than it says it does.
 *
 * That is the same shape as the hand-written route list `layout.spec` used to
 * carry, which covered 14 of 22 routes with nothing going red about the eight.
 * A list that is short looks exactly like a list that is complete.
 *
 * `readVerbatim` rather than `readSource`: these are .yml and a config whose
 * project names sit in ordinary code, and the comment stripper is written for
 * TypeScript comments. Both assertions here are positive set-equality, so a
 * name appearing only in prose would make this pass when it should fail —
 * which is why the extraction below is anchored to the syntax each file
 * actually uses rather than to a bare word match.
 */

const CONFIG = readVerbatim("playwright.config.ts");
const WORKFLOW = readVerbatim(".github/workflows/ci.yml");

/**
 * A workflow with its comment lines blanked.
 *
 * `readSource` strips TypeScript comments and does not know what a `#` means,
 * so a YAML file arrives here with its prose intact — and this file's prose
 * quotes the exact settings it asserts, which is the documented way a source
 * test goes green for the wrong reason.
 *
 * It was not hypothetical. Flipping `fail-fast: false` to `true` rewrote the
 * comment above it as well, so the mutation was caught — but a change that
 * touched only the setting and left the comment saying `false` would have
 * sailed through. Blanking comments first is what makes these assertions about
 * the workflow rather than about the paragraph describing it.
 */
function yamlCode(src: string): string {
  return src
    .split("\n")
    .map((line) => (line.trimStart().startsWith("#") ? "" : line))
    .join("\n");
}

/** Project names as `playwright.config.ts` declares them, in `projects: [...]`. */
function declaredProjects(): string[] {
  const block = CONFIG.slice(CONFIG.indexOf("projects: ["), CONFIG.indexOf("webServer:"));
  return [...block.matchAll(/^\s*name:\s*"([a-z0-9-]+)"/gm)].map((m) => m[1]).sort();
}

/**
 * The shards the CI matrix fans out over, `{ project, shard, shards }` per job (2026-11-04: the
 * desktop leg is three shards and the phone leg two, so the matrix is an `include` list, one line a
 * job). Read from the code with comments blanked, anchored to the flow-mapping syntax the file uses.
 */
function matrixShards(): { project: string; shard: number; shards: number }[] {
  return [...yamlCode(WORKFLOW).matchAll(/^\s*-\s*\{\s*project:\s*([a-z0-9-]+)\s*,\s*shard:\s*(\d+)\s*,\s*shards:\s*(\d+)\s*\}\s*$/gm)].map((m) => ({
    project: m[1],
    shard: Number(m[2]),
    shards: Number(m[3]),
  }));
}

/** Project names the CI matrix fans out over. */
function matrixProjects(): string[] {
  const shards = matrixShards();
  if (!shards.length) throw new Error("ci.yml no longer declares an e2e project matrix");
  return [...new Set(shards.map((s) => s.project))].sort();
}

describe("every viewport CI claims to test is actually tested", () => {
  it("found both lists", () => {
    // Either regex matching nothing would make the comparison below vacuous.
    expect(declaredProjects().length, "no projects found in playwright.config.ts").toBeGreaterThan(1);
    expect(matrixProjects().length, "no matrix found in ci.yml").toBeGreaterThan(1);
  });

  it("runs a CI job for every project the Playwright config declares", () => {
    expect(
      matrixProjects(),
      "ci.yml's e2e matrix and playwright.config.ts disagree about the viewports — " +
        "a project missing from the matrix is never run, and every leg still passes",
    ).toEqual(declaredProjects());
  });

  /**
   * The split only stays safe while each leg is its own process against its
   * own database. If someone drops the matrix back into a single job, or
   * raises `workers` inside one, the three viewports share a seeded fixture
   * again — and three of the six spec files write to it.
   */
  it("keeps each viewport in its own invocation", () => {
    expect(
      yamlCode(WORKFLOW),
      "the e2e job no longer passes --project and --shard, so one job runs more than its cut of one viewport",
    ).toMatch(
      /time-shard\.mjs \$\{\{\s*matrix\.project\s*\}\} \$\{\{\s*matrix\.shard\s*\}\} \$\{\{\s*matrix\.shards\s*\}\}\) \|\| exit 1[\s\S]*playwright test --project=\$\{\{\s*matrix\.project\s*\}\} \$files /,
    );
    expect(
      CONFIG,
      "workers is no longer 1; parallel workers inside one run share the seeded fixture",
    ).toMatch(/^\s*workers:\s*1\s*,/m);
  });

  /**
   * A phone failure that cancels the desktop leg hides half of what the run
   * was for — the most valuable assertions in this suite are about the
   * DIFFERENCE between viewports.
   */
  it("lets every viewport finish even when one fails", () => {
    expect(yamlCode(WORKFLOW)).toMatch(/^\s*fail-fast:\s*false\s*$/m);
  });

  /**
   * THE SHARDS OF A PROJECT ARE THE PROJECT (2026-11-04). A shard line deleted, or a count changed
   * on one line and not its siblings, leaves part of a viewport's suite in no job, and every job
   * that is left stays green. The run proves it too (`e2e-cover`, scripts/qa/shards-cover.mjs);
   * this says so before a machine is spent.
   */
  it("cuts each project into shards 1..n, each once, agreeing about n", () => {
    const byProject = new Map<string, { shard: number; shards: number }[]>();
    for (const s of matrixShards()) byProject.set(s.project, [...(byProject.get(s.project) ?? []), s]);
    for (const [project, shards] of byProject) {
      const totals = [...new Set(shards.map((s) => s.shards))];
      expect(totals, `${project}: its shards disagree about how many there are`).toHaveLength(1);
      expect(
        shards.map((s) => s.shard).sort((a, b) => a - b),
        `${project}: shards are not exactly 1..${totals[0]}`,
      ).toEqual(Array.from({ length: totals[0] }, (_, i) => i + 1));
    }
    // The cut Security agreed to: the laptop in three, the phone in two — and the small phone in two
    // once the first two cuts left it the critical path (29:27 whole, 2026-11-04).
    expect(byProject.get("desktop")?.length, "the desktop leg is no longer three shards").toBe(3);
    expect(byProject.get("phone")?.length, "the phone leg is no longer three shards").toBe(3);
    expect(byProject.get("small-phone")?.length, "the small-phone leg is no longer two shards").toBe(2);
  });

  it("does not let verify pass unless every shard and the shard cover succeeded", () => {
    const code = yamlCode(WORKFLOW);
    const verify = code.slice(code.indexOf("\n  verify:"), code.indexOf("\n  deploy:"));
    expect(verify, "verify no longer needs every e2e shard and the cover").toMatch(/needs:\s*\[unit, build, e2e-build, e2e, e2e-cover, e2e-webkit-door\]/);
    // The WebKit front door (2026-11-14): its own job, the iPhone profile, plain http, the spec that signs out.
    const door = code.slice(code.indexOf("\n  e2e-webkit-door:"), code.indexOf("\n  verify:"));
    expect(door, "the WebKit front-door job is gone").toContain("E2E_ENGINE: webkit");
    expect(door).toContain('E2E_PLAIN_HTTP: "1"');
    expect(door).toContain("playwright test --project=desktop --project=phone e2e/front-door.spec.ts");
    expect(door).toMatch(/needs:\s*e2e-build\b/);
    // Runs on a red need, and fails on anything but success: a skipped required check reads as passing.
    expect(verify).toMatch(/if:\s*\$\{\{\s*!cancelled\(\)\s*\}\}/);
    expect(verify).toContain('all(.[]; .result == "success")');
    const cover = code.slice(code.indexOf("\n  e2e-cover:"), code.indexOf("\n  verify:"));
    expect(cover, "e2e-cover no longer runs the proof").toContain("node scripts/qa/shards-cover.mjs shards");
    expect(cover).toMatch(/needs:\s*e2e\b/);
    // Each shard hands in what it ran and the whole project's list, under one name per shard.
    expect(code).toContain("PLAYWRIGHT_JSON_OUTPUT_FILE: shard-proof/ran.json");
    expect(code).toMatch(/playwright test --list --project=\$\{\{\s*matrix\.project\s*\}\} --reporter=json/);
    expect(code).toContain("name: e2e-tests-${{ matrix.project }}-${{ matrix.shard }}of${{ matrix.shards }}");
  });
});

/**
 * ONE BUILD, EVERY SHARD TAKES IT (2026-11-12). Eight shards each built the bundle they served (about
 * 1.9 minutes each); now job `e2e-build` builds it once and the shards download it. What can go wrong
 * is silent: a shard that quietly builds its own again (the saving gone, nothing red), or one that
 * serves a missing or stale bundle (every test against the wrong app). So the guarantee is pinned here:
 * the shards need the build job, take its artifact, tell the config not to build, the config then checks
 * the build before serving it, and no shard step runs `npm run build`.
 */
describe("the browser-test bundle is built once and every shard takes it", () => {
  const code = yamlCode(WORKFLOW);
  const job = (name: string, next: string) => code.slice(code.indexOf(`\n  ${name}:`), code.indexOf(`\n  ${next}:`));

  it("builds the bundle in one job, the way the config would, and stamps it with the commit", () => {
    const build = job("e2e-build", "e2e");
    expect(build, "the e2e-build job is gone").toContain("npm run build");
    expect(build).toContain("NEXT_DIST_DIR: .next-e2e");
    expect(build).toContain('NEXT_NO_STANDALONE: "1"');
    expect(build).toContain('echo "${{ github.sha }}" > .next-e2e/BUILT_FROM');
    expect(build).toContain("name: e2e-build");
    expect(build, "an empty upload would let every shard fall over later").toContain("if-no-files-found: error");
  });

  it("makes every shard wait for it, take its artifact, and not build its own", () => {
    const e2e = job("e2e", "e2e-cover");
    expect(e2e, "a shard can start without the build").toMatch(/^    needs:\s*e2e-build\s*$/m);
    expect(e2e).toMatch(/actions\/download-artifact@v4\s+with:\s+name: e2e-build\s+path: \.next-e2e/);
    expect(e2e, "the shard no longer tells the config to serve the prebuilt bundle").toContain('E2E_PREBUILT: "1"');
    expect(e2e, "a shard builds its own bundle again").not.toMatch(/npm run build|next build/);
  });

  it("has the config serve that build, after checking it is this commit's, and never build in that mode", () => {
    const start = CONFIG.slice(CONFIG.indexOf("webServer:"));
    expect(start).toContain('process.env.E2E_PREBUILT === "1" ? `node scripts/ci/check-prebuilt.mjs && npx next start --port ${PORT}`');
    const check = readVerbatim("scripts/ci/check-prebuilt.mjs");
    expect(check).toContain("GITHUB_SHA");
    expect(check).toContain("BUILT_FROM");
    expect(check).toContain("process.exit(1)");
  });
});

/**
 * THE TIME CUT LOSES NO SPEC (2026-11-12). CI's shards are handed their FILES by
 * `scripts/qa/time-shard.mjs`, by measured seconds (`spec-durations.json`), where they used to be
 * handed `--shard=i/n`. A deal that drops a file, or deals one twice, is a spec that never runs (or a
 * fixture raced) with every job green; `e2e-cover` proves it from the run, and this says so before a
 * machine is spent. `time-shard.mjs` is plain JS: the dynamic import is the only way to read it here.
 */
describe("the time cut deals every spec to exactly one shard", () => {
  type Mod = {
    specFiles: () => string[];
    loadDurations: () => Record<string, Record<string, number>>;
    shardFiles: (project: string, shard: number, shards: number, opts?: { files?: string[]; durations?: Record<string, Record<string, number>> }) => string[];
    cut: (files: string[], perFile: Record<string, number>, shards: number) => { files: string[]; seconds: number }[];
  };
  const load = async () => (await import("../../../scripts/qa/time-shard.mjs")) as unknown as Mod;

  it("deals the project's files out, each once, for every shard the matrix runs", async () => {
    const { specFiles, shardFiles } = await load();
    const all = specFiles();
    expect(all.length, "no spec files found").toBeGreaterThan(100);
    const byProject = new Map<string, number>();
    for (const s of matrixShards()) byProject.set(s.project, s.shards);
    expect(byProject.size).toBeGreaterThan(1);
    for (const [project, n] of byProject) {
      const dealt = Array.from({ length: n }, (_, i) => shardFiles(project, i + 1, n)).flat();
      expect([...dealt].sort(), `${project}: the shards together are not exactly the spec files`).toEqual([...all].sort());
      for (let i = 1; i <= n; i += 1) expect(shardFiles(project, i, n).length, `${project} ${i}/${n} holds nothing`).toBeGreaterThan(0);
    }
  });

  it("deals a spec it has never timed too, and balances by seconds (no shard above 1.2 of the mean)", async () => {
    const { specFiles, loadDurations, cut, shardFiles } = await load();
    const all = [...specFiles(), "e2e/zz-brand-new.spec.ts"];
    const dealt = Array.from({ length: 3 }, (_, i) => shardFiles("phone", i + 1, 3, { files: all })).flat();
    expect(dealt.filter((f) => f === "e2e/zz-brand-new.spec.ts"), "a spec with no timing was dropped or doubled").toHaveLength(1);
    const durations = loadDurations();
    for (const [project, n] of [["desktop", 3], ["phone", 3], ["small-phone", 2]] as const) {
      const bins = cut(specFiles(), durations[project], n);
      const mean = bins.reduce((a, b) => a + b.seconds, 0) / n;
      expect(Math.max(...bins.map((b) => b.seconds)), `${project}: the cut is lopsided`).toBeLessThan(mean * 1.2);
    }
  });

  it("knows the whole suite's timings (no spec file missing from spec-durations.json by more than a few)", async () => {
    const { specFiles, loadDurations } = await load();
    const d = loadDurations();
    for (const project of ["desktop", "phone", "small-phone"]) {
      const missing = specFiles().filter((f) => !(f in d[project]));
      expect(missing.length, `${project}: refresh scripts/qa/spec-durations.json (missing ${missing.slice(0, 5).join(", ")})`).toBeLessThanOrEqual(5);
    }
  });
});

describe("a round's longest part is not whole", () => {
  it("cuts the small phone's whole suite (41.6 minutes on one machine, 2026-11-11) and the phone's", async () => {
    const { SHARDS } = (await import("../../../scripts/qa/layers.mjs")) as unknown as { SHARDS: Record<string, number> };
    expect(SHARDS["suite:small-phone"], "suite:small-phone is one machine again").toBeGreaterThanOrEqual(2);
    expect(SHARDS["suite:phone"]).toBeGreaterThanOrEqual(2);
    expect(SHARDS["iphone:phone"]).toBeGreaterThanOrEqual(2);
  });
});
