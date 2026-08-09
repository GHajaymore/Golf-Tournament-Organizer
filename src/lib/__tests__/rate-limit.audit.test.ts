import "dotenv/config";
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { checkRateLimit, clearRateLimit } from "../rate-limit";
import { RATE_LIMITS } from "../domain/rate-limit";

/**
 * The limiter against the real database.
 *
 * The unit suite proves the rules; this proves the counting, and the counting
 * is the part that was broken. The old limiter kept a Map in process memory,
 * so on serverless hosting an attacker guessing round codes got a fresh
 * allowance on every cold start — the numbers were right and the protection
 * was nearly nil. Nothing short of a real database write demonstrates the
 * difference, which is why this lives here rather than in the fast suite.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();

/** Identifiers used here are never real codes or addresses, and every row
 *  they create is deleted in afterAll. */
const MARK = `zz-audit-rate-limit-${Date.now()}`;
const identifiers: string[] = [];

function fresh(suffix: string): string {
  const id = `${MARK}-${suffix}`;
  identifiers.push(id);
  return id;
}

afterAll(async () => {
  try {
    // Keys are hashed, so the rows can't be found by identifier — but they all
    // expire on their own and a prefix sweep of this run's own window is the
    // honest cleanup available. Delete anything already expired plus this
    // run's rows, found by re-deriving each key through the public API.
    for (const id of identifiers) {
      for (const kind of ["signin", "round-code", "password-reset"] as const) {
        await clearRateLimit(kind, id);
      }
    }
    await prisma.rateLimitHit.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("attempts are counted in the database, not in this process", () => {
  it("writes a row that another instance would read", async () => {
    // The whole point of the change. If this row isn't there, every serverless
    // instance is counting on its own and the limit means nothing.
    const before = await prisma.rateLimitHit.count();
    await checkRateLimit("round-code", fresh("stored"));
    expect(await prisma.rateLimitHit.count()).toBe(before + 1);
  });

  it("refuses the attempt after the limit and keeps refusing", async () => {
    const id = fresh("exhausted");
    const { limit } = RATE_LIMITS["round-code"];
    for (let i = 1; i <= limit; i += 1) {
      const d = await checkRateLimit("round-code", id);
      expect(d.allowed, `attempt ${i} of ${limit}`).toBe(true);
    }
    expect((await checkRateLimit("round-code", id)).allowed).toBe(false);
    expect((await checkRateLimit("round-code", id)).allowed).toBe(false);
  });

  it("tells the person how long to wait", async () => {
    const id = fresh("message");
    const { limit } = RATE_LIMITS.signin;
    for (let i = 0; i <= limit; i += 1) await checkRateLimit("signin", id);
    const d = await checkRateLimit("signin", id);
    expect(d.allowed).toBe(false);
    expect(d.message).toMatch(/\d+ (second|minute|hour)/);
  });

  it("counts concurrent attempts once each", async () => {
    // The reason the increment is a single ON CONFLICT statement rather than a
    // read followed by a write: twenty simultaneous requests reading first
    // would all see zero and all be allowed, which is exactly the burst a
    // guesser wants.
    const id = fresh("concurrent");
    const { limit } = RATE_LIMITS["round-code"];
    const results = await Promise.all(
      Array.from({ length: limit + 10 }, () => checkRateLimit("round-code", id)),
    );
    expect(results.filter((r) => r.allowed).length).toBe(limit);
  });

  it("keeps one identifier's budget away from another's", async () => {
    // Otherwise anybody could lock any member out by mistyping their address.
    const victim = fresh("victim");
    const other = fresh("other");
    for (let i = 0; i <= RATE_LIMITS.signin.limit; i += 1) await checkRateLimit("signin", victim);
    expect((await checkRateLimit("signin", victim)).allowed).toBe(false);
    expect((await checkRateLimit("signin", other)).allowed).toBe(true);
  });

  it("keeps the four budgets separate", async () => {
    // Running out of reset requests must not lock somebody out of signing in
    // with the password they already know.
    const id = fresh("kinds");
    for (let i = 0; i <= RATE_LIMITS["password-reset"].limit; i += 1) {
      await checkRateLimit("password-reset", id);
    }
    expect((await checkRateLimit("password-reset", id)).allowed).toBe(false);
    expect((await checkRateLimit("signin", id)).allowed).toBe(true);
  });

  it("gives a successful caller their allowance back", async () => {
    // A fourball that fumbled the code twice on the first tee starts the round
    // with a full budget, not one wrong entry from locking themselves out.
    const id = fresh("cleared");
    const { limit } = RATE_LIMITS["round-code"];
    for (let i = 0; i <= limit; i += 1) await checkRateLimit("round-code", id);
    expect((await checkRateLimit("round-code", id)).allowed).toBe(false);
    await clearRateLimit("round-code", id);
    expect((await checkRateLimit("round-code", id)).allowed).toBe(true);
  });

  it("survives the sweep that runs alongside it", async () => {
    // The defect this pins: the counter row was written through raw SQL with a
    // JS Date, which lands in a `timestamp` column as the server's *local*
    // wall clock while every Prisma read treats it as UTC. West of Greenwich
    // that makes every row born already expired, so the housekeeping sweep —
    // which fires on a small fraction of writes — silently emptied the whole
    // table and handed everyone a fresh allowance at random. A limiter that
    // resets itself unpredictably is worse than none, because it looks like
    // one.
    const id = fresh("swept");
    await checkRateLimit("round-code", id);
    await prisma.rateLimitHit.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    const rows = await prisma.rateLimitHit.findMany({ where: { expiresAt: { gt: new Date() } } });
    expect(rows.length).toBeGreaterThan(0);
    // And the count kept counting rather than restarting.
    const { limit } = RATE_LIMITS["round-code"];
    for (let i = 1; i < limit; i += 1) await checkRateLimit("round-code", id);
    expect((await checkRateLimit("round-code", id)).allowed).toBe(false);
  });

  it("stores no readable email address or round code", async () => {
    // A table whose job is defending secrets must not be a list of them.
    const email = fresh("someone@example.test");
    await checkRateLimit("signin", email);
    const rows = await prisma.rateLimitHit.findMany({ where: { key: { contains: "@" } } });
    expect(rows).toEqual([]);
  });
});
