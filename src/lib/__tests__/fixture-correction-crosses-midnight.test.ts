import { describe, it, expect } from "vitest";
import { endOfClubDay } from "@/lib/domain/club-clock";
import { openCorrectionOf } from "@/lib/domain/tournament-status";
import { correctionEndKeptOpen } from "../../../e2e/committee-correction";

/**
 * A spec that opens a committee correction at 23:59:50 on the club's clock must still hold it a
 * few minutes later (PR 1202, team-allowance.spec.ts: the correction lapsed at midnight and the
 * rounds lock came back mid-test). The real action stores `endOfClubDay(zone)`; the e2e helper
 * pushes that out. Each moment below is told to the day helpers, never read from the machine.
 */
const ZONES: { zone: string | null; start: string }[] = [
  { zone: "UTC", start: "2026-11-21T23:59:50Z" },
  { zone: "Pacific/Auckland", start: "2026-11-21T10:59:50Z" }, // 23:59:50 NZDT (UTC+13)
  { zone: "America/New_York", start: "2026-11-22T04:59:50Z" }, // 23:59:50 EST (UTC-5)
];

describe("a correction opened at the club's midnight stays open for the walk", () => {
  for (const { zone, start } of ZONES) {
    it(`${zone ?? "no zone"}: open five minutes after 23:59:50`, () => {
      const opened = new Date(start);
      const stored = endOfClubDay(zone, opened); // what openCorrection stores
      const row = { correctionScope: "rounds", correctionReason: "zz", correctionBy: "zz", correctionUntil: stored };
      // the defect: the action's own end is seconds away, so five minutes on it has lapsed
      const later = new Date(opened.getTime() + 5 * 60 * 1000);
      expect(openCorrectionOf(row, later)).toBeNull();
      // the fix: the helper's new end keeps it open
      const kept = correctionEndKeptOpen(stored, opened);
      expect(kept).not.toBeNull();
      expect(openCorrectionOf({ ...row, correctionUntil: kept }, later)).not.toBeNull();
    });
  }

  it("leaves a correction with plenty of day left alone, and a missing one", () => {
    const now = new Date("2026-11-21T12:00:00Z");
    expect(correctionEndKeptOpen(endOfClubDay("UTC", now), now)).toBeNull();
    expect(correctionEndKeptOpen(null, now)).toBeNull();
  });
});
