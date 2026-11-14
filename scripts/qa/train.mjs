#!/usr/bin/env node
/**
 * THE TRAIN BUILDER: up to three clean PRs tested together in one round, and merged in order.
 *
 *     node scripts/qa/train.mjs build --prs="1129 1133" --train=<n> [--push]
 *     node scripts/qa/train.mjs tell  --branch=round/train-<n>-1 [--sha=<tip>] [--run-url=<url>] [--out=train-summary.md]
 *     node scripts/qa/train.mjs merge --train=<n> [--yes]
 *
 * build   checks every PR (open, for main, verify green on its head, its head contains main, no
 *         blocking label, no review asking for changes, no workflow file), refuses while another
 *         change is in rounds or another PR's clean round is waiting to merge, builds main + each head
 *         in the order given (train-git.mjs), and refuses on a conflict naming the pair. With --push
 *         it pushes round/train-<n>-1 and starts round.yml on it (a push made with a workflow's own
 *         token starts no workflow, so the round is asked for by name). Without --push it is a dry
 *         run anybody can make: nothing leaves the machine.
 * tell    reads a train back from its branch and writes the comment for its members: the step
 *         commits and their trees, and the round's verdict once `round-verdict` is on the tip.
 *         On a runner it writes `members` to $GITHUB_OUTPUT.
 * merge   says which PR of the train merges next, or why none does (`mergeDecision`). It merges only
 *         with --yes AND a merge token in TRAIN_MERGE_TOKEN; train.yml's merge job is switched off.
 *
 * The rules are `train-rules.mjs` (unit-tested in train-builder.test.ts); this file gathers facts
 * from GitHub and git and does what the rules decide. Needs GH_TOKEN for `gh`, and the whole history.
 * Exit: 0 done (or nothing to do), 1 refused, 2 asked wrongly.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { roundPlan } from "./layers.mjs";
import { buildTrain, changedFiles, gitIn } from "./train-git.mjs";
import {
  gateFound,
  memberProblems,
  mergeDecision,
  MAX_MEMBERS,
  parsePrList,
  parseSteps,
  planProblem,
  roundsProblems,
  stepProblems,
  TRAIN_REF,
  trainBranch,
  trainSummary,
} from "./train-rules.mjs";

const args = process.argv.slice(2);
const command = args[0];
const value = (name) => (args.find((a) => a.startsWith(`--${name}=`)) ?? "").split("=").slice(1).join("=");
const has = (name) => args.includes(`--${name}`);
const REPO = process.env.GITHUB_REPOSITORY || "GHajaymore/Golf-Tournament-Organizer";
const git = gitIn(process.cwd());

function gh(a, token) {
  const env = token ? { ...process.env, GH_TOKEN: token } : process.env;
  const r = spawnSync("gh", a, { encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`gh ${a.slice(0, 3).join(" ")}: ${(r.stderr || String(r.error ?? "")).trim()}`);
  return r.stdout;
}
const ghJson = (a) => JSON.parse(gh(a) || "null");
const jsonLines = (text) => text.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));

function output(key, val) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${val}\n`);
}
function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}
function refuse(problems) {
  for (const p of problems) console.log(`REFUSED: ${p}`);
  summary(["### Train refused", "", ...problems.map((p) => `- ${p}`)].join("\n"));
  process.exit(1);
}
function usage(text) {
  console.error(text);
  process.exit(2);
}

/** The newest `verify` check run's conclusion on a commit (null while none has finished). */
function verifyOn(sha) {
  const runs = jsonLines(gh(["api", `repos/${REPO}/commits/${sha}/check-runs?per_page=100`, "--jq", '.check_runs[] | select(.name=="verify") | {id, status, conclusion}']));
  const newest = runs.sort((a, b) => b.id - a.id)[0];
  return newest?.status === "completed" ? newest.conclusion : null;
}

/** A PR's head, fetched: the sha git now holds for it. */
function fetchHead(pr) {
  const f = git("fetch", "-q", "origin", `refs/pull/${pr}/head`);
  return f.ok ? git("rev-parse", "FETCH_HEAD").out : "";
}

const contains = (ancestor, sha) => git("merge-base", "--is-ancestor", ancestor, sha).ok;

/** `round-verdict` on a commit (posted by round.yml's Verdict job), newest first. */
function verdictOn(sha) {
  const all = jsonLines(gh(["api", `repos/${REPO}/commits/${sha}/statuses?per_page=100`, "--jq", '.[] | select(.context=="round-verdict") | {state, description, target_url}']));
  return all[0] ?? null;
}

/** The first-parent commits from a tip, newest first, as parseSteps reads them. */
function commitsFrom(tip) {
  const log = git("log", "--first-parent", `-n${MAX_MEMBERS}`, "--format=%H%x1f%T%x1f%B%x1e", tip).out;
  return log.split("\x1e").map((c) => c.trim()).filter(Boolean).map((c) => {
    const [s, tree, message] = c.split("\x1f");
    return { sha: s, tree, message: message ?? "" };
  });
}

/** A train read back from its branch (or a given tip on it). */
function readTrain(branch, sha) {
  if (!/^round\/train-\d+-1$/.test(branch)) usage(`not a train's branch: "${branch}"`);
  const f = git("fetch", "-q", "origin", `refs/heads/${branch}`);
  if (!f.ok) refuse([`${branch} could not be fetched: ${f.err}`]);
  const tip = sha || git("rev-parse", "FETCH_HEAD").out;
  if (!git("cat-file", "-e", `${tip}^{commit}`).ok) refuse([`${tip} is not a commit here`]);
  const read = parseSteps(commitsFrom(tip));
  if (read.problems.length) refuse(read.problems.map((p) => `${branch}: ${p}`));
  return { tip, ...read };
}

/** Every train whose tip carries round-verdict success, read back through its steps. */
function cleanTrainsNow() {
  const ls = git("ls-remote", "--heads", "origin", "round/train-*");
  if (!ls.ok) refuse([`the trains could not be listed: ${ls.err}`]);
  const out = [];
  for (const line of ls.out.split(/\r?\n/).filter(Boolean)) {
    const [tip, ref] = line.split(/\s+/);
    if (!TRAIN_REF.test(ref) || verdictOn(tip)?.state !== "success") continue;
    if (!git("fetch", "-q", "origin", ref).ok) continue;
    const read = parseSteps(commitsFrom(tip));
    if (!read.problems.length) out.push({ train: read.train, steps: read.steps });
  }
  return out;
}

/** The roundPlan of everything between two commits: the Round workflow's own function. */
const planBetween = (from, to) => roundPlan(changedFiles(git, from, to));

if (command === "build") {
  const { prs, problems } = parsePrList(value("prs"));
  const train = value("train");
  if (!/^\d+$/.test(train)) usage("--train=<n> is a number");
  if (problems.length) refuse(problems);
  const branch = trainBranch(train);
  const fetched = git("fetch", "-q", "origin", "main");
  if (!fetched.ok) refuse([`main could not be fetched: ${fetched.err}`]);
  const base = git("rev-parse", "origin/main").out;
  const all = [];
  if (git("ls-remote", "--exit-code", "--heads", "origin", branch).ok) all.push(`${branch} already exists; a train's branch is used once`);

  const members = [];
  for (const pr of prs) {
    const v = ghJson(["pr", "view", String(pr), "-R", REPO, "--json", "number,state,baseRefName,headRefOid,labels,reviewDecision,isCrossRepository"]);
    const head = fetchHead(pr);
    const files = head ? changedFiles(git, base, head) : [];
    all.push(
      ...memberProblems(
        {
          number: pr,
          state: v.state,
          baseRefName: v.baseRefName,
          isCrossRepository: Boolean(v.isCrossRepository),
          // The same function the Round workflow plans a pushed branch with (layers.mjs).
          plan: roundPlan(files),
          headSha: v.headRefOid,
          fetchedSha: head,
          verify: verifyOn(v.headRefOid),
          containsMain: Boolean(head) && contains(base, head),
          labels: (v.labels ?? []).map((l) => l.name),
          reviewDecision: v.reviewDecision || null,
          workflowFiles: files.filter((f) => f.startsWith(".github/workflows/")),
        },
        base,
      ),
    );
    members.push({ pr, head: v.headRefOid });
  }
  const runs = ghJson(["run", "list", "-R", REPO, "--limit", "100", "--json", "headBranch,headSha,status,conclusion"]) ?? [];
  const open = (ghJson(["pr", "list", "-R", REPO, "--state", "open", "--limit", "100", "--json", "number,headRefOid"]) ?? []).map((o) => ({ number: o.number, headSha: o.headRefOid, headTree: "" }));
  const cleanTrains = cleanTrainsNow();
  // An open PR of a clean train whose head is no longer its step's head may have taken main: its tree says.
  for (const o of open) {
    if (prs.includes(o.number)) continue;
    const step = cleanTrains.flatMap((t) => t.steps).find((s) => s.pr === o.number);
    if (step && step.head !== o.headSha) {
      const h = fetchHead(o.number);
      o.headTree = h === o.headSha ? git("rev-parse", `${h}^{tree}`).out : "";
    }
  }
  all.push(
    ...roundsProblems({
      running: runs.filter((r) => r.status !== "completed").map((r) => ({ branch: r.headBranch, sha: r.headSha })),
      open,
      cleanShas: runs.filter((r) => String(r.headBranch ?? "").startsWith("round/") && r.conclusion === "success").map((r) => r.headSha),
      memberHeads: members.map((m) => m.head),
      members: prs,
      cleanTrains,
    }),
  );
  if (all.length) refuse(all);

  const built = buildTrain({ repo: process.cwd(), base, train, members });
  if (built.refusal) refuse([built.refusal]);
  const wrong = stepProblems(built.steps);
  // The whole train, planned as the Round workflow will plan its branch: one round, or no train.
  const whole = planProblem("the train", planBetween(base, built.steps[built.steps.length - 1].sha));
  if (whole) wrong.push(whole);
  if (wrong.length) refuse(wrong);

  const text = trainSummary({ train, branch, base, steps: built.steps, verdict: null });
  console.log(text);
  const tip = built.steps[built.steps.length - 1].sha;
  if (!has("push")) {
    console.log(`\nDry run: ${branch} would be ${tip}. Nothing was pushed.`);
    process.exit(0);
  }
  const ref = `refs/heads/${branch}`;
  if (!TRAIN_REF.test(ref)) refuse([`refuses to push ${ref}: only refs/heads/round/train-<n>-1`]);
  // The checkout keeps no credentials (persist-credentials: false); the token rides this one push only.
  const token = process.env.GH_TOKEN || "";
  const auth = token ? ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`] : [];
  const pushed = git(...auth, "push", "origin", `${tip}:${ref}`);
  if (!pushed.ok) refuse([`${branch} could not be pushed: ${pushed.err}`]);
  gh(["workflow", "run", "round.yml", "-R", REPO, "--ref", branch, "-f", "round=1", "-f", "schedule=pr", "-f", "countries=auto", "-f", "crawl=auto", "-f", "target=auto"]);
  console.log(`\nPushed ${branch} at ${tip} and started its round.`);
  summary(text);
  output("branch", branch);
  output("tip", tip);
} else if (command === "tell") {
  const branch = value("branch");
  const sha = value("sha");
  if (sha && !/^[0-9a-f]{40}$/.test(sha)) usage("--sha is a full sha");
  const t = readTrain(branch, sha);
  const verdict = verdictOn(t.tip);
  const text = trainSummary({ train: t.train, branch, base: t.base, steps: t.steps, verdict, runUrl: verdict?.target_url || value("run-url") || null });
  writeFileSync(value("out") || "train-summary.md", `${text}\n`);
  console.log(text);
  output("members", t.steps.map((s) => s.pr).join(" "));
} else if (command === "merge") {
  const train = value("train");
  if (!/^\d+$/.test(train)) usage("--train=<n> is a number");
  const t = readTrain(trainBranch(train), "");
  git("fetch", "-q", "origin", "main");
  const base = git("rev-parse", "origin/main").out;
  const prs = {};
  for (const s of t.steps) {
    const v = ghJson(["pr", "view", String(s.pr), "-R", REPO, "--json", "state,headRefOid"]);
    const head = v.state === "OPEN" ? fetchHead(s.pr) : "";
    prs[s.pr] = {
      state: v.state,
      headSha: v.headRefOid,
      headTree: head === v.headRefOid ? git("rev-parse", `${head}^{tree}`).out : "",
      verify: v.state === "OPEN" ? verifyOn(v.headRefOid) : null,
      containsMain: Boolean(head) && contains(base, head),
      gate:
        v.state === "OPEN" &&
        gateFound(
          jsonLines(gh(["api", "--paginate", `repos/${REPO}/issues/${s.pr}/comments?per_page=100`, "--jq", ".[] | {body, authorAssociation: .author_association}"])),
          s.pr,
          v.headRefOid,
        ),
    };
  }
  const token = process.env.TRAIN_MERGE_TOKEN || "";
  const d = mergeDecision({ tokenPresent: Boolean(token), verdict: verdictOn(t.tip), trainPlan: planBetween(t.base ?? base, t.tip), steps: t.steps, prs });
  console.log(`Train ${train}: ${d.action}: ${d.reason}`);
  summary(`### Train ${train}: ${d.action}\n\n${d.reason}`);
  if (d.action === "refuse") process.exit(1);
  if (d.action !== "merge") process.exit(0);
  if (!has("yes")) {
    console.log("Not merged: --yes was not given.");
    process.exit(0);
  }
  spawnSync("gh", ["pr", "ready", String(d.pr), "-R", REPO], { encoding: "utf8", env: { ...process.env, GH_TOKEN: token } });
  gh(["pr", "merge", String(d.pr), "-R", REPO, "--squash", "--match-head-commit", d.head], token);
  console.log(`Merged #${d.pr} at ${d.head}. The next PR takes main, then this is asked again.`);
} else {
  usage("usage: train.mjs build --prs=\"<n> <n>\" --train=<n> [--push] | tell --branch=round/train-<n>-1 [--sha=<sha>] | merge --train=<n> [--yes]");
}
