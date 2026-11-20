import { describe, it, expect } from "vitest";
import { readSource } from "./source";
// Plain JavaScript on purpose: the gate runs on a bare runner.
import { retryTransient, mustSucceed } from "../../../scripts/qa/deploy-rules.mjs";

/**
 * The deploy gate asks GitHub and git; GitHub sometimes drops a stream or answers 502 on a green round
 * (16 Nov 2026, twice). Those are asked again; an answer (4xx, auth, not found) never is.
 */
type R = { status: number; stdout: string; stderr: string };
const ok: R = { status: 0, stdout: '{"check_runs":[]}', stderr: "" };
const stream: R = { status: 1, stdout: "", stderr: "gh run view 1 --json jobs: stream error: stream ID 5; CANCEL; received from peer" };

function script(results: R[]) {
  const slept: number[] = [];
  const logs: string[] = [];
  let calls = 0;
  const attempt = () => results[Math.min(calls++, results.length - 1)];
  return { slept, logs, calls: () => calls, run: () => retryTransient(attempt, { what: "gh x", sleep: (ms: number) => void slept.push(ms), log: (m: string) => void logs.push(m) }) };
}

describe("deploy gate retries GitHub's transient errors", () => {
  it("(a) transient twice then success: the answer comes back, after waits of 5 s then 15 s, each logged on one line", () => {
    const s = script([stream, { ...stream, stderr: "HTTP 502: Bad Gateway" }, ok]);
    const r = s.run();
    expect(r.status).toBe(0);
    expect(mustSucceed(r, "gh")).toBe(ok.stdout);
    expect(s.calls()).toBe(3);
    expect(s.slept).toEqual([5000, 15000]);
    expect(s.logs).toHaveLength(2);
    for (const l of s.logs) expect(l).not.toContain("\n");
  });

  it("(b) transient four times: stops at four attempts (5, 15, 45 s) and returns the failure, which the gate words as 'could not ask'", () => {
    const s = script([stream]);
    const r = s.run();
    expect(r.status).toBe(1);
    expect(s.calls()).toBe(4);
    expect(s.slept).toEqual([5000, 15000, 45000]);
    expect(() => mustSucceed(r, "git x")).toThrow(/failed/);
  });

  it("(c) a 404, an auth refusal or a git exit with no fault text is not asked again", () => {
    for (const stderr of ["gh: Not Found (HTTP 404)", "HTTP 401: Bad credentials", "HTTP 403: Resource not accessible by integration", "fatal: bad revision"]) {
      const s = script([{ status: 1, stdout: "", stderr }, ok]);
      expect(s.run().status).toBe(1);
      expect(s.calls()).toBe(1);
      expect(s.slept).toEqual([]);
    }
  });

  it("every gh and git call in the gate goes through the one retry helper, and the final message is unchanged", () => {
    const gate = readSource("scripts/qa/deploy-gate.mjs");
    expect(gate).toContain("retryTransient(");
    expect(gate).toContain('const git = (...a) => asked("git", a)');
    expect(gate).toContain('asked("gh", a)');
    expect(gate).not.toMatch(/\brun\("(gh|git)"/);
    expect(gate).toContain("could not ask GitHub or git — nothing deploys");
  });
});
