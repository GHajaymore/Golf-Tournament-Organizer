/**
 * A TRAIN'S TREE, BUILT WITH GIT: main, then each PR's head merged in order, one commit per PR.
 *
 * The building happens in a worktree of its own (removed afterwards), so the checkout that runs this
 * script is never switched to the PRs' code: on a runner, nothing a PR changes is ever executed here.
 * Every merge is `--no-ff`, so each PR is its own step even when it is a fast-forward of main (the
 * first always is: its head contains main), and step 1's tree is that head's own tree.
 *
 * The rules (what a step says, how a conflict is named) are `train-rules.mjs`; this file only runs git.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conflictRefusal, stepMessage } from "./train-rules.mjs";

// Who the step commits are by. Said on the command line, never written to any git config.
const IDENTITY = ["-c", "user.name=TourneyHQ train builder", "-c", "user.email=train-builder@example.invalid", "-c", "commit.gpgsign=false"];

/** A git runner for one directory: `git(...args)` → { ok, out, err }. */
export function gitIn(cwd) {
  return (...args) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() || (r.error ? String(r.error) : "") };
  };
}

/** The files a head changes against the base (three dots: from where they meet). */
export function changedFiles(git, base, head) {
  const r = git("diff", "--name-only", `${base}...${head}`);
  return r.ok ? r.out.split(/\r?\n/).filter(Boolean) : [];
}

/**
 * Build train `train` in repository `repo`: `base` with each member's head merged in order.
 * @param {{ repo: string, base: string, train: number | string, members: {pr: number, head: string}[] }} a
 * @returns {{ steps: {k: number, pr: number, head: string, sha: string, tree: string, headTree: string}[], refusal: string | null }}
 */
export function buildTrain({ repo, base, train, members }) {
  const git = gitIn(repo);
  const dir = mkdtempSync(join(tmpdir(), `train-${train}-`));
  const wt = join(dir, "w");
  const added = git("worktree", "add", "--detach", wt, base);
  if (!added.ok) {
    rmSync(dir, { recursive: true, force: true });
    return { steps: [], refusal: `could not start the train on ${String(base).slice(0, 8)}: ${added.err}` };
  }
  try {
    const w = gitIn(wt);
    const steps = [];
    for (const [i, m] of members.entries()) {
      const message = stepMessage({ train, base, k: i + 1, total: members.length, pr: m.pr, head: m.head });
      const r = w(...IDENTITY, "merge", "--no-ff", "--no-edit", "-m", message, m.head);
      if (!r.ok) {
        const conflicted = w("diff", "--name-only", "--diff-filter=U").out.split(/\r?\n/).filter(Boolean);
        w("merge", "--abort");
        if (!conflicted.length) return { steps, refusal: `#${m.pr} could not be merged onto the train: ${r.err || r.out}` };
        const earlier = members.slice(0, i).map((e) => ({ pr: e.pr, files: changedFiles(git, base, e.head) }));
        return { steps, refusal: conflictRefusal({ pr: m.pr, conflicted, earlier }) };
      }
      steps.push({
        k: i + 1,
        pr: m.pr,
        head: m.head,
        sha: w("rev-parse", "HEAD").out,
        tree: w("rev-parse", "HEAD^{tree}").out,
        headTree: git("rev-parse", `${m.head}^{tree}`).out,
      });
    }
    return { steps, refusal: null };
  } finally {
    git("worktree", "remove", "--force", wt);
    rmSync(dir, { recursive: true, force: true });
    git("worktree", "prune");
  }
}
