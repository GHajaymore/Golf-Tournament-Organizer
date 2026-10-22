import { describe, it, expect } from "vitest";
import {
  EMAIL_CODE_MAX_TRIES,
  EMAIL_CODE_TTL_MS,
  EMAIL_CODE_WORDS,
  afterWrongGuess,
  codeFromTyped,
  codeUnusable,
  maskedAddress,
} from "../email-code";
import { hashBrowserValue, hashEmailCode, newBrowserValue, newEmailCode, sameCodeHash } from "../email-code-hash";
import { throttleMessage } from "../rate-limit";

/**
 * PROVING AN ADDRESS, the pure half (2026-10-21) — see `email-code.ts`. The
 * rows, the browser binding and the session are held against a real database
 * in `an-address-is-proved-before-it-signs-in.audit.test.ts`.
 */

const NOW = new Date("2026-10-21T12:00:00Z");
const live = (over: Partial<{ expiresAt: Date; attempts: number; usedAt: Date | null }> = {}) => ({
  expiresAt: new Date(NOW.getTime() + EMAIL_CODE_TTL_MS),
  attempts: 0,
  usedAt: null,
  ...over,
});

describe("a code", () => {
  it("is six digits, leading zeros kept, from across the whole range", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const c = newEmailCode();
      expect(c).toMatch(/^[0-9]{6}$/);
      seen.add(c[0]);
    }
    // Two thousand draws that never start with a 0 would be a padding bug.
    expect(seen.has("0")).toBe(true);
    expect(seen.size).toBe(10);
  });

  it("is stored as a hash bound to the person, never as itself", () => {
    const h = hashEmailCode("user-a", "042917");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("042917");
    expect(hashEmailCode("user-a", "042917")).toBe(h);
    // The same six digits sent to two people are two different rows.
    expect(hashEmailCode("user-b", "042917")).not.toBe(h);
    expect(hashEmailCode("user-a", "042918")).not.toBe(h);
  });

  it("is compared whole: the right hash matches, a wrong or empty one never does", () => {
    const h = hashEmailCode("u", "123456");
    expect(sameCodeHash(h, hashEmailCode("u", "123456"))).toBe(true);
    expect(sameCodeHash(h, hashEmailCode("u", "123457"))).toBe(false);
    expect(sameCodeHash(h, "")).toBe(false);
    expect(sameCodeHash("", "")).toBe(false);
    expect(sameCodeHash(h, h.slice(0, 32))).toBe(false);
  });

  it("is read from what was typed: spaces and a dash dropped, anything else refused", () => {
    expect(codeFromTyped("123456")).toBe("123456");
    expect(codeFromTyped(" 123 456 ")).toBe("123456");
    expect(codeFromTyped("123-456")).toBe("123456");
    for (const bad of ["12345", "1234567", "12345a", "", "１２３４５６", "12.456"]) expect(codeFromTyped(bad), bad).toBe("");
    // A `"use server"` export is called with whatever the caller likes.
    for (const bad of [undefined, null, 123456, { code: "123456" }]) expect(codeFromTyped(bad)).toBe("");
  });

  it("belongs to a browser by a hashed random value", () => {
    const a = newBrowserValue();
    const b = newBrowserValue();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(hashBrowserValue(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBrowserValue(a)).not.toBe(hashBrowserValue(b));
    expect(hashBrowserValue(a)).not.toContain(a);
  });
});

describe("when a code can be tried", () => {
  it("a live code can", () => {
    expect(codeUnusable(live(), NOW)).toBeNull();
    expect(codeUnusable(live({ attempts: EMAIL_CODE_MAX_TRIES - 1 }), NOW)).toBeNull();
  });

  it("fifteen minutes is the whole of its life", () => {
    expect(EMAIL_CODE_TTL_MS).toBe(15 * 60 * 1000);
    expect(codeUnusable(live({ expiresAt: new Date(NOW.getTime() + 1) }), NOW)).toBeNull();
    expect(codeUnusable(live({ expiresAt: NOW }), NOW)).toBe("expired");
    expect(codeUnusable(live({ expiresAt: new Date(NOW.getTime() - 1) }), NOW)).toBe("expired");
  });

  it("once used, it is spent", () => {
    expect(codeUnusable(live({ usedAt: NOW }), NOW)).toBe("expired");
  });

  it("five wrong tries and it is done, whatever is typed next", () => {
    expect(EMAIL_CODE_MAX_TRIES).toBe(5);
    expect(codeUnusable(live({ attempts: 5 }), NOW)).toBe("too-many");
    expect(codeUnusable(live({ attempts: 9 }), NOW)).toBe("too-many");
    expect([1, 2, 3, 4].map(afterWrongGuess)).toEqual(["wrong", "wrong", "wrong", "wrong"]);
    expect(afterWrongGuess(5)).toBe("too-many");
  });

  it("no code at all reads as expired — the remedy is a new one, not re-typing", () => {
    expect(codeUnusable(null, NOW)).toBe("expired");
  });
});

describe("the words are the panel's", () => {
  it("every refusal and the throttle", () => {
    expect(EMAIL_CODE_WORDS.refusal).toEqual({
      wrong: "That code isn't right. Check it, or send a new one.",
      expired: "That code has expired. Send a new one.",
      "too-many": "Too many tries. Send a new code to carry on.",
      today: "Too many tries for this address today. Try again tomorrow.",
    });
    expect(throttleMessage("email-code-send", 240)).toBe(
      "We've sent three codes in the last few minutes. You can ask for another in 4 minutes.",
    );
    expect(EMAIL_CODE_WORDS.couldNotSend).toBe(
      "We couldn't send the email just now. Try again in a minute, or write to support@tourneyhq.club.",
    );
  });

  it("the address is shown masked", () => {
    expect(maskedAddress("ailsa.brodie@example.invalid")).toBe("a***@example.invalid");
    expect(EMAIL_CODE_WORDS.line(maskedAddress("ailsa@example.invalid"))).toBe(
      "We sent a 6-digit code to a***@example.invalid. It works for 15 minutes.",
    );
    expect(maskedAddress("nonsense")).toBe("your email");
  });
});
