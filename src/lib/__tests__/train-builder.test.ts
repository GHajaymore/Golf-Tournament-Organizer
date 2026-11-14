import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readVerbatim } from "./source";
import { jobsOf } from "./workflow-jobs";
import {
  conflictRefusal,
  gateFound,
  gateLine,
  memberProblems,
  mergeDecision,
  parsePrList,
  parseSteps,
  planProblem,
  roundsProblems,
  stepMessage,
  stepProblems,
  TRAIN_REF,
  trainBranch,
  trainSummary,
} from "../../../scripts/qa/train-rules.mjs";
import { buildTrain } from "../../../scripts/qa/train-git.mjs";
import { ARITHMETIC, ARITHMETIC_KEEPS_THREE_ROUNDS, roundPlan } from "../../../scripts/qa/layers.mjs";

// Plans made by the Round workflow's own planner, never written by hand.
const ONE_ROUND = roundPlan(["src/components/BracketFlights.tsx"]);
const MONEY = roundPlan(["src/components/BracketFlights.tsx", "src/lib/domain/money.ts"]);
const TESTS_ONLY = roundPlan(["src/lib/__tests__/qa-pipeline.test.ts"]);

/**
 * THE TRAIN BUILDER (scripts/qa/train-rules.mjs, train-git.mjs, .github/workflows/train.yml).
 *
 * The guarantee: a PR merges on a train's verdict only when its head is EXACTLY a state the round
 * tested (its tree is its own step's tree), in the order the train was built, after the round said
 * clean; a train is never built from a PR that is not ready, and a conflict is refused naming the
 * pair. The git half is proved against a real repository made here, not described.
 */

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const MAIN = "0".repeat(40);

const ready = {
  number: 7,
  state: "OPEN",
  baseRefName: "main",
  headSha: A,
  fetchedSha: A,
  verify: "success" as string | null,
  containsMain: true,
  labels: [] as string[],
  reviewDecision: null as string | null,
  workflowFiles: [] as string[],
  isCrossRepository: false,
  plan: ONE_ROUND as { rounds: number; tier: string; arithmetic: string[] },
};

describe("a train is one round, so it holds only one-round changes (roundPlan, layers.mjs)", () => {
  it("the planner's own figures are what this rests on (control)", () => {
    expect(ONE_ROUND.rounds).toBe(1);
    expect(MONEY.arithmetic).toEqual(["src/lib/domain/money.ts"]);
    expect(ARITHMETIC).toContain("src/lib/domain/money.ts");
    expect(TESTS_ONLY.rounds).toBe(0);
  });
  it("money or handicap arithmetic keeps three rounds and is refused from a train, by name", () => {
    expect(MONEY.rounds).toBe(ARITHMETIC_KEEPS_THREE_ROUNDS ? 3 : 1);
    const p = memberProblems({ ...ready, plan: MONEY }, MAIN);
    if (ARITHMETIC_KEEPS_THREE_ROUNDS) {
      expect(p).toEqual([
        "#7 is money or handicap arithmetic (src/lib/domain/money.ts), which keeps three rounds; it is rounded alone through chain.sh, never on a train's one round",
      ]);
    } else {
      expect(p).toEqual([]);
    }
  });
  it("a change that needs no round merges on CI alone, and a one-round change rides", () => {
    expect(planProblem("#7", TESTS_ONLY)).toBe("#7 needs no round (tests): it merges on CI alone, so it does not ride a train");
    expect(planProblem("#7", ONE_ROUND)).toBeNull();
    expect(planProblem("#7", { rounds: 2, tier: "core", arithmetic: [] })).toBe("#7 needs 2 rounds; a train runs one");
  });
  it("a fork's PR does not ride (its code would run with this repository's round secrets)", () => {
    expect(memberProblems({ ...ready, isCrossRepository: true }, MAIN)[0]).toContain("comes from a fork");
  });
  it("only a train's own branch may be pushed", () => {
    expect(TRAIN_REF.test(`refs/heads/${trainBranch(12)}`)).toBe(true);
    for (const r of ["refs/heads/main", "refs/heads/round/train-12-2", "refs/heads/round/train-x-1", "refs/heads/round/train-12-1/x", "round/train-12-1"]) {
      expect(TRAIN_REF.test(r), r).toBe(false);
    }
  });
});

describe("which PRs are asked for", () => {
  it("reads numbers in order, with or without #, commas or spaces", () => {
    expect(parsePrList("1129 #1133,1134")).toEqual({ prs: [1129, 1133, 1134], problems: [] });
  });
  it("refuses nothing, junk, a repeat and more than three", () => {
    expect(parsePrList("").problems).toEqual(["no pull requests were named"]);
    expect(parsePrList("12 x1").problems).toEqual(['"x1" is not a pull request number']);
    expect(parsePrList("12 #12").problems).toEqual(["#12 is asked for twice"]);
    expect(parsePrList("1 2 3 4").problems).toEqual(["4 pull requests named; a train holds at most 3"]);
  });
  it("names the branch a round reads its number from", () => {
    expect(trainBranch(42)).toBe("round/train-42-1");
  });
});

describe("a PR rides a train only when it is ready", () => {
  it("a ready PR has no problems", () => {
    expect(memberProblems(ready, MAIN)).toEqual([]);
  });
  it("names each reason a PR is kept out", () => {
    const cases: [Partial<typeof ready>, string][] = [
      [{ state: "MERGED" }, "#7 is merged, not open"],
      [{ baseRefName: "dev" }, "#7 is for dev, not main"],
      [{ fetchedSha: "" }, "could not be fetched"],
      [{ fetchedSha: B }, "its head moved while the train was built"],
      [{ verify: null }, "verify is not finished on its head aaaaaaaa"],
      [{ verify: "failure" }, "verify is failure"],
      [{ containsMain: false }, "does not contain main 00000000"],
      [{ labels: ["Do-Not-Merge"] }, 'labelled "Do-Not-Merge"'],
      [{ reviewDecision: "CHANGES_REQUESTED" }, "a review asking for changes"],
      [{ workflowFiles: [".github/workflows/x.yml"] }, "built by hand"],
    ];
    for (const [change, said] of cases) {
      const p = memberProblems({ ...ready, ...change }, MAIN);
      expect(p, JSON.stringify(change)).toHaveLength(1);
      expect(p[0]).toContain(said);
    }
  });
  it("a label that is not a blocking one, and an approved review, keep nobody out", () => {
    expect(memberProblems({ ...ready, labels: ["enhancement"], reviewDecision: "APPROVED" }, MAIN)).toEqual([]);
  });
});

describe("no train while another change is in rounds", () => {
  const quiet = { running: [], open: [], cleanShas: [], memberHeads: [A] };
  it("is quiet when nothing else is", () => {
    expect(roundsProblems(quiet)).toEqual([]);
  });
  it("refuses while another round runs (other workflows do not count)", () => {
    const running = [{ branch: "round/x-1", sha: B }, { branch: "main", sha: C }, { branch: "round/x-1", sha: B }];
    expect(roundsProblems({ ...quiet, running })).toEqual(["another change is in rounds (round/x-1); one change in rounds at a time, so ask again when it ends"]);
  });
  it("refuses while another PR's clean round waits to merge, but not a member's own", () => {
    const open = [{ number: 5, headSha: B }, { number: 7, headSha: A }];
    const p = roundsProblems({ ...quiet, open, cleanShas: [A, B] });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("#5's head bbbbbbbb already has a clean round");
  });
  describe("a clean TRAIN waiting to merge is seen through its steps (its round ran on its tip, no PR's head)", () => {
    const train9 = { train: 9, steps: [{ pr: 5, head: B, tree: "T5" }, { pr: 6, head: C, tree: "T6" }] };
    const building7 = { ...quiet, members: [7], cleanTrains: [train9] };
    const said = "#5 is in train 9, whose round is clean and waits to merge; merge that train, bring these up to main, then build this one";
    it("an open member at its step's head", () => {
      expect(roundsProblems({ ...building7, open: [{ number: 5, headSha: B }] })).toEqual([said]);
    });
    it("an open member that took main (a new head with its step's tree)", () => {
      expect(roundsProblems({ ...building7, open: [{ number: 5, headSha: A.replace(/a/g, "d"), headTree: "T5" }] })).toEqual([said]);
    });
    it("not a member whose head has moved on (the train no longer speaks for it), nor one of the train being built", () => {
      expect(roundsProblems({ ...building7, open: [{ number: 5, headSha: A.replace(/a/g, "d"), headTree: "other" }] })).toEqual([]);
      expect(roundsProblems({ ...building7, members: [5, 7], open: [{ number: 5, headSha: B }] })).toEqual([]);
      expect(roundsProblems({ ...building7, cleanTrains: [], open: [{ number: 5, headSha: B }] })).toEqual([]);
    });
  });
});

describe("a train is read back from its own commits", () => {
  const msg = (k: number, total: number, pr: number, head: string, train = 9, base = MAIN) => stepMessage({ train, base, k, total, pr, head });
  const tip = [
    { sha: "3".repeat(40), tree: "t3", message: msg(3, 3, 30, C) },
    { sha: "2".repeat(40), tree: "t2", message: msg(2, 3, 20, B) },
    { sha: "1".repeat(40), tree: "t1", message: msg(1, 3, 10, A) },
  ];
  it("in order, oldest step first", () => {
    const r = parseSteps(tip);
    expect(r.problems).toEqual([]);
    expect(r.train).toBe(9);
    expect(r.base).toBe(MAIN);
    expect(r.steps.map((s) => [s.k, s.pr, s.head, s.tree])).toEqual([[1, 10, A, "t1"], [2, 20, B, "t2"], [3, 30, C, "t3"]]);
  });
  it("stops at a commit of another train, and says a step is missing", () => {
    const r = parseSteps([tip[0], tip[1], { sha: "4".repeat(40), tree: "t4", message: msg(1, 3, 10, A, 8) }]);
    expect(r.problems).toEqual(["train 9 names 3 steps; 2 were found", "step 1 reads as step 2", "step 2 reads as step 3"]);
  });
  it("refuses a tip that is not a step", () => {
    expect(parseSteps([{ sha: A, tree: "t", message: "Merge main" }]).problems).toEqual(["the tip is not a train step"]);
  });
});

describe("what must hold of a built train", () => {
  it("step 1 is the first head's own tree, and no two steps share a tree", () => {
    expect(stepProblems([{ k: 1, pr: 1, tree: "x", headTree: "x" }, { k: 2, pr: 2, tree: "y", headTree: "z" }])).toEqual([]);
    expect(stepProblems([{ k: 1, pr: 1, tree: "x", headTree: "w" }])[0]).toContain("does not contain main");
    expect(stepProblems([{ k: 1, pr: 1, tree: "x", headTree: "x" }, { k: 2, pr: 2, tree: "x", headTree: "q" }])).toEqual([
      "#2 adds nothing to the train: step 2 has the tree of step 1",
    ]);
  });
  it("a conflict names the pair", () => {
    const earlier = [{ pr: 1, files: ["a.txt"] }, { pr: 2, files: ["b.txt"] }];
    expect(conflictRefusal({ pr: 3, conflicted: ["b.txt"], earlier })).toBe(
      "#3 conflicts with #2 in b.txt; train them separately, or merge one and bring the other up to main",
    );
    expect(conflictRefusal({ pr: 3, conflicted: ["c.txt"], earlier })).toContain("conflicts with the train so far (#1 and #2)");
  });
  it("the comment holds every step commit and tree, and the verdict once said", () => {
    const steps = [{ k: 1, pr: 10, head: A, sha: "1".repeat(40), tree: "e".repeat(40) }, { k: 2, pr: 20, head: B, sha: "2".repeat(40), tree: "f".repeat(40) }];
    const running = trainSummary({ train: 4, branch: trainBranch(4), base: MAIN, steps, verdict: null });
    for (const s of steps) {
      expect(running).toContain(s.sha);
      expect(running).toContain(s.tree);
    }
    expect(running).toContain("the round is running");
    expect(running).toContain("<!-- train:4 -->");
    const said = trainSummary({ train: 4, branch: trainBranch(4), base: MAIN, steps, verdict: { state: "success", description: "CLEAN" } });
    expect(said).toContain("**Verdict:** success: CLEAN");
  });
});

describe("the QA gate is a member's exact line for this head", () => {
  const line = gateLine(7, A);
  it("found from a member, an owner or a collaborator", () => {
    expect(gateFound([{ body: `ok\r\n${line}\n`, authorAssociation: "MEMBER" }], 7, A)).toBe(true);
    expect(gateFound([{ body: line, authorAssociation: "OWNER" }], 7, A)).toBe(true);
  });
  it("not from a stranger (the repository is public), not for another head or PR, not inside a sentence", () => {
    expect(gateFound([{ body: line, authorAssociation: "NONE" }], 7, A)).toBe(false);
    expect(gateFound([{ body: line, authorAssociation: "CONTRIBUTOR" }], 7, A)).toBe(false);
    expect(gateFound([{ body: line, authorAssociation: "MEMBER" }], 7, B)).toBe(false);
    expect(gateFound([{ body: line, authorAssociation: "MEMBER" }], 8, A)).toBe(false);
    expect(gateFound([{ body: `not yet: ${line}`, authorAssociation: "MEMBER" }], 7, A)).toBe(false);
  });
});

describe("the merge half: one PR at a time, in order, only the tested state", () => {
  const steps = [{ k: 1, pr: 10, tree: "T1" }, { k: 2, pr: 20, tree: "T2" }];
  const open = (headTree: string, more = {}) => ({ state: "OPEN", headSha: A, headTree, verify: "success" as string | null, containsMain: true, gate: true, ...more });
  const clean = { state: "success", description: "CLEAN" };
  const base = { tokenPresent: true, verdict: clean, trainPlan: ONE_ROUND, steps, prs: { 10: open("T1"), 20: open("X") } };

  it("is off without the merge token", () => {
    expect(mergeDecision({ ...base, tokenPresent: false }).action).toBe("off");
  });
  it("never merges money or handicap arithmetic on a train's one round", () => {
    const d = mergeDecision({ ...base, trainPlan: MONEY });
    expect(d.action).toBe(ARITHMETIC_KEEPS_THREE_ROUNDS ? "refuse" : "merge");
    if (ARITHMETIC_KEEPS_THREE_ROUNDS) expect(d.reason).toContain("src/lib/domain/money.ts");
  });
  it("merges the first PR when its head is step 1", () => {
    expect(mergeDecision(base)).toMatchObject({ action: "merge", pr: 10, head: A });
  });
  it("refuses a round that is not clean, or has no verdict", () => {
    expect(mergeDecision({ ...base, verdict: { state: "failure", description: "NOT CLEAN" } }).reason).toContain("not clean (failure: NOT CLEAN)");
    expect(mergeDecision({ ...base, verdict: null }).reason).toContain("no verdict on its tip");
  });
  it("the second waits until it has taken main: its tree must be step 2's", () => {
    const after = { ...base, prs: { 10: { ...open("T1"), state: "MERGED" }, 20: open("X") } };
    const d = mergeDecision(after);
    expect(d.action).toBe("refuse");
    expect(d.reason).toContain("it has not taken main since #10 merged");
    expect(mergeDecision({ ...after, prs: { ...after.prs, 20: open("T2") } })).toMatchObject({ action: "merge", pr: 20 });
  });
  it("a head that matches ANOTHER step is not its state (only its own step counts)", () => {
    const after = { ...base, prs: { 10: { ...open("T1"), state: "MERGED" }, 20: open("T1") } };
    expect(mergeDecision(after).action).toBe("refuse");
  });
  it("refuses verify not green, a head without main, and no gate", () => {
    expect(mergeDecision({ ...base, prs: { ...base.prs, 10: open("T1", { verify: null }) } }).reason).toContain("verify is not finished");
    expect(mergeDecision({ ...base, prs: { ...base.prs, 10: open("T1", { containsMain: false }) } }).reason).toContain("does not contain main");
    expect(mergeDecision({ ...base, prs: { ...base.prs, 10: open("T1", { gate: false }) } }).reason).toContain(`"${gateLine(10, A)}"`);
  });
  it("refuses a train merged out of order, and a closed member", () => {
    expect(mergeDecision({ ...base, prs: { 10: open("T1"), 20: { ...open("T2"), state: "MERGED" } } }).reason).toContain("out of order");
    expect(mergeDecision({ ...base, prs: { ...base.prs, 10: { ...open("T1"), state: "CLOSED" } } }).reason).toContain("closed");
  });
  it("is done when all have merged", () => {
    expect(mergeDecision({ ...base, prs: { 10: { ...open("T1"), state: "MERGED" }, 20: { ...open("T2"), state: "MERGED" } } }).action).toBe("done");
  });
});

/**
 * Against a real repository: main, three PRs (two touch different files, the third conflicts with
 * the first). The train is built, step 1 is the first head's tree, and after the first PR is
 * squash-merged and the second takes main, the second's head tree IS step 2's.
 */
describe("the train, built with git", () => {
  let repo = "";
  const g = (...a: string[]) => {
    const r = spawnSync("git", ["-c", "user.name=zz-train", "-c", "user.email=zz-train@example.invalid", "-c", "commit.gpgsign=false", ...a], { cwd: repo, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const commitFile = (file: string, text: string, msg: string) => {
    writeFileSync(join(repo, file), text);
    g("add", file);
    g("commit", "-q", "-m", msg);
    return g("rev-parse", "HEAD");
  };
  let main = "";
  const heads: Record<number, string> = {};

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "zz-train-"));
    g("init", "-q");
    commitFile("a.txt", "a\n", "main");
    commitFile("b.txt", "b\n", "main 2");
    main = g("rev-parse", "HEAD");
    for (const [pr, file, text] of [[1, "a.txt", "a from 1\n"], [2, "b.txt", "b from 2\n"], [3, "a.txt", "a from 3\n"]] as const) {
      g("checkout", "-q", "--detach", main);
      heads[pr] = commitFile(file, text, `pr ${pr}`);
    }
  });
  afterAll(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
  });

  it("builds one step per PR, and the tree-step rule holds through a real merge in order", () => {
    const built = buildTrain({ repo, base: main, train: 5, members: [{ pr: 1, head: heads[1] }, { pr: 2, head: heads[2] }] });
    expect(built.refusal).toBeNull();
    expect(built.steps.map((s) => s.pr)).toEqual([1, 2]);
    expect(stepProblems(built.steps)).toEqual([]);
    // Step 1 is #1's head exactly.
    expect(built.steps[0].tree).toBe(g("rev-parse", `${heads[1]}^{tree}`));
    // Read back from the commits, as `tell` and `merge` do.
    const log = g("log", "--first-parent", "-n3", "--format=%H%x1f%T%x1f%B%x1e", built.steps[1].sha);
    const commits = log.split("\x1e").map((c) => c.trim()).filter(Boolean).map((c) => {
      const [sha, tree, message] = c.split("\x1f");
      return { sha, tree, message };
    });
    const read = parseSteps(commits);
    expect(read.problems).toEqual([]);
    expect(read.steps.map((s) => [s.pr, s.head, s.tree])).toEqual(built.steps.map((s) => [s.pr, s.head, s.tree]));
    // #1 squash-merges into main; #2 takes main; #2's tree is now step 2's.
    g("checkout", "-q", "--detach", main);
    g("merge", "-q", "--squash", heads[1]);
    g("commit", "-q", "-m", "#1 squashed");
    const main2 = g("rev-parse", "HEAD");
    g("checkout", "-q", "--detach", heads[2]);
    g("merge", "-q", "--no-edit", main2);
    const head2 = g("rev-parse", "HEAD");
    expect(g("rev-parse", `${head2}^{tree}`)).toBe(built.steps[1].tree);
    const d = mergeDecision({
      tokenPresent: true,
      verdict: { state: "success", description: "CLEAN" },
      trainPlan: ONE_ROUND,
      steps: read.steps,
      prs: {
        1: { state: "MERGED", headSha: heads[1], headTree: "", verify: "success", containsMain: true, gate: true },
        2: { state: "OPEN", headSha: head2, headTree: g("rev-parse", `${head2}^{tree}`), verify: "success", containsMain: true, gate: true },
      },
    });
    expect(d).toMatchObject({ action: "merge", pr: 2, head: head2 });
  });

  it("refuses a conflict, naming the pair, and leaves no worktree behind", () => {
    const built = buildTrain({ repo, base: main, train: 6, members: [{ pr: 1, head: heads[1] }, { pr: 2, head: heads[2] }, { pr: 3, head: heads[3] }] });
    expect(built.refusal).toBe("#3 conflicts with #1 in a.txt; train them separately, or merge one and bring the other up to main");
    expect(built.steps.map((s) => s.pr)).toEqual([1, 2]);
    expect(g("worktree", "list").split("\n")).toHaveLength(1);
  });
});

describe("train.yml", () => {
  const flow = readVerbatim(".github/workflows/train.yml").replace(/\r\n/g, "\n");
  const jobs = jobsOf(flow);

  it("THE MERGE SWITCH IS OFF: the merge job can never run, and merges with Ajay's token only", () => {
    expect(jobs.merge).toMatch(/\n {4}if: false && /);
    expect(jobs.merge).toContain("TRAIN_MERGE_TOKEN: ${{ secrets.TRAIN_MERGE_TOKEN }}");
    expect(jobs.merge).toContain("node scripts/qa/train.mjs merge");
    // Nothing else in the file merges (comments aside).
    const rest = flow.replace(jobs.merge, "").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    expect(rest).not.toMatch(/train\.mjs merge|gh pr merge/);
  });
  it("the build job builds, pushes and starts the round through train.mjs, and only it writes contents", () => {
    expect(jobs.build).toContain('node scripts/qa/train.mjs build --prs="$PRS" --train="$TRAIN" --push');
    expect(jobs.build).toMatch(/contents: write/);
    expect(jobs.tell).not.toMatch(/contents: write/);
    expect(jobs.merge).not.toMatch(/: write/);
  });
  it("no checkout leaves a token in .git/config for a later step", () => {
    const checkouts = flow.split("- uses: actions/checkout@v4").slice(1).map((c) => c.split("\n      - ")[0]);
    expect(checkouts).toHaveLength(3);
    for (const c of checkouts) expect(c).toContain("persist-credentials: false");
  });
  it("the members are told again when a train's round ends", () => {
    expect(flow).toMatch(/workflow_run:\n {4}workflows: \["Round"\]\n {4}types: \[completed\]/);
    expect(jobs.tell).toContain("startsWith(github.event.workflow_run.head_branch, 'round/train-')");
  });
  it("what a person types reaches the shell through env, never pasted into a script", () => {
    const lines = flow.split("\n");
    const scripts: string[] = [];
    lines.forEach((l, i) => {
      const m = /^(\s+)run: (.*)$/.exec(l);
      if (!m) return;
      scripts.push(m[2]);
      for (let j = i + 1; j < lines.length && (lines[j].trim() === "" || lines[j].search(/\S/) > m[1].length); j++) scripts.push(lines[j]);
    });
    expect(scripts.length).toBeGreaterThan(4);
    expect(scripts.join("\n")).not.toMatch(/\$\{\{/);
  });
});
