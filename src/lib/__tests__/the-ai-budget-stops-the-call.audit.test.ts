import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE AI BUDGET STOPS THE NEXT CALL (Ajay, 2026-11-03: "let's set the budget
 * to $20 / month. make it configurable in owner's console").
 *
 * Against real rows: the owner sets the budget on the console's action, a
 * call is made and its cost recorded from the `usage` it reports, the record
 * crosses the budget, and the NEXT call — a job's or the owner's Check AI —
 * is not sent at all. Only the owner may change the budget.
 *
 * The model API is never called: `fetch` is replaced by a counter that
 * answers like it, with a `usage` whose cost is worked by hand below.
 *
 *   npx vitest run --config vitest.audit.config.ts the-ai-budget
 */

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Map<string, string>(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createSession } from "@/lib/auth";
import { setAiBudget } from "@/app/actions/owner-ai";
import { askClaude, checkAiJob } from "@/lib/services/claude";
import { AI_BUDGET_KEY, aiBudgetCents, spentThisMonth } from "@/lib/services/ai-spend";
import { JOBS } from "@/lib/ai-config";
import { MICRO_USD_PER_CENT } from "@/lib/domain/ai-cost";

const prisma = new PrismaClient();
const TAG = `zz-ai-budget-${process.pid}`;
const OWNER = `${TAG}-owner@example.invalid`;
const ORGANIZER = `${TAG}-organizer@example.invalid`;

/**
 * Token counts no real call here will report, so the rows this test causes are
 * found and removed by them (with the time it started) and nothing else is.
 *
 * The answering call: commentary runs on Sonnet 5.5, $2 in / $10 out per MTok:
 *   5,001 x $2 / 1e6 = $0.010002 ; 777 x $10 / 1e6 = $0.00777 ; = 17,772 micro-dollars
 * The refused call that still reports usage: 3 x $2 / 1e6 = 6 micro-dollars.
 */
const ANSWER = { input: 5_001, output: 777, microUsd: 17_772 };
const REFUSED = { input: 3, output: 0, microUsd: 6 };

let sent = 0;
let reply: () => Response = () => new Response("{}", { status: 500 });
const realFetch = globalThis.fetch;
const before = { owners: process.env.OWNER_EMAILS, key: process.env.ANTHROPIC_API_KEY };
let started = new Date();
let savedBudget: string | null = null;
const users: Record<"owner" | "organizer", string> = { owner: "", organizer: "" };

async function signIn(id: string) {
  jar.clear();
  await createSession(id);
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  started = new Date(Date.now() - 1_000);
  savedBudget = (await prisma.platformSetting.findUnique({ where: { key: AI_BUDGET_KEY } }))?.value ?? null;
  process.env.OWNER_EMAILS = OWNER;
  // Not a key: nothing leaves, `fetch` is the counter below.
  process.env.ANTHROPIC_API_KEY = `${TAG}-not-a-key`;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("api.anthropic.com")) {
      sent += 1;
      return reply();
    }
    return realFetch(input, init);
  }) as typeof fetch;
  for (const [who, email] of [["owner", OWNER], ["organizer", ORGANIZER]] as const) {
    users[who] = (
      await prisma.user.create({ data: { email, name: `${TAG} ${who}`, password: "x:unusable", emailVerifiedAt: new Date() }, select: { id: true } })
    ).id;
  }
}, 60_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  process.env.OWNER_EMAILS = before.owners;
  if (before.key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = before.key;
  try {
    await prisma.aiSpend.deleteMany({
      where: {
        createdAt: { gte: started },
        OR: [
          { inputTokens: ANSWER.input, outputTokens: ANSWER.output },
          { inputTokens: REFUSED.input, outputTokens: REFUSED.output },
        ],
      },
    });
    if (savedBudget === null) await prisma.platformSetting.deleteMany({ where: { key: AI_BUDGET_KEY } });
    else await prisma.platformSetting.update({ where: { key: AI_BUDGET_KEY }, data: { value: savedBudget } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("the AI budget", () => {
  it("is changed by the owner alone", async () => {
    const was = await aiBudgetCents();
    await signIn(users.organizer);
    expect(await setAiBudget("5.00")).toEqual({ ok: false, error: "Not found." });
    expect(await aiBudgetCents()).toBe(was);
    jar.clear();
    expect(await setAiBudget("5.00")).toEqual({ ok: false, error: "Not found." });
    expect(await aiBudgetCents()).toBe(was);
  });

  it("records a refused call that reported usage, and none that reported nothing", async () => {
    await signIn(users.owner);
    expect(await setAiBudget("1000")).toMatchObject({ ok: true, cents: 100_000 });
    reply = () => json(400, { type: "error", error: { type: "invalid_request_error", message: "x" }, usage: { input_tokens: REFUSED.input, output_tokens: REFUSED.output } });
    expect(await askClaude({ job: "commentary", maxTokens: 10, content: "zz" })).toEqual({ ok: false, reason: "refused", status: 400 });
    reply = () => json(529, { type: "error", error: { type: "overloaded_error", message: "x" } });
    expect(await askClaude({ job: "commentary", maxTokens: 10, content: "zz" })).toMatchObject({ ok: false, reason: "refused" });
    const rows = await prisma.aiSpend.findMany({ where: { createdAt: { gte: started }, inputTokens: REFUSED.input, outputTokens: REFUSED.output } });
    expect(rows.map((r) => ({ job: r.job, model: r.model, microUsd: r.microUsd }))).toEqual([
      { job: "commentary", model: JOBS.commentary.model, microUsd: REFUSED.microUsd },
    ]);
    expect(sent).toBe(2);
  });

  it("lets the call that crosses the budget through, records it, and sends nothing after", async () => {
    await signIn(users.owner);
    // A budget this month's record is just under — by at most one cent — so
    // the next call (17,772 micro-dollars, about 1.8 cents) crosses it.
    const spent = await spentThisMonth();
    const cents = Math.floor(spent / MICRO_USD_PER_CENT) + 1;
    expect(cents, "this month's dev spend is past the $1,000 ceiling").toBeLessThanOrEqual(100_000);
    const typed = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
    expect(await setAiBudget(typed)).toMatchObject({ ok: true, cents });
    expect(await aiBudgetCents()).toBe(cents);

    sent = 0;
    reply = () => json(200, { content: [{ type: "text", text: "zz line" }], usage: { input_tokens: ANSWER.input, output_tokens: ANSWER.output } });
    expect(await askClaude({ job: "commentary", maxTokens: 10, content: "zz" })).toEqual({ ok: true, text: "zz line" });
    expect(sent).toBe(1);
    const row = await prisma.aiSpend.findFirst({ where: { createdAt: { gte: started }, inputTokens: ANSWER.input, outputTokens: ANSWER.output } });
    expect(row?.microUsd).toBe(ANSWER.microUsd);
    expect(await spentThisMonth()).toBe(spent + ANSWER.microUsd);

    // Over the line: the job says it is off, in words, and is NOT sent.
    const next = await askClaude({ job: "commentary", maxTokens: 10, content: "zz" });
    expect(next).toMatchObject({ ok: false, reason: "not-configured" });
    expect(next.ok ? "" : "why" in next ? next.why : "").toMatch(/^This month's AI budget is used up; it starts again on .+ \(UTC\)\.$/);
    // Card reading too: one gate for every job.
    expect(await askClaude({ job: "cardReading", maxTokens: 10, content: "zz" })).toMatchObject({ ok: false, reason: "not-configured" });
    // And the owner's Check AI, which costs money too.
    const line = await checkAiJob("setupSuggest");
    expect(line.ok).toBe(false);
    if (!line.ok) expect(line.error).toMatch(/budget is used up/);
    expect(sent, "a request left after the budget was spent").toBe(1);
  });

  it("$0 is off for everyone, and nothing is sent", async () => {
    await signIn(users.owner);
    expect(await setAiBudget("0")).toMatchObject({ ok: true, cents: 0 });
    sent = 0;
    const r = await askClaude({ job: "messageDraft", maxTokens: 10, content: "zz" });
    expect(r.ok ? "" : "why" in r ? r.why : "").toMatch(/set to \$0/);
    expect(sent).toBe(0);
  });
});
