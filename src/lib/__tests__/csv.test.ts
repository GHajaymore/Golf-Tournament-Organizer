import { describe, it, expect } from "vitest";
import {
  splitCsvLine,
  matchColumn,
  parseCsv,
  cell,
  nameFrom,
  hasNameColumn,
  CSV_COLUMN_ALIASES,
} from "../csv";

/**
 * The importer's job is to accept the file a club actually has.
 *
 * These files come out of club management systems, handicap exports and
 * whatever a committee member typed in Excel. Nearly every failure is one of
 * three things — a comma inside a quoted name, a byte-order mark on the first
 * header cell, or a heading spelled differently from the one we expected — and
 * all three look to the organizer like "the app rejected my members".
 */

describe("splitCsvLine", () => {
  it("splits a plain row", () => {
    expect(splitCsvLine("Ann,12.4,ann@example.com")).toEqual(["Ann", "12.4", "ann@example.com"]);
  });

  it("keeps commas inside quoted fields", () => {
    // "Doyle, Ann" is how half the world's exports write a name.
    expect(splitCsvLine('"Doyle, Ann",12.4')).toEqual(["Doyle, Ann", "12.4"]);
  });

  it("unescapes doubled quotes", () => {
    expect(splitCsvLine('"Ann ""AJ"" Doyle",8')).toEqual(['Ann "AJ" Doyle', "8"]);
  });

  it("preserves empty cells rather than dropping them", () => {
    // Dropping an empty cell shifts every column after it, which silently
    // files phone numbers as handicaps.
    expect(splitCsvLine("Ann,,ann@example.com")).toEqual(["Ann", "", "ann@example.com"]);
    expect(splitCsvLine("Ann,12.4,")).toEqual(["Ann", "12.4", ""]);
  });

  it("handles a single field and an empty line", () => {
    expect(splitCsvLine("Ann")).toEqual(["Ann"]);
    expect(splitCsvLine("")).toEqual([""]);
  });
});

describe("matchColumn", () => {
  it("is case- and space-insensitive", () => {
    expect(matchColumn("  NAME  ")).toBe("name");
    expect(matchColumn("Handicap Index")).toBe("handicap");
    expect(matchColumn("E-Mail Address")).toBe("email");
  });

  it("strips the byte-order mark Excel puts on the first cell", () => {
    // Without this the name column is unrecognisable and a perfectly good file
    // reports "couldn't find a name column" — the single most common false
    // rejection there is.
    expect(matchColumn("﻿name")).toBe("name");
    expect(matchColumn("﻿Name")).toBe("name");
  });

  it("returns null for a heading it doesn't know", () => {
    expect(matchColumn("Favourite Club")).toBeNull();
    expect(matchColumn("")).toBeNull();
  });

  it("has no alias claimed by two fields", () => {
    // An alias in two lists would resolve by object key order, which is not a
    // rule anyone could reason about.
    const seen = new Map<string, string>();
    for (const [field, aliases] of Object.entries(CSV_COLUMN_ALIASES)) {
      for (const a of aliases) {
        expect(seen.has(a), `"${a}" is claimed by both ${seen.get(a)} and ${field}`).toBe(false);
        seen.set(a, field);
      }
    }
  });

  it("accepts the spellings clubs actually use", () => {
    for (const [heading, field] of [
      ["Player Name", "name"],
      ["Surname", "lastName"],
      ["Given Name", "firstName"],
      ["HI", "handicap"],
      ["Mobile", "phone"],
      ["GHIN #", "ghin"],
      ["Membership Number", "memberNumber"],
      ["Home Club", "homeClub"],
    ] as const) {
      expect(matchColumn(heading), heading).toBe(field);
    }
  });
});

describe("parseCsv", () => {
  it("returns null for an empty or whitespace-only file", () => {
    expect(parseCsv("")).toBeNull();
    expect(parseCsv("\n\n  \n")).toBeNull();
  });

  it("drops blank lines rather than importing them as rows", () => {
    const t = parseCsv("name,handicap\nAnn,12\n\nBob,8\n")!;
    expect(t.rows).toHaveLength(2);
  });

  it("survives CRLF line endings", () => {
    const t = parseCsv("name,handicap\r\nAnn,12\r\n")!;
    expect(t.columns).toEqual(["name", "handicap"]);
    expect(cell(t, t.rows[0], "handicap")).toBe("12");
  });

  it("keeps unrecognised columns as null instead of shifting the rest", () => {
    const t = parseCsv("name,favourite club,handicap\nAnn,Driver,12")!;
    expect(t.columns).toEqual(["name", null, "handicap"]);
    // The point: handicap still reads 12, not "Driver".
    expect(cell(t, t.rows[0], "handicap")).toBe("12");
  });

  it("returns an empty string for a column the file doesn't have", () => {
    const t = parseCsv("name\nAnn")!;
    expect(cell(t, t.rows[0], "phone")).toBe("");
  });

  it("returns an empty string for a row shorter than the header", () => {
    // Trailing empty cells are routinely omitted; reading past the end must
    // not produce undefined.
    const t = parseCsv("name,email,phone\nAnn")!;
    expect(cell(t, t.rows[0], "phone")).toBe("");
  });
});

describe("nameFrom", () => {
  it("prefers a single name column", () => {
    const t = parseCsv("name,first name,last name\nAnn Doyle,Ann,Doyle")!;
    expect(nameFrom(t, t.rows[0])).toBe("Ann Doyle");
  });

  it("joins first and last when there is no whole name", () => {
    // Club systems export split names at least as often as joined ones, and
    // requiring one shape means half the exports need editing first.
    const t = parseCsv("first name,last name\nAnn,Doyle")!;
    expect(nameFrom(t, t.rows[0])).toBe("Ann Doyle");
  });

  it("copes with only one half present", () => {
    const t = parseCsv("first name,last name\nAnn,")!;
    expect(nameFrom(t, t.rows[0])).toBe("Ann");
  });

  it("returns empty when the row has no name at all", () => {
    const t = parseCsv("name,handicap\n,12")!;
    expect(nameFrom(t, t.rows[0])).toBe("");
  });

  it("recognises a usable header either way round", () => {
    expect(hasNameColumn(parseCsv("name,handicap\nAnn,12")!)).toBe(true);
    expect(hasNameColumn(parseCsv("first name,last name\nAnn,Doyle")!)).toBe(true);
    expect(hasNameColumn(parseCsv("email,handicap\na@b.com,12")!)).toBe(false);
  });
});

describe("a real-world file", () => {
  it("reads a quoted, BOM-prefixed, split-name export correctly", () => {
    const csv =
      '﻿Last Name,First Name,HI,Mobile,GHIN #\r\n' +
      '"Doyle, Jr.",Ann,12.4,555-0100,1234567\r\n' +
      "Ferris,Rob,,555-0101,\r\n";
    const t = parseCsv(csv)!;
    expect(t.columns).toEqual(["lastName", "firstName", "handicap", "phone", "ghin"]);

    expect(nameFrom(t, t.rows[0])).toBe("Ann Doyle, Jr.");
    expect(cell(t, t.rows[0], "handicap")).toBe("12.4");
    expect(cell(t, t.rows[0], "ghin")).toBe("1234567");

    // Second row has no handicap and no GHIN — both must read as empty rather
    // than borrowing the previous row's values.
    expect(nameFrom(t, t.rows[1])).toBe("Rob Ferris");
    expect(cell(t, t.rows[1], "handicap")).toBe("");
    expect(cell(t, t.rows[1], "ghin")).toBe("");
  });
});
