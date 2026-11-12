import { describe, it, expect } from "vitest";
import {
  RATE_LIMITS,
  clientAddressFrom,
  decideClientFailures,
  throttleMessage,
} from "../domain/rate-limit";
import { readSource } from "./source";

/**
 * The second round-code limit: one CLIENT trying MANY codes (2026-11-12).
 * The per-code limit cannot see an enumerator, who spends one guess per code.
 */
describe("round-code-client rule", () => {
  const now = Date.UTC(2026, 10, 12, 10, 7, 0);
  const { limit } = RATE_LIMITS["round-code-client"];

  it("is twenty failures in fifteen minutes", () => {
    expect(limit).toBe(20);
    expect(RATE_LIMITS["round-code-client"].windowMs).toBe(15 * 60_000);
  });
  it("is refused only once it HAS failed `limit` times", () => {
    expect(decideClientFailures("round-code-client", 0, now).allowed).toBe(true);
    expect(decideClientFailures("round-code-client", limit - 1, now).allowed).toBe(true);
    expect(decideClientFailures("round-code-client", limit, now).allowed).toBe(false);
  });
  it("says the same words as the per-code limit, with a wait", () => {
    const d = decideClientFailures("round-code-client", limit, now);
    expect(d.message).toBe(throttleMessage("round-code", d.retryAfterSeconds));
    expect(d.retryAfterSeconds).toBeGreaterThan(0);
  });
  it("is roomier than the per-code limit, so one real code never trips it", () => {
    expect(limit).toBeGreaterThan(RATE_LIMITS["round-code"].limit);
  });
});

describe("clientAddressFrom", () => {
  const from = (h: Record<string, string>) => clientAddressFrom((n) => h[n] ?? null);
  it("prefers the platform's header, takes the first of a list, falls back, and may be null", () => {
    expect(from({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "198.51.100.1" })).toBe("203.0.113.7");
    expect(from({ "x-forwarded-for": " 198.51.100.1, 10.0.0.1" })).toBe("198.51.100.1");
    expect(from({ "x-real-ip": "192.0.2.9" })).toBe("192.0.2.9");
    expect(from({})).toBeNull();
    expect(from({ "x-forwarded-for": " " })).toBeNull();
  });
});

describe("both round-code lookups ask the client gate and record only failures", () => {
  const src = readSource("src/app/actions/play.ts");
  it("calls the gate once in each of redeemRoundCode and claimPlayerSlot, never clears it", () => {
    expect(src.match(/clientGuessGate\("round-code-client"/g)?.length).toBe(2);
    expect(src.match(/guess\.recordFailure\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(src).not.toMatch(/clearRateLimit\("round-code-client"/);
  });
});
