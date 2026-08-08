import { describe, it, expect } from "vitest";
import { parseTeeSheet, validateTeeSheet, groupForPlayer, type TeeSheet } from "../domain/tee-sheet";

/**
 * The tee sheet as a saved thing.
 *
 * The property under test: what gets stored is exactly the known shape, and
 * a sheet that would be wrong on the day — a player in two places, a name
 * outside the field, a tee time with nobody on it — is refused whole.
 */

const SHEET: TeeSheet = {
  savedAt: "2026-08-08T12:00:00Z",
  startType: "tee",
  groups: [
    { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: ["a", "b"] },
    { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: ["c", "d"] },
  ],
};

describe("parsing what was stored", () => {
  it("round-trips a real sheet", () => {
    const parsed = parseTeeSheet(JSON.stringify(SHEET));
    expect(parsed).not.toBeNull();
    expect(parsed!.groups).toHaveLength(2);
    expect(parsed!.groups[0].playerIds).toEqual(["a", "b"]);
  });

  it("returns null for junk rather than throwing", () => {
    expect(parseTeeSheet("")).toBeNull();
    expect(parseTeeSheet("not json")).toBeNull();
    expect(parseTeeSheet('{"groups": "nope"}')).toBeNull();
  });

  it("drops malformed entries instead of storing them", () => {
    const parsed = parseTeeSheet(JSON.stringify({
      groups: [
        { name: "ok", startHole: 3, time: "9:00 AM", playerIds: ["a", 7, "", "b"] },
        { name: "bad", playerIds: "not-an-array" },
      ],
    }));
    expect(parsed!.groups).toHaveLength(1);
    expect(parsed!.groups[0].playerIds).toEqual(["a", "b"]);
  });

  it("repairs a nonsense start hole to the 1st", () => {
    const parsed = parseTeeSheet(JSON.stringify({ groups: [{ name: "g", startHole: -4, time: "", playerIds: ["a"] }] }));
    expect(parsed!.groups[0].startHole).toBe(1);
  });
});

describe("what makes a sheet publishable", () => {
  const field = new Set(["a", "b", "c", "d"]);

  it("passes a clean sheet", () => {
    expect(validateTeeSheet(SHEET, field)).toEqual([]);
  });

  it("names a player drawn in two groups", () => {
    const bad = { ...SHEET, groups: [SHEET.groups[0], { ...SHEET.groups[1], playerIds: ["b", "c"] }] };
    const problems = validateTeeSheet(bad, field);
    expect(problems.some((p) => p.includes("both"))).toBe(true);
  });

  it("refuses a player outside the confirmed field", () => {
    const bad = { ...SHEET, groups: [{ ...SHEET.groups[0], playerIds: ["a", "ghost"] }] };
    expect(validateTeeSheet(bad, field).some((p) => p.includes("confirmed field"))).toBe(true);
  });

  it("refuses a tee time with nobody on it", () => {
    const bad = { ...SHEET, groups: [{ ...SHEET.groups[0], playerIds: [] }] };
    expect(validateTeeSheet(bad, field).some((p) => p.includes("nobody"))).toBe(true);
  });

  it("refuses an empty sheet", () => {
    expect(validateTeeSheet({ ...SHEET, groups: [] }, field)).toHaveLength(1);
  });
});

describe("your tee time", () => {
  it("finds the group a player is drawn in", () => {
    expect(groupForPlayer(SHEET, "c")!.name).toBe("Group 2");
    expect(groupForPlayer(SHEET, "ghost")).toBeNull();
  });
});
