import { describe, it, expect } from "vitest";
import { NOT_PARTS, STATUS_CONTEXT, line, pageStatus, runState, statusForVerdict } from "../../../scripts/qa/reader.mjs";
import { readVerbatim } from "./source";

/**
 * THE ONE STATUS READER (`scripts/qa/reader.mjs`, delivery panel item (g)).
 *
 * In the week before it, twenty rounds were lost to the watching: watchers hit
 * GitHub's burst limit and then reported a round that had run 4 of its 36 parts
 * as finished. Each rule below has the case that must go red if it slips.
 */

const ROUND = { id: 1, name: "Round", path: ".github/workflows/round.yml", head_branch: "round/x-1", head_sha: "a".repeat(40), html_url: "https://example.invalid/run/1" };
const job = (name: string, status = "completed", conclusion: string | null = "success") => ({ name, status, conclusion });
const fixed = (verdict: [string, string | null] = ["completed", "success"]) => [job("Plan"), job("Database suite and the one build"), job("The packages the browsers need"), job("Verdict", ...verdict)];

describe("finished means the Verdict job finished, with every planned part done", () => {
  it("4 of 36 parts done is in flight, whatever else is quiet", () => {
    const parts = Array.from({ length: 36 }, (_, i) => job(`part-${i}`, i < 4 ? "completed" : "queued", i < 4 ? "success" : null));
    const r = runState({ ...ROUND, status: "in_progress" }, [...fixed(["queued", null]), ...parts], null);
    expect(r.state).toBe("in flight");
    expect(r.parts).toEqual({ done: 4, planned: 36 });
  });

  it("a Verdict that finished with a part still running is not finished (the counts must agree)", () => {
    const r = runState({ ...ROUND, status: "in_progress" }, [...fixed(), job("part-1"), job("part-2", "in_progress", null)], null);
    expect(r.state).toBe("in flight");
  });

  it("every part done and the Verdict finished is finished, with the verdict the round posted", () => {
    const posted = { context: STATUS_CONTEXT, state: "success", description: "G1: CLEAN — 9 of 9 layers, 0 finding(s)" };
    const r = runState({ ...ROUND, status: "completed", conclusion: "success" }, [...fixed(), job("part-1"), job("part-2")], posted);
    expect(r.state).toBe("finished: success");
    expect(r.verdict).toBe("success: G1: CLEAN — 9 of 9 layers, 0 finding(s)");
    expect(line(r)).toContain("2/2 parts");
  });

  it("jobs that could not be read are unknown — re-ask, never finished", () => {
    const r = runState({ ...ROUND, status: "completed", conclusion: "success" }, null, null);
    expect(r.state).toBe("unknown — re-ask");
    expect(r.state.startsWith("finished")).toBe(false);
  });

  it("a run that ended before its Verdict did is said so, not called finished", () => {
    const r = runState({ ...ROUND, status: "completed", conclusion: "cancelled" }, [...fixed(["completed", "cancelled"]), job("part-1", "completed", "cancelled")], null);
    expect(r.state.startsWith("finished")).toBe(false);
    expect(r.state).toContain("cancelled");
  });

  it("the jobs that are not parts are exactly the round workflow's other jobs", () => {
    const flow = readVerbatim(".github/workflows/round.yml");
    for (const name of NOT_PARTS.filter((n) => n !== "Verdict" && n !== "Plan")) expect(flow).toContain(`name: ${name}`);
    expect(flow).toMatch(/name: Verdict/);
  });
});

describe("the round says its verdict on the commit", () => {
  const v = (verdict: string) => ({ tag: "G9", verdict, layers: [{ ran: true }, { ran: true }, { ran: false }], findings: verdict === "NOT CLEAN" ? ["a"] : [] });

  it("only CLEAN is success; NOT CLEAN is the app's failure; the rest are errors", () => {
    expect(statusForVerdict(v("CLEAN")).state).toBe("success");
    expect(statusForVerdict(v("NOT CLEAN")).state).toBe("failure");
    expect(statusForVerdict(v("CLEAN, BUT NOT ALL OVER")).state).toBe("error");
    expect(statusForVerdict(v("INCOMPLETE — re-run")).state).toBe("error");
    expect(statusForVerdict(null).state).toBe("error");
  });

  it("the description is the verdict line, within GitHub's 140 characters", () => {
    expect(statusForVerdict(v("NOT CLEAN")).description).toBe("G9: NOT CLEAN — 2 of 3 layers, 1 finding(s)");
    expect(statusForVerdict({ ...v("CLEAN"), tag: "x".repeat(200) }).description.length).toBeLessThanOrEqual(140);
  });

  it("the Verdict job posts it, whatever the verdict was, with permission to", () => {
    const flow = readVerbatim(".github/workflows/round.yml");
    const verdictJob = flow.slice(flow.indexOf("\n  verdict:"));
    expect(verdictJob).toMatch(/statuses: write/);
    expect(verdictJob).toMatch(/node scripts\/qa\/reader\.mjs --post /);
  });
});

describe("when the API refuses, the public page", () => {
  it("reads the status a run page shows", () => {
    const html = `<span class="mb-1 d-block text-small color-fg-muted">Status</span>\n        <span class="h4 color-fg-default">In progress</span>`;
    expect(pageStatus(html)).toBe("In progress");
  });
  it("CONTROL: a page that does not say gives nothing, not a guess", () => {
    expect(pageStatus("<html>rate limited</html>")).toBeNull();
  });
});
