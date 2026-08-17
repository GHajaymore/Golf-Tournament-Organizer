import { describe, it, expect } from "vitest";
import {
  parseCsv,
  cell,
  nameFrom,
  hasNameColumn,
  duplicateColumns,
  csvSizeRefusal,
  MAX_CSV_BYTES,
} from "@/lib/csv";
import { parseTeeSheet, teeSheetDrift, teeSheetAsPlayed } from "@/lib/domain/tee-sheet";

/**
 * D10, D13 and D14 of the 2026-08-12 audit, and the reading half of D12.
 *
 * D11 — the entry importer de-duplicating on name — is enforced in the action
 * and covered by the audit suite; there is nothing pure left to test here once
 * the name check is gone.
 */

const table = (csv: string) => parseCsv(csv)!;

describe("D10 — the two importers read the same headers", () => {
  it("builds a name from separate first and last columns", () => {
    // The entry importer looked only for a single "name" column, so a club
    // system exporting this loaded onto the roster and was rejected from the
    // entry list — the same file, the same app, two answers.
    const t = table("First Name,Last Name,Email\nTom,Halloran,tom@example.invalid");
    expect(hasNameColumn(t)).toBe(true);
    expect(nameFrom(t, t.rows[0])).toBe("Tom Halloran");
  });

  it("still prefers a single name column when the file has one", () => {
    const t = table("Name,First Name,Email\nTom Halloran,Ignored,tom@example.invalid");
    expect(nameFrom(t, t.rows[0])).toBe("Tom Halloran");
  });

  it("copes with only one half of the pair", () => {
    const t = table("Surname,Email\nHalloran,tom@example.invalid");
    expect(nameFrom(t, t.rows[0])).toBe("Halloran");
  });

  it("recognises no name column at all", () => {
    expect(hasNameColumn(table("Email,Handicap\na@b.test,10"))).toBe(false);
  });
});

describe("D14 — two headers claiming one field", () => {
  it("takes the column that actually has a value", () => {
    // "Phone" and "Mobile" both mean phone. A club system that exports both
    // and fills one left the importer reading the empty one and skipping the
    // entrant as unreachable.
    const t = table("Name,Phone,Mobile\nTom,,07700 900123");
    expect(cell(t, t.rows[0], "phone")).toBe("07700 900123");
  });

  it("takes the first when both are filled", () => {
    const t = table("Name,Phone,Mobile\nTom,07700 900111,07700 900222");
    expect(cell(t, t.rows[0], "phone")).toBe("07700 900111");
  });

  it("still reads empty when every claiming column is empty", () => {
    const t = table("Name,Phone,Mobile\nTom,,");
    expect(cell(t, t.rows[0], "phone")).toBe("");
  });

  it("reports the duplication so it can be surfaced", () => {
    const t = table("Name,Phone,Mobile,Email\nTom,,07700 900123,a@b.test");
    expect(duplicateColumns(t)).toEqual(["phone"]);
    expect(duplicateColumns(table("Name,Email\nTom,a@b.test"))).toEqual([]);
  });
});

describe("D13 — a file too big to send", () => {
  it("lets an ordinary file through", () => {
    expect(csvSizeRefusal(50_000)).toBeNull();
    expect(csvSizeRefusal(MAX_CSV_BYTES)).toBeNull();
  });

  it("refuses one over the limit, with what to do about it", () => {
    // Over the platform's body cap the request never reaches our code: no
    // error, no result, the screen simply does nothing. The only fix is to
    // catch it before sending.
    const refusal = csvSizeRefusal(2_400_000);
    expect(refusal).toMatch(/2\.4 MB/);
    expect(refusal).toMatch(/Split it into a few smaller files/);
  });

  it("measures bytes, not characters", () => {
    // A roster in a non-Latin script encodes to more bytes than it has
    // characters, and bytes are what the platform counts — so exactly the
    // files most likely to be too big would have slipped through a length check.
    const text = "é".repeat(500_000); // 500k characters, ~1MB in UTF-8
    expect(text.length).toBeLessThan(MAX_CSV_BYTES);
    expect(csvSizeRefusal(new TextEncoder().encode(text).length)).not.toBeNull();
  });
});

describe("D12 — a published sheet against a field that moved", () => {
  const sheet = parseTeeSheet(
    JSON.stringify({
      savedAt: "2026-08-01T09:00:00.000Z",
      startType: "tee",
      groups: [
        { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: ["p1", "p2", "p3", "p4"] },
        { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: ["p5", "p6"] },
      ],
    }),
  )!;

  it("says nothing when the field is unchanged", () => {
    const drift = teeSheetDrift(sheet, new Set(["p1", "p2", "p3", "p4", "p5", "p6"]));
    expect(drift.stale).toBe(false);
    expect(drift.departed).toEqual([]);
    expect(drift.undrawn).toEqual([]);
  });

  it("names the group left short by a withdrawal", () => {
    // The audit's symptom: the group prints with three and nothing says why.
    const drift = teeSheetDrift(sheet, new Set(["p1", "p2", "p3", "p5", "p6"]));
    expect(drift.stale).toBe(true);
    expect(drift.departed).toEqual(["p4"]);
    expect(drift.shortGroups).toEqual(["Group 1"]);
  });

  it("counts a player who entered after the sheet went out", () => {
    // As much a mismatch as a departure: they have no tee time and no way to
    // find out except by asking.
    const drift = teeSheetDrift(sheet, new Set(["p1", "p2", "p3", "p4", "p5", "p6", "p7"]));
    expect(drift.stale).toBe(true);
    expect(drift.undrawn).toEqual(["p7"]);
    expect(drift.shortGroups).toEqual([]);
  });

  it("reads the sheet without the departed, leaving the stored draw alone", () => {
    const confirmed = new Set(["p1", "p2", "p3", "p5", "p6"]);
    const view = teeSheetAsPlayed(sheet, confirmed);
    expect(view.groups[0].playerIds).toEqual(["p1", "p2", "p3"]);
    // The original is untouched — this is a view, not a migration.
    expect(sheet.groups[0].playerIds).toHaveLength(4);
  });
});
