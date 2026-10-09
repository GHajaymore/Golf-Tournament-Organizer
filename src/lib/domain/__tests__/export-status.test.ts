import { describe, it, expect } from "vitest";
import { exportStatus, exportRank, type ExportRowStatus } from "../csv-export";

const row = (over: Partial<ExportRowStatus>): ExportRowStatus => ({
  rank: 0,
  ranked: false,
  advancing: false,
  tiedAtCut: false,
  ...over,
});

/**
 * THE STANDINGS EXPORT SAYS WHY A ROW HAS NO PLACE (2026-10-08) — the copy a
 * committee mails round and pins up. DQ, WD and a missed cut exported as
 * "Eliminated" at rank 0.
 */
describe("a row in the standings export", () => {
  it("says DQ, WD or Missed the cut, with no rank", () => {
    expect(exportStatus(row({ disqualified: true }))).toBe("DQ");
    expect(exportStatus(row({ withdrew: true }))).toBe("WD");
    expect(exportStatus(row({ missedCut: "Round 1" }))).toBe("Missed the cut");
    expect(exportRank(row({ withdrew: true }))).toBe("");
  });

  it("keeps the qualifying statuses for the field (controls)", () => {
    expect(exportStatus(row({ ranked: true, rank: 1, advancing: true }))).toBe("Advancing");
    expect(exportStatus(row({ ranked: true, rank: 9 }))).toBe("Eliminated");
    expect(exportStatus(row({ ranked: true, rank: 4, tiedAtCut: true }))).toBe("Tied — play-off to decide");
    expect(exportRank(row({ ranked: true, rank: 3 }))).toBe("3");
  });
});
