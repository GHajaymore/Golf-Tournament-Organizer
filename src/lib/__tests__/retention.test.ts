import { describe, it, expect } from "vitest";
import { retentionDecision, dueForPurge, hoursRemaining, type RetainableEvent } from "../retention";
import { retentionNotice, keepsDataForever, planFor } from "../plans";

const NOW = new Date("2026-08-06T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

const ev = (over: Partial<RetainableEvent> = {}): RetainableEvent => ({
  id: "e1",
  status: "completed",
  completedAt: hoursAgo(1),
  plan: "free",
  ...over,
});

describe("what is safe from deletion", () => {
  it("never touches a paid plan", () => {
    const d = retentionDecision(ev({ plan: "club", completedAt: hoursAgo(10_000) }), NOW);
    expect(d.purge).toBe(false);
    expect(d.reason).toMatch(/indefinitely/);
    expect(keepsDataForever("club")).toBe(true);
  });

  it("never touches a tournament that is still running", () => {
    for (const status of ["draft", "registration", "ready", "live"]) {
      const d = retentionDecision(ev({ status, completedAt: hoursAgo(500) }), NOW);
      expect(d.purge, status).toBe(false);
    }
  });

  it("never touches one with no completion time recorded", () => {
    // Every tournament predating this feature has a null completedAt. Guessing
    // one from updatedAt would have made retention's first act the deletion of
    // real results.
    const d = retentionDecision(ev({ completedAt: null }), NOW);
    expect(d.purge).toBe(false);
    expect(d.reason).toMatch(/no completion time/);
  });

  it("never touches one still inside the window", () => {
    expect(retentionDecision(ev({ completedAt: hoursAgo(47) }), NOW).purge).toBe(false);
    expect(retentionDecision(ev({ completedAt: hoursAgo(0) }), NOW).purge).toBe(false);
  });
});

describe("what is due", () => {
  it("selects a free tournament past the window", () => {
    const d = retentionDecision(ev({ completedAt: hoursAgo(49) }), NOW);
    expect(d.purge).toBe(true);
    expect(d.reason).toMatch(/past the 48h window/);
  });

  it("treats the boundary as due rather than leaving it forever", () => {
    expect(retentionDecision(ev({ completedAt: hoursAgo(48) }), NOW).purge).toBe(true);
  });

  it("reports how far past the window it is", () => {
    const d = retentionDecision(ev({ completedAt: hoursAgo(58) }), NOW);
    expect(d.overdueHours).toBeCloseTo(10, 1);
  });

  it("filters a mixed set down to only what is due", () => {
    const due = dueForPurge(
      [
        ev({ id: "old-free", completedAt: hoursAgo(72) }),
        ev({ id: "recent-free", completedAt: hoursAgo(2) }),
        ev({ id: "old-paid", plan: "club", completedAt: hoursAgo(72) }),
        ev({ id: "live", status: "live", completedAt: hoursAgo(72) }),
        ev({ id: "no-stamp", completedAt: null }),
      ],
      NOW,
    );
    expect(due.map((d) => d.id)).toEqual(["old-free"]);
  });
});

describe("telling the organizer while it still matters", () => {
  it("counts down for a finished free tournament", () => {
    expect(hoursRemaining(ev({ completedAt: hoursAgo(6) }), NOW)).toBeCloseTo(42, 1);
  });

  it("floors at zero rather than going negative", () => {
    expect(hoursRemaining(ev({ completedAt: hoursAgo(100) }), NOW)).toBe(0);
  });

  it("counts down for nothing on a paid plan or an unfinished event", () => {
    expect(hoursRemaining(ev({ plan: "club" }), NOW)).toBeNull();
    expect(hoursRemaining(ev({ status: "live" }), NOW)).toBeNull();
    expect(hoursRemaining(ev({ completedAt: null }), NOW)).toBeNull();
  });
});

describe("the notice shown before anyone plays", () => {
  it("says deleted, in plain words, with the real number", () => {
    const notice = retentionNotice("free")!;
    expect(notice).toMatch(/permanently deleted/);
    expect(notice).toMatch(/48 hours/);
    expect(notice).toMatch(/Export/);
  });

  it("reads the number from the plan rather than repeating it", () => {
    // One constant. Changing 48 anywhere changes every surface that says it.
    expect(retentionNotice("free")).toContain(String(planFor("free").retentionHours));
  });

  it("says nothing on a plan that keeps data", () => {
    expect(retentionNotice("club")).toBeNull();
  });
});
