import { describe, it, expect } from "vitest";
import { RATE_LIMITS, throttleMessage, type RateLimitKind } from "@/lib/domain/rate-limit";
import { CODE_WORDS } from "@/lib/domain/code-shape";
import { GUEST_WORDS } from "@/lib/domain/guest-entry";
import { readSource } from "./source";

/**
 * A REFUSED CODE NAMES NO KIND (J39/J40 PR 3B; Security Lead C1.10).
 *
 * Every failed code in every box gets one kind-neutral sentence; every limit in the guest branch gets one limit
 * sentence that ends in a way on. A throttle in a SHARED box (/play, /p, /register) must not say "link attempts" or
 * "round attempts": which table was asked is the very thing a guesser wants to learn.
 *
 * Break-it (seen red): put "link attempts" back in a shared box's throttle.
 */

/** A sentence that names which kind of code was tried. */
export const namesAKind = (s: string) => /\b(link|round|entry|poster|player) (code )?attempts?\b|\bnot a (round|link|entry)\b/i.test(s);

const SHARED_BOX_KINDS: RateLimitKind[] = ["round-code", "round-code-client", "player-link-client", "player-link-alarm", "player-link-slow", "eight-char-alarm", "eight-char-slow"];
const GUEST_KINDS: RateLimitKind[] = ["guest-entry-device", "guest-entry-cookieless", "guest-mint-alarm", "guest-mint-slow"];

describe("a refused code names no kind", () => {
  it("CONTROL: the sweep sees a sentence that names a kind, and passes a neutral one", () => {
    expect(namesAKind("Too many link attempts. Wait 5 minutes")).toBe(true);
    expect(namesAKind("Too many round code attempts.")).toBe(true);
    expect(namesAKind(CODE_WORDS.tooMany("5 minutes"))).toBe(false);
  });

  it("every throttle of a shared box says the one sentence, whichever kind it is", () => {
    for (const kind of SHARED_BOX_KINDS) {
      expect(RATE_LIMITS[kind], kind).toBeTruthy();
      expect(throttleMessage(kind, 300), kind).toBe(CODE_WORDS.tooMany("5 minutes"));
    }
  });

  it("every limit of the guest branch says the one limit sentence, ending in a way on", () => {
    for (const kind of GUEST_KINDS) {
      const said = throttleMessage(kind, 300);
      expect(said, kind).toBe(GUEST_WORDS.limit);
      expect(namesAKind(said), kind).toBe(false);
      expect(said).toMatch(/see the organizer at the desk/i);
    }
  });

  it("the failed-code sentence names no kind and the guest door says it for a bad token too", () => {
    expect(namesAKind(GUEST_WORDS.codeOpensNothing)).toBe(false);
    const door = readSource("src/app/actions/guest-entry.ts");
    expect(namesAKind(door)).toBe(false);
    expect(door).toContain("GUEST_WORDS.codeOpensNothing");
  });
});
