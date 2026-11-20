import { cell, nameFrom, standingCell, type CsvTable } from "../csv";
import { EMAIL_RE } from "./typed-limits";
import { looksLikePhone } from "./registration-intake";
import {
  defaultStanding,
  handicapIdKey,
  readStanding,
  GUEST,
  MEMBER,
  type EntryStanding,
  type StandingCheck,
} from "./entry-standing";

/**
 * ONE READING OF AN ENTRY LIST, FOR THE PREVIEW AND THE IMPORT (no-email player
 * identity, PR 1).
 *
 * `previewCsvSignups` shows what a file will do and `importCsvSignups` does
 * it; both read every row through this, so the preview cannot promise a row
 * the import then skips, or call a row a member that the import stores as a
 * guest. The import never trusts the preview: it re-reads the file and applies
 * the organizer's switches (`choices`) through `readChoices` here.
 *
 * Pure, so the whole table of Ajay's default is unit-tested without a database.
 */

export interface SignupRowPlan {
  /** The row's position in the file's data rows (0-based), which is what a switch names. */
  row: number;
  name: string;
  /** As the file had it, lower-cased. */
  email: string;
  /** The handicap ID cell, as typed. */
  handicapId: string;
  standing: EntryStanding;
  /** Why the default is worth a look; null when the organizer chose or the file said. */
  check: StandingCheck | null;
  /** The roster member a "roster-name" check matched, as the roster spells them. */
  rosterName: string;
  skip: "invalid" | "duplicate" | null;
  /** What goes on the entry: "" for a guest, whose email is never put where a sign-in reads it. */
  entryEmail: string;
  /** A guest row that carried an email: imported without it. */
  emailDropped: boolean;
}

export interface SignupFacts {
  /** Every entry already in this tournament. */
  existing: Array<{ email: string; name: string }>;
  /** The names on the club's roster, for the "same name as a member" check. */
  rosterNames: string[];
  /** Whether this tournament collects a mobile from every member (`phoneRequiredFor`). Never a guest. */
  needsPhone: boolean;
}

/**
 * The organizer's switches, read at the boundary: a row index the file has,
 * and a standing this app has. Anything else is dropped, never trusted.
 */
export function readChoices(raw: unknown, rowCount: number): Record<number, EntryStanding> {
  const out: Record<number, EntryStanding> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const row = Number(key);
    const standing = readStanding(value);
    if (!Number.isInteger(row) || row < 0 || row >= rowCount || !standing) continue;
    out[row] = standing;
  }
  return out;
}

export function planCsvSignups(
  table: CsvTable,
  facts: SignupFacts,
  choices: Record<number, EntryStanding>,
): SignupRowPlan[] {
  const seenEmails = new Set(facts.existing.map((p) => p.email.trim().toLowerCase()).filter(Boolean));
  const seenNames = new Set(
    facts.existing.filter((p) => !p.email.trim()).map((p) => p.name.trim().toLowerCase()).filter(Boolean),
  );
  const roster = new Map(facts.rosterNames.map((n) => [n.trim().toLowerCase(), n.trim()] as const));

  return table.rows.map((cols, row) => {
    const name = nameFrom(table, cols);
    const email = cell(table, cols, "email").toLowerCase();
    const handicapId = cell(table, cols, "ghin").trim();
    const nameKey = name.trim().toLowerCase();
    const rosterName = roster.get(nameKey) ?? "";
    const chosen = choices[row] ?? null;
    const fallback = defaultStanding({
      written: standingCell(table, cols),
      email,
      handicapId,
      rosterMatch: !!rosterName,
    });
    const standing = chosen ?? fallback.standing;
    const check = chosen ? null : (fallback.check ?? null);
    const entryEmail = standing === GUEST ? "" : email;
    const plan: SignupRowPlan = {
      row,
      name,
      email,
      handicapId,
      standing,
      check,
      rosterName: check === "roster-name" ? rosterName : "",
      skip: null,
      entryEmail,
      emailDropped: standing === GUEST && !!email,
    };
    if (!name) return { ...plan, skip: "invalid" };
    /**
     * A MALFORMED address is a refusal for a member — "j.smith@" is somebody's
     * mistake, and importing it makes a sign-in that can never work. A blank
     * one no longer is (Ajay, 2026-11-07: a member may enter without one).
     */
    if (entryEmail && !EMAIL_RE.test(entryEmail)) return { ...plan, skip: "invalid" };
    // De-duplicated on email where the entry has one and on name where it has not.
    if (entryEmail ? seenEmails.has(entryEmail) : seenNames.has(nameKey)) return { ...plan, skip: "duplicate" };
    // A mobile is asked of members where the organizer asks for one. Never of a guest (ruled).
    if (standing === MEMBER && facts.needsPhone && !looksLikePhone(cell(table, cols, "phone"))) {
      return { ...plan, skip: "invalid" };
    }
    // Both keys updated as we go, or a file that repeats a row imports it twice.
    if (entryEmail) seenEmails.add(entryEmail);
    else seenNames.add(nameKey);
    return plan;
  });
}

/** "d…@example.invalid": enough to recognise, not enough to copy. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return email ? "…" : "";
  return `${email[0]}…${email.slice(at)}`;
}

/** "•••4567": the last four of a handicap ID. */
export function maskHandicapId(id: string): string {
  const key = handicapIdKey(id);
  if (!key) return "";
  return key.length <= 4 ? key : `•••${key.slice(-4)}`;
}
