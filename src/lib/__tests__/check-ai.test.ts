import { describe, it, expect, vi, beforeEach } from "vitest";
import { inflateSync } from "node:zlib";
import { aiCheckLine } from "@/lib/domain/ai-check";
import { solidSquarePng, PROBE_IMAGE } from "@/lib/domain/probe-image";

/**
 * THE OWNER'S CHECK AI (2026-11-03): what each line says, the picture it sends,
 * and who may press it.
 */

const state = vi.hoisted(() => ({
  session: null as null | { userId: string; email: string },
  allowed: true,
  checked: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ getSession: async () => state.session }));
vi.mock("@/lib/owner", () => ({ isOwner: (email: string) => email === "owner@example.invalid" }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () =>
    state.allowed
      ? { allowed: true, retryAfterSeconds: 0, message: "" }
      : { allowed: false, retryAfterSeconds: 40, message: "One AI check a minute. Try again in 40 seconds." },
}));
vi.mock("@/lib/services/claude", () => ({
  checkAiJob: async (job: string) => {
    state.checked.push(job);
    return { job, words: job, model: "m", ok: true, ms: 1, said: "OK" };
  },
}));

const { checkAiAccount } = await import("@/app/actions/owner-ai");

const JOB = { job: "commentary", words: "Commentary", model: "claude-sonnet-5-5" };
const KEY = "sk-ant-api03-ZZZZtestkeyZZZZ";

describe("a Check AI line", () => {
  it("is OK with the model and the time when the model answers in text", () => {
    const body = { content: [{ type: "thinking", thinking: "" }, { type: "text", text: " OK " }] };
    expect(aiCheckLine(JOB, { kind: "answered", status: 200, body }, 412.6, KEY)).toEqual({
      ...JOB,
      ok: true,
      ms: 413,
      said: "OK",
    });
  });

  it("carries the API's own status and message on a refusal", () => {
    const body = { type: "error", error: { type: "invalid_request_error", message: "thinking.type: disabled is not supported" } };
    const line = aiCheckLine(JOB, { kind: "answered", status: 400, body }, 90, KEY);
    expect(line).toMatchObject({ ok: false, status: 400, error: "invalid_request_error: thinking.type: disabled is not supported" });
  });

  it("never carries the key, nor anything shaped like one, and is cut short", () => {
    const body = { error: { type: "authentication_error", message: `bad key ${KEY} and sk-ant-other-1234 ${"x".repeat(500)}` } };
    const line = aiCheckLine(JOB, { kind: "answered", status: 401, body }, 5, KEY);
    const said = JSON.stringify(line);
    expect(said).not.toContain(KEY);
    expect(said).not.toContain("sk-ant-");
    if (!line.ok) expect(line.error.length).toBeLessThanOrEqual(300);
  });

  it("says why when the job is off, an answer with no text, and an unreachable API", () => {
    expect(aiCheckLine(JOB, { kind: "off", why: "No ANTHROPIC_KEY_NAME set." }, 0, null)).toMatchObject({ ok: false, status: null });
    expect(aiCheckLine(JOB, { kind: "answered", status: 200, body: { content: [] } }, 1, KEY)).toMatchObject({
      ok: false,
      error: "The model answered with no text.",
    });
    expect(aiCheckLine(JOB, { kind: "unreachable" }, 1, KEY)).toMatchObject({ ok: false, error: "Could not reach the API." });
    expect(aiCheckLine(JOB, { kind: "answered", status: 500, body: null }, 1, KEY)).toMatchObject({
      ok: false,
      status: 500,
      error: "no error message came back",
    });
  });
});

describe("the picture the card reader is checked with", () => {
  it("is a valid PNG of the size and colour asked for", () => {
    const png = Buffer.from(solidSquarePng(PROBE_IMAGE.size, PROBE_IMAGE.rgb), "base64");
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.toString("ascii", 12, 16)).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(PROBE_IMAGE.size);
    expect(png.readUInt32BE(20)).toBe(PROBE_IMAGE.size);
    const idatLen = png.readUInt32BE(33);
    expect(png.toString("ascii", 37, 41)).toBe("IDAT");
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    expect(raw.length).toBe(PROBE_IMAGE.size * (1 + PROBE_IMAGE.size * 3));
    expect([...raw.subarray(1, 4)]).toEqual(PROBE_IMAGE.rgb);
  });
});

describe("who may press Check AI", () => {
  beforeEach(() => {
    state.session = null;
    state.allowed = true;
    state.checked = [];
  });

  it("answers a stranger and a signed-in non-owner exactly as a missing page, and sends nothing", async () => {
    expect(await checkAiAccount()).toEqual({ ok: false, error: "Not found." });
    state.session = { userId: "zz-u1", email: "member@example.invalid" };
    expect(await checkAiAccount()).toEqual({ ok: false, error: "Not found." });
    expect(state.checked).toEqual([]);
  });

  it("refuses anything sent to it, and a second press inside the minute", async () => {
    state.session = { userId: "zz-u2", email: "owner@example.invalid" };
    expect(await checkAiAccount({ job: "x" })).toEqual({ ok: false, error: "Check AI takes no input." });
    state.allowed = false;
    expect(await checkAiAccount()).toEqual({ ok: false, error: "One AI check a minute. Try again in 40 seconds." });
    expect(state.checked).toEqual([]);
  });

  it("checks every job for the owner", async () => {
    state.session = { userId: "zz-u3", email: "owner@example.invalid" };
    const res = await checkAiAccount();
    expect(res.ok).toBe(true);
    expect(state.checked.sort()).toEqual(["cardReading", "commentary", "messageDraft", "reportDraft", "setupSuggest"]);
  });
});
