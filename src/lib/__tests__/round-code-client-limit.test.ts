import { describe, it, expect } from "vitest";
import {
  RATE_LIMITS,
  clientAddressFrom,
  decideRateLimit,
  networkOf,
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

  it("is sixty failures in fifteen minutes", () => {
    expect(limit).toBe(60);
    expect(RATE_LIMITS["round-code-client"].windowMs).toBe(15 * 60_000);
  });
  it("is refused only on the attempt after `limit`", () => {
    expect(decideRateLimit("round-code-client", limit, now).allowed).toBe(true);
    expect(decideRateLimit("round-code-client", limit + 1, now).allowed).toBe(false);
  });
  it("says the same words as the per-code limit, with a wait", () => {
    const d = decideRateLimit("round-code-client", limit + 1, now);
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

describe("networkOf: IPv6 by its /64, IPv4 whole", () => {
  it("keeps an IPv4 address whole and unwraps an IPv4-mapped one", () => {
    expect(networkOf("203.0.113.7")).toBe("203.0.113.7");
    expect(networkOf("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });
  it("gives every address in one /64 the same key, and another /64 another", () => {
    const a = networkOf("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    expect(networkOf("2001:0db8:0001:0002::1")).toBe(a);
    expect(networkOf("2001:DB8:1:2:ffff::")).toBe(a);
    expect(networkOf("2001:db8:1:3::1")).not.toBe(a);
    expect(networkOf("::1")).toBe("0:0:0:0::/64");
  });
});

/**
 * ONE CODE BOX (2026-11-17): the round code's two lookups are the one door's
 * (`openEight` in services/code-door.ts) and the round's second step
 * (`claimPlayerSlot`). Both ask the ONE gate the door chooses by shape
 * (`guessGate("eight", …)`), which is the only place the client key is named.
 */
describe("both round-code lookups ask the client gate and give back only successes", () => {
  const play = readSource("src/app/actions/play.ts");
  const door = readSource("src/lib/services/code-door.ts");
  const between = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
  it("the client key is named once, in the door's gate, and never cleared", () => {
    expect(door.match(/"round-code-client"/g)?.length, "the key is named once, in LANES").toBe(1);
    expect(door.match(/clientGuessGate\(lane\.client/g)?.length, "and asked once, by the shape's lane").toBe(1);
    expect(play).not.toMatch(/clientGuessGate\(/);
    expect(play + door).not.toMatch(/clearRateLimit\("round-code-client"/);
  });
  it("each lookup asks the gate before it looks, and gives back only after a found round", () => {
    const eight = between(door, "async function openEight(", "async function openTwelve(");
    const claim = between(play, "export async function claimPlayerSlot(", "export async function claimPlayerSlotForm(");
    for (const [name, body] of [["openEight", eight], ["claimPlayerSlot", claim]] as const) {
      const gate = body.indexOf('guessGate("eight"');
      const lookup = body.indexOf("lookupEight(code)");
      const back = body.indexOf("gate.opened()");
      expect(gate, `${name} asks the gate`).toBeGreaterThan(0);
      expect(lookup, `${name} looks up after the gate`).toBeGreaterThan(gate);
      expect(back, `${name} gives back only after the lookup`).toBeGreaterThan(lookup);
      expect(body.match(/gate\.opened\(\)/g)?.length, `${name} gives back once`).toBe(1);
    }
  });
});
