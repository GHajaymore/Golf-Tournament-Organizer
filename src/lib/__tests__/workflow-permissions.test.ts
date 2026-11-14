import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readVerbatim } from "./source";

/**
 * Every workflow declares what its token may do (code scanning's
 * "missing-workflow-permissions"), and grants a write scope only where this
 * list says why. A new write is a deliberate line here, not an accident.
 * Key: "<workflow file>: <scope>". Reasons are what the workflow does today.
 */
export const WRITE_ALLOWLIST: Record<string, string> = {
  "ci.yml: deployments": "the deploy job calls deploy.yml, which records the production deployment",
  "deploy.yml: deployments": "records what production holds as a GitHub deployment to tourneyhq-production",
  "nightly.yml: statuses": "the round it calls posts its verdict on the tested commit (reader.mjs --post)",
  "nightly.yml: deployments": "after a clean verdict it calls deploy.yml, which records the deployment",
  "weekly.yml: statuses": "the round it calls posts its verdict on the tested commit (reader.mjs --post)",
  "round.yml: statuses": "the verdict job says the verdict on the commit it tested (last step)",
  "nightly-nudge.yml: actions": "starts the Nightly round (gh workflow run) when a merge waits for it; the job holds no secret",
  "round-waiter.yml: actions": "re-runs a round the machine did not finish (gh run rerun)",
  "train.yml: contents": "the build job pushes the train to round/train-<n>-1 (scripts/qa/train.mjs pushes no other ref)",
  "train.yml: actions": "the build job starts round.yml on the train (a push made with the job's own token starts no workflow)",
  "train.yml: pull-requests": "the tell job comments the train and its verdict on each member",
};

/** Problems found in one workflow's text; empty means it is fine. */
export function permissionProblems(file: string, text: string): string[] {
  const lines = text.split(/\r?\n/);
  const problems: string[] = [];
  let topLevel = false;
  for (let i = 0; i < lines.length; i++) {
    const m = /^( *)permissions:\s*(.*?)\s*(?:#.*)?$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    if (indent !== 0 && indent !== 4) continue; // top level, or a job's own
    if (indent === 0) topLevel = true;
    const where = indent === 0 ? "top level" : "a job";
    const inline = m[2];
    if (inline === "write-all" || inline === "read-all") {
      problems.push(`${file}: ${inline} at ${where} is refused; name each scope`);
      continue;
    }
    if (inline !== "" && inline !== "{}") {
      problems.push(`${file}: permissions at ${where} is written in a shape this test cannot read (${inline})`);
      continue;
    }
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === "" || /^\s*#/.test(l)) continue;
      const e = /^( +)([\w-]+):\s*(\w[\w-]*)\s*(?:#.*)?$/.exec(l);
      if (!e || e[1].length !== indent + 2) break;
      if (e[3] === "write" && !WRITE_ALLOWLIST[`${file}: ${e[2]}`]) {
        problems.push(`${file}: ${e[2]}: write at ${where} is not in WRITE_ALLOWLIST`);
      }
    }
  }
  if (!topLevel) problems.push(`${file}: has no top-level permissions: block`);
  return problems;
}

describe("every workflow declares its token permissions", () => {
  const files = readdirSync(".github/workflows").filter((f) => f.endsWith(".yml"));

  it("finds the workflows (control: the sweep is not looking at nothing)", () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
  });

  for (const f of files) {
    it(`${f}: a top-level block, and writes only where allowed`, () => {
      expect(permissionProblems(f, readVerbatim(".github/workflows", f))).toEqual([]);
    });
  }

  it("every allowlist entry is still used (a stale entry is a grant nobody needs)", () => {
    const used = new Set<string>();
    for (const f of files) {
      const t = readVerbatim(".github/workflows", f);
      for (const k of Object.keys(WRITE_ALLOWLIST)) {
        const [file, scope] = k.split(": ");
        if (file === f && new RegExp(`^\\s+${scope}:\\s*write\\b`, "m").test(t)) used.add(k);
      }
    }
    expect([...used].sort()).toEqual(Object.keys(WRITE_ALLOWLIST).sort());
  });
});

describe("the check can see what it guards against (controls, in memory)", () => {
  const ok = "name: x\npermissions:\n  contents: read\n\njobs:\n  a:\n    runs-on: ubuntu-latest\n";

  it("passes a clean workflow", () => {
    expect(permissionProblems("x.yml", ok)).toEqual([]);
  });
  it("sees a missing top-level block", () => {
    expect(permissionProblems("x.yml", "name: x\njobs:\n  a:\n    runs-on: ubuntu-latest\n")).toEqual([
      "x.yml: has no top-level permissions: block",
    ]);
  });
  it("does not take a job's block for the top-level one", () => {
    const t = "name: x\njobs:\n  a:\n    permissions:\n      contents: read\n";
    expect(permissionProblems("x.yml", t)).toEqual(["x.yml: has no top-level permissions: block"]);
  });
  it("sees an unlisted write at the top level and in a job", () => {
    expect(permissionProblems("x.yml", ok.replace("contents: read", "contents: write"))).toEqual([
      "x.yml: contents: write at top level is not in WRITE_ALLOWLIST",
    ]);
    const job = ok + "    permissions:\n      issues: write\n";
    expect(permissionProblems("x.yml", job)).toEqual(["x.yml: issues: write at a job is not in WRITE_ALLOWLIST"]);
  });
  it("sees a listed scope granted in the wrong workflow", () => {
    expect(permissionProblems("x.yml", ok.replace("contents: read", "deployments: write")).length).toBe(1);
  });
  it("allows a listed write in its own workflow", () => {
    expect(permissionProblems("deploy.yml", ok.replace("contents: read", "deployments: write"))).toEqual([]);
  });
  it("sees a write after a comment inside the block", () => {
    const t = ok.replace("contents: read", "contents: read\n  # why\n  packages: write");
    expect(permissionProblems("x.yml", t)).toEqual(["x.yml: packages: write at top level is not in WRITE_ALLOWLIST"]);
  });
  it("refuses write-all and read-all outright", () => {
    expect(permissionProblems("x.yml", "permissions: write-all\n")[0]).toContain("write-all");
    expect(permissionProblems("x.yml", "permissions: read-all\n")[0]).toContain("read-all");
  });
});
