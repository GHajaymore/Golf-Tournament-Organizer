import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * THE DEMO REPLAY CRON IS SHUT TO ANYBODY WITHOUT ITS SECRET (2026-10-24; docs/claude/demo-club.md).
 * Either secret opens it — DEMO_REPLAY_TOKEN (the quarter-hourly GitHub schedule) or CRON_SECRET
 * (Vercel's daily cron) — and nothing else does, including no secret set at all.
 */
const replay = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/services/demo-club", () => ({
  demoMark: () => "",
  advanceDemoReplay: async () => (replay.calls++, { ok: true, day: "2031-03-12", reset: false, holesWritten: 3, cards: 3 }),
}));

import { GET } from "@/app/api/cron/demo-replay/route";

const saved = { token: process.env.DEMO_REPLAY_TOKEN, cron: process.env.CRON_SECRET };
const ask = (auth?: string) => GET(new Request("http://localhost/api/cron/demo-replay", { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  replay.calls = 0;
  delete process.env.DEMO_REPLAY_TOKEN;
  delete process.env.CRON_SECRET;
});
afterEach(() => {
  for (const [k, v] of [["DEMO_REPLAY_TOKEN", saved.token], ["CRON_SECRET", saved.cron]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("/api/cron/demo-replay", () => {
  it("refuses everybody when no secret is set, the case that matters", async () => {
    expect((await ask("Bearer ")).status).toBe(401);
    expect((await ask()).status).toBe(401);
    expect(replay.calls).toBe(0);
  });

  it("refuses a wrong secret and plays nothing", async () => {
    process.env.DEMO_REPLAY_TOKEN = "right-token";
    expect((await ask("Bearer wrong-token")).status).toBe(401);
    expect(replay.calls).toBe(0);
  });

  it("plays the demo for either secret, and answers counts only", async () => {
    process.env.DEMO_REPLAY_TOKEN = "right-token";
    process.env.CRON_SECRET = "cron-secret";
    const a = await ask("Bearer right-token");
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({ ok: true, day: "2031-03-12", reset: false, holesWritten: 3, cards: 3 });
    expect((await ask("Bearer cron-secret")).status).toBe(200);
    expect(replay.calls).toBe(2);
  });
});
