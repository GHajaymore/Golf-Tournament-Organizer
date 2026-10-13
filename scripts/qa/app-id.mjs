/**
 * THE APP A USER RUNS, AS ONE FINGERPRINT.
 *
 * A round certifies an app, not a commit. A commit that rewords the guide,
 * recolours the front door or adds a test is a different commit and the SAME
 * app: nothing an organizer or a player does goes through a line of it. So the
 * count of clean rounds belongs to this fingerprint — every tracked file that
 * `tierOf` calls function or core, and nothing else — and it survives exactly
 * the changes that cannot break what was tested (Ajay, 2026-10-13, about a
 * landing-page colour he would choose the next day: "which would not impact
 * your certification tonight").
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tierOf } from "./layers.mjs";

const lsTree = (ref) => spawnSync("git", ["ls-tree", "-r", ref], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout;

/** Twelve hex characters that are the same for two commits exactly when their function and core files are. */
export function appId(ref = "HEAD") {
  const hash = createHash("sha256");
  for (const line of lsTree(ref).split("\n")) {
    const [meta, path] = line.split("\t");
    if (!path) continue;
    const tier = tierOf(path);
    if (tier === "function" || tier === "core") hash.update(meta.split(" ")[2] + " " + path + "\n");
  }
  return hash.digest("hex").slice(0, 12);
}

/** Every path that differs between two commits, with the tier each belongs to. */
export function changedBetween(from, to = "HEAD") {
  const out = spawnSync("git", ["diff", "--name-only", from, to], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout;
  return out.split("\n").filter(Boolean).map((path) => ({ path, tier: tierOf(path) }));
}
