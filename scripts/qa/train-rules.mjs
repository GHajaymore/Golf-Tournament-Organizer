/**
 * A TRAIN OF PULL REQUESTS, TESTED IN ONE ROUND — the rules, with no network and no git in them.
 *
 * Up to three clean pull requests are tested together: the train is main with each PR's head merged
 * in, in order, one commit per PR (a "step"). One round runs on the last step. Each PR then merges in
 * the same order, and a PR is the state the round tested only when its head's TREE is its own step's
 * tree: the first PR's head already is (it contains main), and each later one becomes it by taking
 * main after the PRs before it have merged. A head whose tree is not its step's has something the
 * round never saw, and does not merge on the train's verdict.
 *
 * `scripts/qa/train.mjs` gathers the facts (GitHub's API, git) and `train-git.mjs` builds the tree;
 * everything that decides is here, so every branch of it is unit-tested (train-builder.test.ts).
 * `.github/workflows/train.yml` runs it.
 */

/** A train holds at most this many PRs (the PM's rule since the first trains: three at most). */
export const MAX_MEMBERS = 3;

/** A label on any of these (any case) keeps a PR out of a train. */
export const BLOCKING_LABELS = ["do not merge", "do-not-merge", "hold", "on hold", "blocked", "wip", "wontfix", "invalid", "duplicate"];

/**
 * Who may say a QA gate on a PR. The repository is public: anybody can comment, so a gate line from
 * anyone else is text, not a gate.
 */
export const TRUSTED_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];

/** The branch a train's round runs on (round.yml reads the round number from its last part). */
export const trainBranch = (n) => `round/train-${n}-1`;

const short = (sha) => String(sha ?? "").slice(0, 8);
const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * The PRs asked for ("1129 1133", "#1129, #1133"), in the order they will merge.
 * @returns {{ prs: number[], problems: string[] }}
 */
export function parsePrList(text) {
  const words = String(text ?? "").split(/[\s,]+/).filter(Boolean);
  const problems = [];
  const prs = [];
  for (const w of words) {
    const m = /^#?(\d+)$/.exec(w);
    if (!m || Number(m[1]) <= 0) {
      problems.push(`"${w}" is not a pull request number`);
      continue;
    }
    const n = Number(m[1]);
    if (prs.includes(n)) problems.push(`#${n} is asked for twice`);
    else prs.push(n);
  }
  if (!words.length) problems.push("no pull requests were named");
  if (prs.length > MAX_MEMBERS) problems.push(`${prs.length} pull requests named; a train holds at most ${MAX_MEMBERS}`);
  return { prs, problems };
}

/**
 * Why one PR may not ride a train; empty when it may.
 * @param {{ number: number, state: string, baseRefName: string, headSha: string, fetchedSha: string,
 *   verify: string | null, containsMain: boolean, labels: string[], reviewDecision: string | null,
 *   workflowFiles: string[] }} m
 */
export function memberProblems(m, mainSha) {
  const n = `#${m.number}`;
  const out = [];
  if (m.state !== "OPEN") out.push(`${n} is ${String(m.state).toLowerCase()}, not open`);
  if (m.baseRefName !== "main") out.push(`${n} is for ${m.baseRefName}, not main`);
  if (!FULL_SHA.test(m.headSha ?? "")) out.push(`${n}: its head could not be read`);
  else if (!m.fetchedSha) out.push(`${n}: its head ${short(m.headSha)} could not be fetched`);
  else if (m.fetchedSha !== m.headSha) out.push(`${n}: its head moved while the train was built (${short(m.headSha)} → ${short(m.fetchedSha)}); ask again`);
  if (m.verify !== "success") out.push(`${n}: verify is ${m.verify ?? "not finished"} on its head ${short(m.headSha)}`);
  if (!m.containsMain) out.push(`${n}: its head ${short(m.headSha)} does not contain main ${short(mainSha)}; merge main into it first`);
  const blocking = (m.labels ?? []).filter((l) => BLOCKING_LABELS.includes(String(l).toLowerCase()));
  if (blocking.length) out.push(`${n} is labelled ${blocking.map((l) => `"${l}"`).join(", ")}`);
  if (m.reviewDecision === "CHANGES_REQUESTED") out.push(`${n} has a review asking for changes`);
  if ((m.workflowFiles ?? []).length) {
    out.push(`${n} changes ${m.workflowFiles.join(", ")}; a workflow's own token may not push workflow files, so this train is built by hand`);
  }
  return out;
}

/**
 * Why no round may start now (chain.sh's rules, said once): another change's round is running or
 * queued (one change in rounds at a time; several go together only as a train), or an open PR outside
 * the train already has a clean round and merges first, which would move main under this one.
 * @param {{ running: {branch: string, sha: string}[], open: {number: number, headSha: string}[],
 *   cleanShas: string[], memberHeads: string[] }} f
 */
export function roundsProblems({ running, open, cleanShas, memberHeads }) {
  const out = [];
  const busy = [...new Set(running.filter((r) => String(r.branch ?? "").startsWith("round/")).map((r) => r.branch))];
  if (busy.length) out.push(`another change is in rounds (${busy.join(", ")}); one change in rounds at a time, so ask again when it ends`);
  const clean = new Set(cleanShas);
  for (const o of open) {
    if (memberHeads.includes(o.headSha)) continue;
    if (clean.has(o.headSha)) out.push(`#${o.number}'s head ${short(o.headSha)} already has a clean round and merges first; merge it, bring these up to main, then build the train`);
  }
  return out;
}

/** The message of step k: a subject a person reads, and trailers the verdict and merge halves read back. */
export function stepMessage({ train, base, k, total, pr, head }) {
  return `Train ${train} step ${k}/${total}: #${pr}\n\nTrain: ${train}\nTrain-Base: ${base}\nTrain-Step: ${k}/${total} #${pr} ${head}\n`;
}

/**
 * The steps of a train, read back from its commits (newest first, as `git log --first-parent` gives
 * them, from the tip). Reading stops at the first commit that is not a step of the tip's train.
 * @param {{ sha: string, tree: string, message: string }[]} commits
 * @returns {{ train: number | null, base: string | null, steps: {k: number, pr: number, head: string, sha: string, tree: string}[], problems: string[] }}
 */
export function parseSteps(commits) {
  const read = (c) => {
    const t = /^Train: (\d+)\s*$/m.exec(c.message);
    const b = /^Train-Base: ([0-9a-f]{40})\s*$/m.exec(c.message);
    const s = /^Train-Step: (\d+)\/(\d+) #(\d+) ([0-9a-f]{40})\s*$/m.exec(c.message);
    if (!t || !b || !s) return null;
    return { train: Number(t[1]), base: b[1], k: Number(s[1]), total: Number(s[2]), pr: Number(s[3]), head: s[4], sha: c.sha, tree: c.tree };
  };
  const first = commits.length ? read(commits[0]) : null;
  if (!first) return { train: null, base: null, steps: [], problems: ["the tip is not a train step"] };
  const found = [];
  for (const c of commits) {
    const r = read(c);
    if (!r || r.train !== first.train) break;
    found.push(r);
  }
  const problems = [];
  const steps = found.reverse();
  if (steps.length !== first.total) problems.push(`train ${first.train} names ${first.total} steps; ${steps.length} were found`);
  steps.forEach((s, i) => {
    if (s.k !== i + 1) problems.push(`step ${i + 1} reads as step ${s.k}`);
    if (s.base !== first.base) problems.push(`step ${s.k} was built on ${short(s.base)}, the tip on ${short(first.base)}`);
  });
  return { train: first.train, base: first.base, steps: steps.map(({ k, pr, head, sha, tree }) => ({ k, pr, head, sha, tree })), problems };
}

/**
 * The refusal when PR `pr` would not merge onto the train so far: it names the pair (the earlier
 * member or members whose changes touch the conflicted files).
 * @param {{ pr: number, conflicted: string[], earlier: {pr: number, files: string[]}[] }} f
 */
export function conflictRefusal({ pr, conflicted, earlier }) {
  const hits = earlier.filter((e) => e.files.some((f) => conflicted.includes(f)));
  const names = (list) => list.map((e) => `#${e.pr}`).join(" and ");
  const files = conflicted.length ? conflicted.join(", ") : "files git did not name";
  if (!earlier.length) return `#${pr} does not merge onto main (${files}); merge main into it first`;
  if (!hits.length) return `#${pr} conflicts with the train so far (${names(earlier)}) in ${files}; train them separately`;
  return `#${pr} conflicts with ${names(hits)} in ${files}; train them separately, or merge one and bring the other up to main`;
}

/**
 * What must hold of a built train before its round is worth running.
 * Step 1's tree IS the first head's tree (the head contains main), and no two steps share a tree:
 * a PR that adds nothing to the train so far would match the step before it, and the merge half
 * could not tell which state it is.
 * @param {{ k: number, pr: number, tree: string, headTree: string }[]} steps
 */
export function stepProblems(steps) {
  const out = [];
  if (!steps.length) return ["the train has no steps"];
  if (steps[0].tree !== steps[0].headTree) out.push(`step 1's tree is not #${steps[0].pr}'s own tree; its head does not contain main`);
  const seen = new Map();
  for (const s of steps) {
    if (seen.has(s.tree)) out.push(`#${s.pr} adds nothing to the train: step ${s.k} has the tree of step ${seen.get(s.tree)}`);
    else seen.set(s.tree, s.k);
  }
  return out;
}

/**
 * The comment each member is told: the train, its step commits and their trees, and the verdict once
 * the round has said it (`round-verdict` on the tip, posted by round.yml's Verdict job).
 * @param {{ train: number | string, branch: string, base: string,
 *   steps: {k: number, pr: number, head: string, sha: string, tree: string}[],
 *   verdict: {state: string, description: string} | null, runUrl?: string | null }} a
 */
export function trainSummary({ train, branch, base, steps, verdict, runUrl }) {
  const tip = steps[steps.length - 1];
  const rows = steps.map((s) => `| ${s.k} | #${s.pr} | \`${short(s.head)}\` | \`${s.sha}\` | \`${s.tree}\` |`);
  const said = verdict
    ? `**Verdict:** ${verdict.state}: ${verdict.description}`
    : "**Verdict:** the round is running; the verdict is posted here when it ends.";
  return [
    `<!-- train:${train} -->`,
    `### Train ${train}: \`${branch}\``,
    "",
    `Built on main \`${base}\`; the round runs on the last step \`${tip?.sha ?? "?"}\`.`,
    "",
    "| Step | PR | Head | Step commit | Tree |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    said,
    runUrl ? `\n[The run](${runUrl})` : "",
    "",
    `They merge in this order. #${steps[0]?.pr} first; each later PR then takes main, and merges on this verdict only when its head's tree is its own step's tree above (\`node scripts/qa/train.mjs merge --train=${train}\` says whether it is).`,
  ].join("\n");
}

/** The line a QA gate says on a PR, for one exact head. */
export const gateLine = (pr, sha) => `GATE #${pr} ${sha} GO`;

/**
 * Whether the QA gate has said GO for this PR at this head: a line exactly `GATE #<pr> <sha> GO` in a
 * comment by somebody the repository trusts.
 * @param {{ body: string, authorAssociation: string }[]} comments
 */
export function gateFound(comments, pr, sha) {
  const want = gateLine(pr, sha);
  return comments.some(
    (c) => TRUSTED_ASSOCIATIONS.includes(c.authorAssociation) && String(c.body ?? "").split(/\r?\n/).some((l) => l.trim() === want),
  );
}

/**
 * THE MERGE HALF: which PR of a train merges next, or why none does. One PR per call, in order: a PR
 * merges only when every PR before it has merged, the train's round said clean, its head's tree is its
 * own step's tree, its head contains main, verify is green on that head, and the QA gate said GO for it.
 *
 * `tokenPresent` is the merge token (TRAIN_MERGE_TOKEN): a merge made with the workflow's own token
 * pushes to main without starting ci.yml, so nothing would deploy it.
 *
 * @param {{ tokenPresent: boolean, verdict: {state: string, description: string} | null,
 *   steps: {k: number, pr: number, tree: string}[],
 *   prs: Record<number, { state: string, headSha: string, headTree: string, verify: string | null, containsMain: boolean, gate: boolean }> }} f
 * @returns {{ action: "off" | "refuse" | "merge" | "done", reason: string, pr?: number, head?: string }}
 */
export function mergeDecision({ tokenPresent, verdict, steps, prs }) {
  if (!tokenPresent) return { action: "off", reason: "no merge token (TRAIN_MERGE_TOKEN): a merge with the workflow's own token would not start ci.yml, so nothing would deploy it" };
  if (!steps.length) return { action: "refuse", reason: "the train has no steps" };
  if (verdict?.state !== "success") return { action: "refuse", reason: `the train's round is not clean (${verdict ? `${verdict.state}: ${verdict.description}` : "no verdict on its tip"})` };
  const firstOpen = steps.findIndex((s) => prs[s.pr]?.state !== "MERGED");
  if (firstOpen === -1) return { action: "done", reason: "every PR of the train has merged" };
  const later = steps.slice(firstOpen + 1).find((s) => prs[s.pr]?.state === "MERGED");
  if (later) return { action: "refuse", reason: `#${later.pr} merged before #${steps[firstOpen].pr}: the train merged out of order, so its verdict no longer says what main holds; build a new train` };
  const s = steps[firstOpen];
  const p = prs[s.pr];
  const n = `#${s.pr}`;
  if (!p) return { action: "refuse", reason: `${n} could not be read` };
  if (p.state !== "OPEN") return { action: "refuse", reason: `${n} is ${String(p.state).toLowerCase()}; the train stops here, build a new one` };
  if (p.headTree !== s.tree) {
    const why = s.k > 1 ? `it has not taken main since #${steps[s.k - 2].pr} merged, or it changed after the round` : "it changed after the round";
    return { action: "refuse", reason: `${n}'s head ${short(p.headSha)} is not the state the round tested (its tree is not step ${s.k}'s): ${why}` };
  }
  if (!p.containsMain) return { action: "refuse", reason: `${n}'s head ${short(p.headSha)} does not contain main` };
  if (p.verify !== "success") return { action: "refuse", reason: `verify is ${p.verify ?? "not finished"} on ${n}'s head ${short(p.headSha)}` };
  if (!p.gate) return { action: "refuse", reason: `no QA gate for ${n} at ${short(p.headSha)} (a line "${gateLine(s.pr, p.headSha)}" from a member)` };
  return { action: "merge", pr: s.pr, head: p.headSha, reason: `${n} at ${short(p.headSha)} is step ${s.k}, the state the round tested` };
}
