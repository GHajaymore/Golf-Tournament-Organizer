import { describe, it, expect } from "vitest";
import { readVerbatim } from "./source";
// Plain JavaScript on purpose: the pipeline runs on a bare runner.
import { decide } from "../../../scripts/qa/nightly-dedupe.mjs";

const SHA = "a".repeat(40);
const run = (databaseId: number, status: string, conclusion: string | null, headSha = SHA, clean = conclusion === "success") => ({ databaseId, status, conclusion, headSha, clean });

describe("a scheduled nightly is not run twice on one commit (B75)", () => {
  it("never skips a dispatched run, even with a clean nightly on the sha", () => {
    expect(decide([run(1, "completed", "success")], SHA, "workflow_dispatch", 2).skip).toBe(false);
  });
  it("skips on a same-sha success, in-progress or queued run, and names it", () => {
    for (const r of [run(7, "completed", "success"), run(7, "in_progress", null), run(7, "queued", null)]) {
      const d = decide([r], SHA, "schedule", 9);
      expect(d.skip).toBe(true);
      expect(d.reason).toBe(`Nightly: skipped — 7 already covers ${SHA}`);
    }
  });
  it("a skipped run (success, no clean Verdict) is not cover, and neither is any run without one", () => {
    expect(decide([run(7, "completed", "success", SHA, false)], SHA, "schedule", 9).skip).toBe(false);
  });
  it("runs when the only same-sha runs failed or were cancelled", () => {
    expect(decide([run(7, "completed", "failure"), run(8, "completed", "cancelled")], SHA, "schedule", 9).skip).toBe(false);
  });
  it("runs on a new sha, and does not count itself", () => {
    expect(decide([run(7, "completed", "success", "b".repeat(40))], SHA, "schedule", 9).skip).toBe(false);
    expect(decide([run(9, "in_progress", null)], SHA, "schedule", 9).skip).toBe(false);
  });
  it("is wired: round waits for it and deploy needs the round to have succeeded", () => {
    const wf = readVerbatim(".github/workflows/nightly.yml").replace(/\r\n/g, "\n");
    expect(wf).toContain("node scripts/qa/nightly-dedupe.mjs");
    expect(wf).toContain("needs: dedupe");
    expect(wf).toContain("if: ${{ !cancelled() && needs.dedupe.outputs.skip != 'true' }}");
    expect(wf).toContain("if: needs.round.result == 'success'");
  });
});
