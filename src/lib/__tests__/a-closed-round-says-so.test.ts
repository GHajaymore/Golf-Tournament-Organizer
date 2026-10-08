import { describe, it, expect } from "vitest";
import { snapshotStanding } from "@/lib/domain/lifecycle-state";
import { readSource } from "./source";

/**
 * A CLOSED ROUND IS NOT STILL COMING IN (2026-10-08).
 *
 * "2 of 3 cards in — these standings will change" under a round the committee
 * had closed: the third card was not late, it was never coming, and the board
 * already showed that player without a place.
 */
const base = { status: "live", done: 2, total: 3, unit: "cards" };

describe("the standings note", () => {
  it("says the round is closed once the committee has closed it", () => {
    const s = snapshotStanding({ ...base, roundClosed: true });
    expect(s.note).toMatch(/committee has closed this round/);
    expect(s.note).not.toMatch(/will change/);
  });

  it("still counts the cards while the round is open — the control", () => {
    expect(snapshotStanding(base).note).toBe("2 of 3 cards in — these standings will change.");
  });

  it("leaves a knockout's own wording alone", () => {
    const s = snapshotStanding({ ...base, unit: "ties", roundClosed: true });
    expect(s.note).toMatch(/ties decided/);
  });

  it("is told by both screens that print it", () => {
    for (const f of ["src/lib/services/me.ts", "src/app/(app)/reports/page.tsx"]) {
      expect(readSource(f), f).toMatch(/roundClosed: state\.boardStage\?\.closedAt != null/);
    }
  });
});
