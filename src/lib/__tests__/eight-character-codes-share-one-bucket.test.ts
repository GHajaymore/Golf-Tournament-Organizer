import { describe, it, expect } from "vitest";
import { RATE_LIMITS, decideRateLimit, throttleMessage } from "@/lib/domain/rate-limit";
import { CODE_WORDS } from "@/lib/domain/code-shape";
import { readSource } from "./source";

/**
 * THE 8-CHARACTER SHAPE GETS THE LINK'S PROTECTIONS (one code box PR B; design
 * "One code box" §3.3 and Security verdict items 8 and 9; the Security Lead's
 * two figures of 14 Nov, `design-j39-pr3` D3).
 *
 * Until now a round code had no platform alarm (a guesser spreading attempts
 * over many networks was invisible to every per-network budget) and, where no
 * client address can be read, no client limit at all. Now it has both, the
 * figures set for a round code that is TYPED by a whole field off a card, not
 * scanned: 300 failed lookups an hour across the platform, then 12 failed per
 * client network per 15 minutes while it stands. The real rows are proved in
 * `one-code-door.audit.test.ts` (audit item 7); this file holds the figures,
 * the words and the shape of the gate, each with a CONTROL.
 */

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 10, 17, 10, 7, 0);

describe("the two figures (Security Lead, D3)", () => {
  it("the alarm is 300 failed lookups in an hour, the slow pace 12 in fifteen minutes", () => {
    expect(RATE_LIMITS["eight-char-alarm"]).toEqual({ limit: 300, windowMs: 60 * MINUTE });
    expect(RATE_LIMITS["eight-char-slow"]).toEqual({ limit: 12, windowMs: 15 * MINUTE });
  });
  it("the 300th failure is allowed and the 301st is where it trips", () => {
    expect(decideRateLimit("eight-char-alarm", 300, NOW).allowed).toBe(true);
    expect(decideRateLimit("eight-char-alarm", 301, NOW).allowed).toBe(false);
  });
  it("the 12th failure from a network is allowed and the 13th is refused", () => {
    expect(decideRateLimit("eight-char-slow", 12, NOW).allowed).toBe(true);
    expect(decideRateLimit("eight-char-slow", 13, NOW).allowed).toBe(false);
  });
  it("is roomier than the link's (a round code is typed by a field, a link is scanned) and no looser than the client's own", () => {
    expect(RATE_LIMITS["eight-char-alarm"].limit).toBeGreaterThan(RATE_LIMITS["player-link-alarm"].limit);
    expect(RATE_LIMITS["eight-char-slow"].limit).toBeGreaterThan(RATE_LIMITS["player-link-slow"].limit);
    expect(RATE_LIMITS["eight-char-slow"].limit).toBeLessThan(RATE_LIMITS["round-code-client"].limit);
    expect(RATE_LIMITS["eight-char-slow"].windowMs).toBe(RATE_LIMITS["round-code-client"].windowMs);
  });
  it("CONTROL: the check can see a figure moved", () => {
    expect(decideRateLimit("eight-char-slow", 13, NOW).allowed).not.toBe(decideRateLimit("eight-char-slow", 12, NOW).allowed);
    expect(RATE_LIMITS["eight-char-slow"].limit).not.toBe(RATE_LIMITS["player-link-slow"].limit);
  });
});

describe("the same sentence as every other code budget, naming no kind", () => {
  it("a refusal from either new budget is CODE_WORDS.tooMany", () => {
    for (const kind of ["eight-char-alarm", "eight-char-slow"] as const) {
      const d = decideRateLimit(kind, RATE_LIMITS[kind].limit + 1, NOW);
      expect(d.allowed).toBe(false);
      expect(d.message).toBe(throttleMessage("round-code", d.retryAfterSeconds));
      expect(d.message).toMatch(/Too many code attempts/);
      expect(d.message).toBe(CODE_WORDS.tooMany(d.message.match(/Wait (.*?) and try again/)?.[1] ?? ""));
    }
  });
});

describe("the gate gives the eight the same steps as the twelve (Security items 8 and 9)", () => {
  const door = readSource("src/lib/services/code-door.ts");
  const between = (from: string, to: string) => door.slice(door.indexOf(from), door.indexOf(to, door.indexOf(from) + from.length));
  const gate = between("export async function guessGate(", "export async function lookupEight(");
  const lanes = between("const LANES = {", "} as const;");

  it("the eight's lane names the round code's client budget and the two new kinds", () => {
    expect(lanes).toContain('eight: { client: "round-code-client", alarm: "eight-char-alarm", slow: "eight-char-slow"');
  });
  it("one gate for both shapes: no early return for the eight that skips the alarm", () => {
    expect(gate.length).toBeGreaterThan(300);
    expect(gate).not.toMatch(/if \(shape === "eight"\)/);
    expect(gate).toContain("clientGuessGate(lane.alarm, lane.platform)");
    expect(gate).toContain("clientGuessGate(lane.slow, who)");
  });
  it("no readable address is ONE shared bucket for either shape, never no limit (item 9)", () => {
    expect(gate).toContain("const who = client ?? NO_ADDRESS;");
    // The client budget is asked with `who`, which is never null: the old eight asked with the raw `client`.
    expect(gate).toContain("clientGuessGate(lane.client, who)");
    expect(gate).not.toMatch(/clientGuessGate\(lane\.client, client\)/);
  });
  it("the alarm is reported once a window per shape, naming the kind and never a code", () => {
    expect(gate).toMatch(/if \(window !== alarmReportedIn\[shape\]\) \{\s*alarmReportedIn\[shape\] = window;\s*console\.error\(`\[\$\{lane\.alarm\}\]/);
  });
  it("CONTROL: an early return for the eight, or a nullable address, would be seen", () => {
    expect(/if \(shape === "eight"\)/.test('if (shape === "eight") { return clientGuessGate("round-code-client", client); }')).toBe(true);
    expect(/clientGuessGate\(lane\.client, client\)/.test("await clientGuessGate(lane.client, client)")).toBe(true);
  });
});
