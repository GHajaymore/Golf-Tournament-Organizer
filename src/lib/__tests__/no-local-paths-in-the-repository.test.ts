// The repository is public (Hard rule 2). A local absolute path names the Windows user and the layout of the
// machine: on 14 Nov agent definitions went into a PR holding scratchpad paths, caught only by a review
// (process ledger row 10). The guard hook refuses such a commit when Claude makes it; this sweep catches one
// that arrived any other way. It reads files RAW, not through readSource: a path in a comment leaks the same.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOCAL_PATH, findLocalPaths } from "../../../.claude/hooks/guard.mjs";

/**
 * Tracked files allowed to hold a local path, each with its reason. Measured on 14 Nov: none needed. An entry
 * must still hit, so a fixed file cannot leave a stale exemption behind.
 */
const ALLOWED: Record<string, string> = {};

const root = process.cwd();
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\0")
  .filter(Boolean);

function hitsIn(file: string): number[] {
  const abs = path.join(root, file);
  let text: string;
  try {
    if (statSync(abs).size > 4 * 1024 * 1024) return [];
    text = readFileSync(abs, "utf8");
  } catch {
    return []; // deleted in the working tree
  }
  if (text.includes("\0")) return [];
  const lines = text.split("\n");
  return lines.flatMap((line, i) => (findLocalPaths([{ file, text: line }]).length ? [i + 1] : []));
}

// Built at run time so this file itself never holds one.
const sep = String.fromCharCode(92);
const drive = ["C", ":"].join("");
const controls = [
  [drive, "Users", "zzperson", "repo"].join(sep),
  [drive, "", "Users", "", "zzperson"].join(sep), // escaped in JS or JSON
  `${drive}/Users/zzperson/repo`,
  ["", "c", "Users", "zzperson", "repo"].join("/"),
  ["", "mnt", "c", "Users", "zzperson"].join("/"),
  ["zz", "App" + "Data", "Local", "Temp", "claude"].join(sep),
  ["zz", "App" + "Data", "Roaming", "x"].join("/"),
];
const placeholders = [
  "/c/Users/... as Node reads it",
  [drive, "Users", "<you>", "repo"].join(sep),
  "`%APP" + "DATA%/TourneyHQ` on Windows",
  "resolving a module under App" + "Data at once",
  "/api/v1/users/42",
  "<main checkout>/node_modules",
];

describe("no tracked file holds a local absolute path", () => {
  it("the patterns see every spelling of one (control)", () => {
    for (const c of controls) expect(LOCAL_PATH.some((re: RegExp) => re.test(c)), c).toBe(true);
  });

  it("and leave placeholders and prose alone", () => {
    for (const p of placeholders) expect(LOCAL_PATH.some((re: RegExp) => re.test(p)), p).toBe(false);
  });

  it("the sweep reads the repository (it is not passing on nothing)", () => {
    expect(tracked.length).toBeGreaterThan(1000);
    expect(tracked).toContain("CLAUDE.md");
  });

  it("across every tracked file", () => {
    const found = tracked
      .filter((f) => !(f in ALLOWED))
      .flatMap((f) => hitsIn(f).map((n) => `${f}:${n}`));
    expect(found, "write a path relative to the repository, or a placeholder such as <main checkout>").toEqual([]);
  });

  it("and every exemption still earns its place", () => {
    for (const f of Object.keys(ALLOWED)) expect(hitsIn(f).length, f).toBeGreaterThan(0);
  });
});
