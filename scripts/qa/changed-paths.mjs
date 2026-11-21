/**
 * THE ONE READER OF A DIFF'S PATHS (backlog B98).
 *
 * `git diff --name-only` names a renamed file by its NEW path alone, so a file moved out of an app
 * area (src/app/... to docs/...) was classed by its destination and a needed round was skipped.
 * A rename touches BOTH paths: the old one is gone from where the app lived, the new one arrived.
 * Every reader in scripts/qa asks here; `changed-paths-one-reader.test.ts` refuses a second
 * hand-rolled `--name-only` diff.
 */
import { spawnSync } from "node:child_process";

/** Arguments that make git print `--name-status -M -z` for whatever diff the caller asks for. */
export const NAME_STATUS_ARGS = ["--name-status", "-M", "-z"];

/**
 * Paths out of `git diff --name-status -M -z` output (NUL-separated): a rename gives its old path
 * AND its new path; a copy its new path (the source stays); anything else its one path.
 */
export function pathsFromNameStatus(out) {
  const parts = String(out ?? "").split("\0");
  const paths = [];
  for (let i = 0; i < parts.length; i += 1) {
    const status = parts[i];
    if (!status) continue;
    const kind = status[0];
    if (kind === "R") {
      if (parts[i + 1]) paths.push(parts[i + 1]);
      if (parts[i + 2]) paths.push(parts[i + 2]);
      i += 2;
    } else if (kind === "C") {
      if (parts[i + 2]) paths.push(parts[i + 2]);
      i += 2;
    } else {
      if (parts[i + 1]) paths.push(parts[i + 1]);
      i += 1;
    }
  }
  return [...new Set(paths)];
}

/** `git status --short` lines to paths; "R  old -> new" names both. */
export function pathsFromStatusLines(lines) {
  const unquote = (p) => p.trim().replace(/^"|"$/g, "");
  return lines.flatMap((l) => l.slice(3).split(" -> ").map(unquote)).filter(Boolean);
}

/** Paths a diff touches, rename sources included. `args` are the diff's own: e.g. [from, to] or ["a...b"]. */
export function diffPaths(args, opts = {}) {
  const r = spawnSync("git", ["diff", ...NAME_STATUS_ARGS, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  return pathsFromNameStatus(r.stdout);
}
