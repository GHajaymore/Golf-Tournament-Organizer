import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource, readVerbatim } from "./source";
import { cleanRoundShas, isCleanVerdictFor, newestRoundVerdict } from "../../../scripts/qa/round-verdict.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);

// The tooling's view of GitHub: for each commit, the statuses on it, newest first.
function verdictsFrom(byCommit: Record<string, { context: string; state: string }[]>) {
  return (sha: string) => newestRoundVerdict(byCommit[sha] ?? [], sha);
}

describe("a round is clean by its OWN verdict (B99)", () => {
  it("CONTROL: a success verdict on the commit is clean", () => {
    const of = verdictsFrom({ [A]: [{ context: "round-verdict", state: "success" }] });
    expect(cleanRoundShas([A], of)).toEqual([A]);
  });

  it("a run that concluded success but whose verdict is failure is NOT clean", () => {
    // The run's conclusion is not an input: only the statuses are.
    const of = verdictsFrom({ [A]: [{ context: "round-verdict", state: "failure" }] });
    expect(cleanRoundShas([A], of)).toEqual([]);
  });

  it("a run that concluded success but posted no verdict is NOT clean", () => {
    expect(cleanRoundShas([A], verdictsFrom({ [A]: [{ context: "ci/other", state: "success" }] }))).toEqual([]);
    expect(cleanRoundShas([A], verdictsFrom({}))).toEqual([]);
  });

  it("a pending verdict is NOT clean", () => {
    expect(cleanRoundShas([A], verdictsFrom({ [A]: [{ context: "round-verdict", state: "pending" }] }))).toEqual([]);
  });

  it("a CLEAN verdict on a different sha does not count", () => {
    const clean = newestRoundVerdict([{ context: "round-verdict", state: "success" }], B);
    expect(isCleanVerdictFor(clean, B)).toBe(true);
    expect(isCleanVerdictFor(clean, A)).toBe(false);
    // A reader that handed back B's verdict when asked about A still cannot make A clean.
    expect(cleanRoundShas([A], () => clean)).toEqual([]);
  });

  it("the newest verdict wins, and each commit is listed once", () => {
    const of = verdictsFrom({
      [A]: [
        { context: "round-verdict", state: "failure" },
        { context: "round-verdict", state: "success" },
      ],
      [B]: [{ context: "round-verdict", state: "success" }],
    });
    expect(cleanRoundShas([A, B, B], of)).toEqual([B]);
  });
});

// ONE reader: no other tooling file or workflow may decide "clean" from a run's conclusion.
const QA = "scripts/qa";
const WORKFLOWS = ".github/workflows";

/** Lines that read a round run's conclusion as success, or use a *success* glob. */
function secondReaders(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*|#)/.test(l))
    .filter((l) => /\*success\*|success\*/.test(l) || (/round\//.test(l) && /conclusion/.test(l)));
}

describe("no second reader of a round's conclusion (B99 sweep)", () => {
  it("CONTROL: the sweep sees a glob reader and a round/-branch conclusion reader", () => {
    expect(secondReaders('if [[ "$c" == *success* ]]; then')).toHaveLength(1);
    expect(secondReaders('runs.filter((r) => r.headBranch.startsWith("round/") && r.conclusion === "success")')).toHaveLength(1);
    expect(secondReaders("// round/ conclusion in a comment")).toHaveLength(0);
  });

  it("scripts/qa and the workflows have none", () => {
    const files = [
      ...readdirSync(join(process.cwd(), QA)).filter((f) => f.endsWith(".mjs")).map((f) => `${QA}/${f}`),
      ...readdirSync(join(process.cwd(), WORKFLOWS)).filter((f) => f.endsWith(".yml")).map((f) => `${WORKFLOWS}/${f}`),
    ];
    expect(files.length).toBeGreaterThan(10);
    const found = files.flatMap((f) => secondReaders(readVerbatim(f)).map((l) => `${f}: ${l.trim()}`));
    expect(found).toEqual([]);
  });

  it("the train builder reads its clean rounds through the shared helper", () => {
    const src = readSource(QA, "train.mjs");
    expect(src).toContain("cleanRoundShas(");
    expect(src).toContain("isCleanVerdictFor(");
  });
});
