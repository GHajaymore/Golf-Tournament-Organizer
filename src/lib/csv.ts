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

/**
 * Reads a field from a row, trimmed, or "" when the column is absent.
 *
 * Takes the first column carrying a VALUE rather than the first column
 * carrying the name. Two headers can legitimately claim one field — "Phone"
 * and "Mobile" are both a phone number, and a club system that exports both
 * routinely fills one and leaves the other blank. Reading the first position
 * unconditionally then returned an empty string for a row that plainly had a
 * number in it, and the importer skipped the entrant as unreachable.
 *
 * Falls back to the first matching column when every one of them is empty, so
 * "no value" still reads as "".
 */
export function cell(table: CsvTable, row: string[], field: string): string {
  let first = -1;
  for (let i = 0; i < table.columns.length; i += 1) {
    if (table.columns[i] !== field) continue;
    if (first === -1) first = i;
    const value = (row[i] ?? "").trim();
    if (value) return value;
  }
  return first === -1 ? "" : (row[first] ?? "").trim();
}

/**
 * Fields claimed by more than one header, for warning the organizer.
 *
 * Worth surfacing rather than silently resolving: two phone columns is
 * usually a spreadsheet somebody merged badly, and an import that quietly
 * picks one is how the wrong number ends up on the tee sheet.
 */
export function duplicateColumns(table: CsvTable): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const c of table.columns) {
    if (!c) continue;
    if (seen.has(c)) dupes.add(c);
    seen.add(c);
  }
  return [...dupes];
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

/**
 * The largest CSV worth sending to a server action.
 *
 * Next caps a server action's body at 1 MB by default, and exceeding it
 * rejects the request before any of our code runs: no error, no result, the
 * screen simply does nothing. A club uploading a whole season's entries got
 * silence and no reason to think anything had gone wrong.
 *
 * Under the limit rather than at it, because the body carries the action's own
 * framing as well as the text, and a file that squeaks past this check only to
 * be rejected by the platform is the same silent failure with extra steps.
 */
export const MAX_CSV_BYTES = 900_000;

/**
 * Why this file cannot be uploaded, or null when it can.
 *
 * Measured in BYTES, not characters. A roster of names with accents or a
 * non-Latin script encodes to more bytes than it has characters, and the limit
 * the platform enforces is on bytes — checking length would let exactly the
 * files most likely to be large through.
 */
export function csvSizeRefusal(bytes: number): string | null {
  if (bytes <= MAX_CSV_BYTES) return null;
  const mb = (bytes / 1_000_000).toFixed(1);
  return (
    `That file is ${mb} MB, which is too big to upload in one go (the limit is under 1 MB). ` +
    `Split it into a few smaller files and import them one after another — entries already ` +
    `loaded are skipped as duplicates, so an overlap does no harm.`
  );
}
