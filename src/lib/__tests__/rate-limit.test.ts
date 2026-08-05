import { describe, it, expect, vi, afterEach } from "vitest";
import { rateLimit, clearRateLimit, retryAfterText } from "../rate-limit";

const WINDOW = 15 * 60 * 1000;
const LIMIT = 5;

// Unique key per test so the module-level bucket map can't leak between them.
let n = 0;
const freshKey = () => `test-key-${n++}`;

describe("rateLimit", () => {
  it("allows attempts up to the limit, then blocks", () => {
    const key = freshKey();
    for (let i = 0; i < LIMIT; i += 1) {
      expect(rateLimit(key, LIMIT, WINDOW).ok, `attempt ${i + 1} should be allowed`).toBe(true);
    }
    expect(rateLimit(key, LIMIT, WINDOW).ok, "attempt past the limit should be blocked").toBe(false);
  });

  it("reports a positive retry-after once blocked", () => {
    const key = freshKey();
    for (let i = 0; i < LIMIT; i += 1) rateLimit(key, LIMIT, WINDOW);
    const blocked = rateLimit(key, LIMIT, WINDOW);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(WINDOW / 1000);
  });

  it("tracks keys independently, so one user cannot lock out another", () => {
    const a = freshKey();
    const b = freshKey();
    for (let i = 0; i < LIMIT + 2; i += 1) rateLimit(a, LIMIT, WINDOW);
    expect(rateLimit(a, LIMIT, WINDOW).ok).toBe(false);
    expect(rateLimit(b, LIMIT, WINDOW).ok).toBe(true);
  });

  it("clearRateLimit lets a throttled key through again (successful sign-in)", () => {
    const key = freshKey();
    for (let i = 0; i < LIMIT + 1; i += 1) rateLimit(key, LIMIT, WINDOW);
    expect(rateLimit(key, LIMIT, WINDOW).ok).toBe(false);
    clearRateLimit(key);
    expect(rateLimit(key, LIMIT, WINDOW).ok).toBe(true);
  });

  it("starts a new window once the old one expires", () => {
    const key = freshKey();
    vi.useFakeTimers();
    try {
      for (let i = 0; i < LIMIT; i += 1) rateLimit(key, LIMIT, WINDOW);
      expect(rateLimit(key, LIMIT, WINDOW).ok, "should be blocked inside the window").toBe(false);

      vi.advanceTimersByTime(WINDOW + 1);
      expect(rateLimit(key, LIMIT, WINDOW).ok, "expired window should reset the count").toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("retryAfterText", () => {
  it("uses seconds under a minute and minutes above", () => {
    expect(retryAfterText(1)).toBe("1 second");
    expect(retryAfterText(30)).toBe("30 seconds");
    expect(retryAfterText(60)).toBe("1 minute");
    expect(retryAfterText(600)).toBe("10 minutes");
  });
});
