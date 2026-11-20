import { describe, it, expect, vi, beforeEach } from "vitest";
import { JOBS, RATE_CARD } from "@/lib/ai-config";
import {
  budgetDecision,
  costOfCall,
  DEFAULT_AI_BUDGET_CENTS,
  spendMonth,
  usageOf,
  type ModelUsage,
} from "@/lib/domain/ai-cost";

/**
 * THE AI BUDGET (Ajay, 2026-11-03: "let's set the budget to $20 / month. make
 * it configurable in owner's console").
 *
 * Every expected figure below is worked BY HAND from Anthropic's list prices in
 * dollars per million tokens — tokens x $/MTok / 1e6, written out in the
 * comment — not from the micro-dollar-per-million integers the code holds, and
 * not by calling anything the code calls. A price typed wrong in
 * `RATE_CARD`, or a cache multiplier inverted, comes out a different number.
 *
 *   Haiku 5.5   $0.10 in / $0.50 out, prompt <= 100K tokens; $0.50 / $2.50 above
 *   Sonnet 5.5  $2 in / $10 out
 *   cache read 0.1x input; 5-minute write 1.25x input; 1-hour write 2x input
 */

const HAIKU = JOBS.cardReading.model;
const SONNET = JOBS.commentary.model;

const use = (u: Partial<ModelUsage>): ModelUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  ...u,
});

describe("what one call costs, in micro-dollars", () => {
  it("prices a Sonnet call", () => {
    // 1,200 x $2 / 1e6 = $0.0024 ; 300 x $10 / 1e6 = $0.0030 ; $0.0054 = 5,400 micro-dollars
    expect(costOfCall(SONNET, use({ inputTokens: 1_200, outputTokens: 300 }))).toMatchObject({ microUsd: 5_400, priced: true });
  });

  it("prices a Haiku card reading", () => {
    // 2,000 x $0.10 / 1e6 = $0.0002 ; 150 x $0.50 / 1e6 = $0.000075 ; = 275 micro-dollars
    expect(costOfCall(HAIKU, use({ inputTokens: 2_000, outputTokens: 150 })).microUsd).toBe(275);
  });

  it("prices a Haiku prompt over 100K tokens at the long-prompt rate, on the whole call", () => {
    // 120,000 x $0.50 / 1e6 = $0.06 ; 1,000 x $2.50 / 1e6 = $0.0025 ; = 62,500 micro-dollars
    expect(costOfCall(HAIKU, use({ inputTokens: 120_000, outputTokens: 1_000 })).microUsd).toBe(62_500);
    // Exactly 100,000 is still the standard rate: 100,000 x $0.10 / 1e6 = $0.01 = 10,000
    expect(costOfCall(HAIKU, use({ inputTokens: 100_000 })).microUsd).toBe(10_000);
    // One more token crosses it: 100,001 x $0.50 / 1e6 = $0.0500005 -> rounded UP to 50,001
    expect(costOfCall(HAIKU, use({ inputTokens: 100_001 })).microUsd).toBe(50_001);
  });

  it("counts cache reads toward the 100K prompt, which is what Anthropic bills on", () => {
    // 60,000 + 50,000 read = 110,000 prompt tokens: long rate.
    // 60,000 x $0.50 / 1e6 = $0.03 ; 50,000 x $0.05 (0.1 x $0.50) / 1e6 = $0.0025 ; = 32,500
    expect(costOfCall(HAIKU, use({ inputTokens: 60_000, cacheReadTokens: 50_000 })).microUsd).toBe(32_500);
  });

  it("prices cache reads and writes off the input price", () => {
    // 1,000 x $2 = $0.002 ; 10,000 read x $0.20 = $0.002 ; 2,000 5-min write x $2.50 = $0.005 ;
    // 400 out x $10 = $0.004 ; all / 1e6 -> $0.013 = 13,000 micro-dollars
    const u = use({ inputTokens: 1_000, cacheReadTokens: 10_000, cacheWrite5mTokens: 2_000, outputTokens: 400 });
    expect(costOfCall(SONNET, u).microUsd).toBe(13_000);
    // 1,000 one-hour writes x $4 (2 x $2) / 1e6 = $0.004 = 4,000
    expect(costOfCall(SONNET, use({ cacheWrite1hTokens: 1_000 })).microUsd).toBe(4_000);
  });

  it("rounds up, so the record never says less than was spent", () => {
    // 1 x $0.10 / 1e6 = $0.0000001 = 0.1 micro-dollars -> 1
    expect(costOfCall(HAIKU, use({ inputTokens: 1 })).microUsd).toBe(1);
    expect(costOfCall(HAIKU, use({})).microUsd).toBe(0);
  });

  it("CONTROL: never costs an unpriced model at zero — it is charged at the dearest rate and flagged", () => {
    // The dearest on the card is Sonnet's $2 / $10: 1,000 x $2 + 100 x $10 = $0.003 = 3,000
    const unknown = costOfCall("claude-unknown-9", use({ inputTokens: 1_000, outputTokens: 100 }));
    expect(unknown).toMatchObject({ microUsd: 3_000, priced: false });
    expect(unknown.note).toMatch(/not on the rate card/);
    expect(costOfCall("", use({ inputTokens: 1_000 })).priced).toBe(false);
    expect(costOfCall("", use({ inputTokens: 1_000 })).microUsd).toBeGreaterThan(0);
  });

  it("has a price for every model a job runs on", () => {
    for (const [job, j] of Object.entries(JOBS)) {
      if (j.model) expect(RATE_CARD[j.model], `${job} runs on ${j.model}, which has no price`).toBeDefined();
    }
  });
});

describe("reading usage out of a response", () => {
  it("reads the four counts, and nothing when there is no usage", () => {
    expect(
      usageOf({ usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } }),
    ).toEqual(use({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWrite5mTokens: 2 }));
    expect(usageOf(null)).toBeNull();
    expect(usageOf({ type: "error", error: { type: "overloaded_error" } })).toBeNull();
  });

  it("reads usage off an error body too: it was billed", () => {
    expect(usageOf({ type: "error", usage: { input_tokens: 7, output_tokens: 0 } })?.inputTokens).toBe(7);
  });

  it("splits cache writes by lifetime where the response does, losing none", () => {
    const u = usageOf({
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 900, cache_creation: { ephemeral_1h_input_tokens: 300 } },
    });
    expect(u).toMatchObject({ cacheWrite1hTokens: 300, cacheWrite5mTokens: 600 });
  });

  it("makes a nonsense count zero, never negative or a fraction", () => {
    expect(usageOf({ usage: { input_tokens: -5, output_tokens: "9", cache_read_input_tokens: 2.7 } })).toEqual(
      use({ cacheReadTokens: 2 }),
    );
  });
});

describe("whether the next call may be made", () => {
  const NOV_3 = new Date("2026-11-03T12:00:00Z");

  it("defaults to $20.00", () => {
    expect(DEFAULT_AI_BUDGET_CENTS).toBe(2_000);
  });

  it("allows a call under the budget and stops one at it, saying when it starts again", () => {
    // $20.00 = 2,000 cents = 20,000,000 micro-dollars
    expect(budgetDecision(19_999_999, 2_000, NOV_3)).toEqual({ allowed: true });
    expect(budgetDecision(20_000_000, 2_000, NOV_3)).toEqual({
      allowed: false,
      why: "This month's AI budget is used up; it starts again on Dec 1, 2026 (UTC).",
    });
    expect(budgetDecision(25_000_000, 2_000, NOV_3).allowed).toBe(false);
  });

  it("starts again on the first of the NEXT year after December", () => {
    // A 1-cent budget is 10,000 micro-dollars: 1 micro-dollar is under it, 10,000 is at it.
    expect(budgetDecision(1, 1, new Date("2026-12-31T23:59:00Z")).allowed).toBe(true);
    const spent = budgetDecision(10_000, 1, new Date("2026-12-31T23:59:00Z"));
    expect(spent.allowed ? "" : spent.why).toContain("Jan 1, 2027");
  });

  it("$0 is AI off for everyone, said as such", () => {
    const d = budgetDecision(0, 0, NOV_3);
    expect(d.allowed ? "" : d.why).toMatch(/set to \$0/);
  });

  it("keeps the month in UTC: the bill is the account's, not a club's day", () => {
    // 23:30 on 30 November in New York is already 1 December in UTC.
    expect(spendMonth(new Date("2026-11-30T23:30:00-05:00"))).toBe("2026-12");
    expect(spendMonth(new Date("2026-11-30T23:30:00Z"))).toBe("2026-11");
  });
});

/* ---------------- the owner's action ---------------- */

const state = vi.hoisted(() => ({
  session: null as null | { userId: string; email: string },
  saved: [] as number[],
}));

vi.mock("@/lib/auth", () => ({ getSession: async () => state.session }));
vi.mock("@/lib/owner", () => ({ isOwner: (email: string) => email === "owner@example.invalid" }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0, message: "" }) }));
vi.mock("@/lib/services/claude", () => ({ checkAiJob: async () => null }));
vi.mock("@/lib/services/ai-spend", () => ({
  setAiBudgetCents: async (c: number) => {
    state.saved.push(c);
    return c;
  },
}));

const { setAiBudget } = await import("@/app/actions/owner-ai");

describe("setting the budget on /owner", () => {
  beforeEach(() => {
    state.session = { userId: "u1", email: "owner@example.invalid" };
    state.saved = [];
  });

  it("is the owner's alone", async () => {
    state.session = { userId: "u2", email: "organizer@example.invalid" };
    expect(await setAiBudget("50")).toEqual({ ok: false, error: "Not found." });
    state.session = null;
    expect(await setAiBudget("50")).toEqual({ ok: false, error: "Not found." });
    expect(state.saved).toEqual([]);
  });

  it("reads dollars as typed, to the cent", async () => {
    expect(await setAiBudget("20")).toMatchObject({ ok: true, cents: 2_000 });
    expect(await setAiBudget("$12.34")).toMatchObject({ ok: true, cents: 1_234 });
    expect(await setAiBudget("7,50")).toMatchObject({ ok: true, cents: 750 });
    expect(await setAiBudget("1,000")).toMatchObject({ ok: true, cents: 100_000 });
    expect(await setAiBudget("0")).toMatchObject({ ok: true, cents: 0 });
    expect(state.saved).toEqual([2_000, 1_234, 750, 100_000, 0]);
  });

  it("refuses a negative, a non-number, and over $1,000 a month, in words, saving nothing", async () => {
    expect(await setAiBudget("-5")).toMatchObject({ ok: false, error: "The budget can't be less than nothing." });
    expect(await setAiBudget("twenty")).toMatchObject({ ok: false, error: expect.stringMatching(/in dollars/) });
    expect(await setAiBudget("12abc")).toMatchObject({ ok: false, error: expect.stringMatching(/in dollars/) });
    expect(await setAiBudget("")).toMatchObject({ ok: false });
    expect(await setAiBudget("1000.01")).toMatchObject({ ok: false, error: "The budget can be at most $1,000.00 a month." });
    expect(await setAiBudget("99999999999999999999")).toMatchObject({ ok: false });
    // A "use server" export is called with whatever the caller likes.
    expect(await setAiBudget(20 as unknown as string)).toMatchObject({ ok: false });
    expect(await setAiBudget({ cents: 1 } as unknown as string)).toMatchObject({ ok: false });
    expect(state.saved).toEqual([]);
  });
});
