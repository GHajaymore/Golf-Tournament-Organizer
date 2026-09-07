import { describe, it, expect } from "vitest";
import { readVerbatim } from "./source";

/**
 * CI runs one end-to-end job per viewport, and the list of viewports is
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

/** Project names as `playwright.config.ts` declares them, in `projects: [...]`. */
function declaredProjects(): string[] {
  const block = CONFIG.slice(CONFIG.indexOf("projects: ["), CONFIG.indexOf("webServer:"));
  return [...block.matchAll(/^\s*name:\s*"([a-z0-9-]+)"/gm)].map((m) => m[1]).sort();
}

/** Project names the CI matrix fans out over. */
function matrixProjects(): string[] {
  const line = WORKFLOW.match(/^\s*project:\s*\[([^\]]+)\]/m);
  if (!line) throw new Error("ci.yml no longer declares an e2e project matrix");
  return line[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
    .sort();
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
      WORKFLOW,
      "the e2e job no longer passes --project, so one leg runs every viewport in one process",
    ).toMatch(/playwright test --project=\$\{\{\s*matrix\.project\s*\}\}/);
    expect(
      CONFIG,
      "workers is no longer 1; parallel workers inside one run share the seeded fixture",
    ).toMatch(/workers:\s*1\b/);
  });

  /**
   * A phone failure that cancels the desktop leg hides half of what the run
   * was for — the most valuable assertions in this suite are about the
   * DIFFERENCE between viewports.
   */
  it("lets every viewport finish even when one fails", () => {
    expect(WORKFLOW).toMatch(/fail-fast:\s*false/);
  });
});
