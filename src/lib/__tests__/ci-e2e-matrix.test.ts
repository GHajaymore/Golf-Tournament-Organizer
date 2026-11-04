import { describe, it, expect } from "vitest";
import { readVerbatim } from "./source";

/**
 * CI runs end-to-end jobs per viewport — since 2026-11-04 per SHARD of a
 * viewport (desktop in three, phone and small-phone in two) — and the list of viewports is
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
    ).toMatch(/playwright test --project=\$\{\{\s*matrix\.project\s*\}\} --shard=\$\{\{\s*matrix\.shard\s*\}\}\/\$\{\{\s*matrix\.shards\s*\}\}/);
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
    expect(byProject.get("phone")?.length, "the phone leg is no longer two shards").toBe(2);
    expect(byProject.get("small-phone")?.length, "the small-phone leg is no longer two shards").toBe(2);
  });

  it("does not let verify pass unless every shard and the shard cover succeeded", () => {
    const code = yamlCode(WORKFLOW);
    const verify = code.slice(code.indexOf("\n  verify:"), code.indexOf("\n  deploy:"));
    expect(verify, "verify no longer needs every e2e shard and the cover").toMatch(/needs:\s*\[unit, build, e2e, e2e-cover\]/);
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
