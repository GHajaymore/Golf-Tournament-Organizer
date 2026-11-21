import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSource } from "./source";
import { diffPaths, pathsFromNameStatus, pathsFromStatusLines } from "../../../scripts/qa/changed-paths.mjs";
import { roundPlan, tierOf } from "../../../scripts/qa/layers.mjs";

/**
 * A RENAME TOUCHES TWO PATHS (backlog B98).
 *
 * `git diff --name-only` gives a moved file's NEW path only, so a file moved out of an app area into docs
 * was classed "words" by its destination and the round it needed was skipped. One reader
 * (`scripts/qa/changed-paths.mjs`) names both; this holds every planner to it.
 */
describe("changed paths: a rename names its source as well as its destination", () => {
  it("parses --name-status -z output, rename and copy included", () => {
    const out = ["M", "a.ts", "R100", "src/app/x.tsx", "docs/x.md", "C75", "keep.ts", "copy.ts", "D", "gone.ts", ""].join("\0");
    expect(pathsFromNameStatus(out)).toEqual(["a.ts", "src/app/x.tsx", "docs/x.md", "copy.ts", "gone.ts"]);
  });

  it("reads a `git status --short` rename as both paths", () => {
    expect(pathsFromStatusLines(["R  src/app/x.tsx -> docs/x.md", " M b.ts"])).toEqual(["src/app/x.tsx", "docs/x.md", "b.ts"]);
  });

  it("CONTROL: a file moved from src/app to docs still makes the change an app change", () => {
    const dir = mkdtempSync(join(tmpdir(), "zz-rename-"));
    try {
      const git = (...a: string[]) => {
        const r = spawnSync("git", ["-c", "user.name=zz", "-c", "user.email=zz@example.invalid", ...a], { cwd: dir, encoding: "utf8" });
        expect(r.status, r.stderr).toBe(0);
      };
      git("init", "-q");
      mkdirSync(join(dir, "src/app/event"), { recursive: true });
      mkdirSync(join(dir, "docs"), { recursive: true });
      writeFileSync(join(dir, "src/app/event/page.tsx"), "export default function P() {\n  return null;\n}\n// padding so the rename is recognised as one\n");
      git("add", "src/app/event/page.tsx");
      git("commit", "-q", "-m", "base");
      renameSync(join(dir, "src/app/event/page.tsx"), join(dir, "docs/event-page.md"));
      git("add", "-A");
      git("commit", "-q", "-m", "move");
      expect(readdirSync(dir)).toContain("docs");

      const paths = diffPaths(["HEAD~1", "HEAD"], { cwd: dir });
      expect(paths).toContain("docs/event-page.md");
      expect(paths).toContain("src/app/event/page.tsx");
      // The destination alone is words; the change is still an app change.
      expect(tierOf("docs/event-page.md")).toBe("words");
      expect(roundPlan(paths).rounds).toBeGreaterThan(roundPlan(["docs/event-page.md"]).rounds);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no reader in scripts/qa makes its own `--name-only` diff", () => {
    const readers = readdirSync(join(process.cwd(), "scripts/qa")).filter((f) => f.endsWith(".mjs") && f !== "changed-paths.mjs");
    expect(readers.length).toBeGreaterThan(10);
    for (const name of readers) {
      // `--diff-filter=U` lists files in conflict: a different question, no rename in it.
      const own = readSource(`scripts/qa/${name}`).split("\n").filter((l) => /--name-only/.test(l) && !/--diff-filter=U/.test(l));
      expect(own, name).toEqual([]);
    }
    expect(readSource("scripts/qa/app-id.mjs")).toMatch(/diffPaths\(/);
    expect(readSource("scripts/qa/train-git.mjs")).toMatch(/NAME_STATUS_ARGS/);
    expect(readSource("scripts/qa/deploy-gate.mjs")).toMatch(/NAME_STATUS_ARGS/);
  });
});
