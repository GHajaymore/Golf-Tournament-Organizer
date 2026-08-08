/**
 * CSV parsing shared by the two places clubs upload a list of people: a
 * tournament's entry list, and the club roster.
 *
 * Extracted rather than copied. The two importers have different rules about
 * what a row must contain — an entry needs an email because that is how the
 * player signs in, a roster member does not — but they must agree on what a
 * *column* is. A club whose spreadsheet says "Hcp Index" should not be
 * understood by one screen and rejected by the other.
 */

/** Splits one CSV line, honouring quoted fields containing commas. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Header spellings we accept for each field.
 *
 * Generous on purpose. These files come out of club management systems,
 * handicap exports and whatever a committee member typed in Excel, and a
 * rejected import over the word "Mobile" is a support email rather than a
 * data problem.
 */
export const CSV_COLUMN_ALIASES: Record<string, string[]> = {
  name: ["name", "player", "player name", "full name", "member", "member name"],
  firstName: ["first name", "firstname", "first", "given name", "forename"],
  lastName: ["last name", "lastname", "last", "surname", "family name"],
  handicap: ["handicap", "hcp", "handicap index", "index", "hi", "h'cap"],
  email: ["email", "e-mail", "email address", "e-mail address"],
  phone: ["phone", "phone number", "mobile", "cell", "cell phone", "telephone", "contact"],
  handicapType: ["handicap type", "9/18", "hcp type", "holes"],
  ghin: ["ghin", "ghin number", "ghin #", "ghin id", "handicap number"],
  homeClub: ["home club", "club", "home course"],
  gender: ["gender", "sex", "m/f"],
  memberNumber: ["member number", "member no", "member #", "membership number", "member id"],
  preferredTee: ["preferred tee", "tee", "tees", "default tee"],
  notes: ["notes", "note", "comment", "comments"],
};

/** The field a header cell names, or null when we don't recognise it. */
export function matchColumn(header: string): string | null {
  // Byte-order marks ride along on the first cell of a file saved by Excel
  // and would otherwise make the name column unrecognisable — the single most
  // common reason a valid CSV appears to have no header.
  const h = header.replace(/^﻿/, "").trim().toLowerCase();
  for (const [field, aliases] of Object.entries(CSV_COLUMN_ALIASES)) {
    if (aliases.includes(h)) return field;
  }
  return null;
}

export interface CsvTable {
  /** Field name per column position; null where the header wasn't recognised. */
  columns: (string | null)[];
  /** Data rows, already split. Header excluded. */
  rows: string[][];
}

/** Header row plus data rows, with blank lines dropped. */
export function parseCsv(csv: string): CsvTable | null {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return null;
  return {
    columns: splitCsvLine(lines[0]).map(matchColumn),
    rows: lines.slice(1).map(splitCsvLine),
  };
}

/** Reads a field from a row by name, trimmed, or "" when the column is absent. */
export function cell(table: CsvTable, row: string[], field: string): string {
  const i = table.columns.indexOf(field);
  return i === -1 ? "" : (row[i] ?? "").trim();
}

/**
 * A person's name, from whichever columns the file happens to carry.
 *
 * Club systems export "First Name"/"Last Name" at least as often as a single
 * "Name", and requiring one shape means half the exports in the world need
 * editing in Excel before they will load.
 */
export function nameFrom(table: CsvTable, row: string[]): string {
  const whole = cell(table, row, "name");
  if (whole) return whole;
  const first = cell(table, row, "firstName");
  const last = cell(table, row, "lastName");
  return [first, last].filter(Boolean).join(" ").trim();
}

/** Whether the table can yield a name at all — checked before importing. */
export function hasNameColumn(table: CsvTable): boolean {
  return (
    table.columns.includes("name") ||
    table.columns.includes("firstName") ||
    table.columns.includes("lastName")
  );
}
