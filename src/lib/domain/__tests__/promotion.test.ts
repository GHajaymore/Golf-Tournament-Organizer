import { describe, it, expect } from "vitest";
import { promotionState, PROMOTION_FOLLOW_UP_MS } from "@/lib/domain/promotion";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-06-01T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms);

/**
 * Who an organizer should chase after a waitlist promotion.
 *
 * The promotion is final — the player is in the field the moment it happens,
 * and no place is held vacant pending a reply. This decides only what to show
 * beside their name, so the failure modes are cosmetic-looking and still worth
 * guarding: a badge that never turns off is a badge nobody reads, and one that
 * appears for a player who was never promoted is a lie about the field.
 */
describe("promotionState", () => {
  it("says nothing about a player who was never on the waitlist", () => {
    // Which is most entries. The badge must be the exception, not the rule.
    expect(promotionState(null, NOW)).toEqual({ kind: "none" });
    expect(promotionState(undefined, NOW)).toEqual({ kind: "none" });
  });

  it("says nothing rather than something broken for an unparseable value", () => {
    // A malformed string is a reason to show no badge, never a reason to
    // render "Promoted NaN days ago".
    expect(promotionState("not a date", NOW)).toEqual({ kind: "none" });
    expect(promotionState("", NOW)).toEqual({ kind: "none" });
  });

  describe("inside the window they were asked to reply in", () => {
    it("is recent immediately after promotion", () => {
      const s = promotionState(ago(0), NOW);
      expect(s.kind).toBe("recent");
      expect(s.kind !== "none" && s.label).toBe("Promoted just now");
    });

    it("counts hours on the first day", () => {
      expect(promotionState(ago(1 * HOUR), NOW)).toEqual({ kind: "recent", label: "Promoted 1 hour ago" });
      expect(promotionState(ago(5 * HOUR), NOW)).toEqual({ kind: "recent", label: "Promoted 5 hours ago" });
    });

    it("is still only recent right up to the deadline", () => {
      // Boundary. At exactly 48 hours the request has not yet been missed.
      const s = promotionState(ago(PROMOTION_FOLLOW_UP_MS), NOW);
      expect(s.kind).toBe("recent");
    });
  });

  describe("past the window", () => {
    it("turns overdue one millisecond after the deadline", () => {
      const s = promotionState(ago(PROMOTION_FOLLOW_UP_MS + 1), NOW);
      expect(s.kind).toBe("overdue");
    });

    it("reads in days once it is past one", () => {
      expect(promotionState(ago(3 * DAY), NOW)).toEqual({ kind: "overdue", label: "Promoted 3 days ago" });
    });

    it("says yesterday rather than 1 days ago", () => {
      const s = promotionState(ago(30 * HOUR), NOW);
      expect(s.kind !== "none" && s.label).toBe("Promoted yesterday");
    });
  });

  it("stops showing anything once the promotion is old news", () => {
    /**
     * Without an upper bound a club that ran a waitlist last season would carry
     * a permanent row of badges into this one, and a badge that is always on is
     * a badge nobody sees. Two weeks is long past the point where chasing helps.
     */
    expect(promotionState(ago(15 * DAY), NOW)).toEqual({ kind: "none" });
    expect(promotionState(ago(400 * DAY), NOW)).toEqual({ kind: "none" });
  });

  it("treats a future timestamp as just now rather than a negative age", () => {
    // The badge is rendered on the client against the reader's clock, which can
    // sit slightly behind the server's. "Promoted -1 hours ago" is the bug that
    // would produce.
    const s = promotionState(new Date(NOW + 2 * HOUR), NOW);
    expect(s).toEqual({ kind: "recent", label: "Promoted just now" });
  });

  it("accepts an ISO string as well as a Date", () => {
    // The server sends a Date; it crosses to the client as a string. Both have
    // to mean the same thing or the badge changes on hydration.
    const at = ago(3 * DAY);
    expect(promotionState(at.toISOString(), NOW)).toEqual(promotionState(at, NOW));
  });
});
