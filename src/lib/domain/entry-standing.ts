/**
 * MEMBER OR GUEST: THE ONE RULE (the no-email player identity, PR 1).
 *
 * Ajay, 2026-11-07: organizers and staff need an email; members may enter
 * without one (they need one for their own account); a guest — "Guest (not a
 * club member)" — needs none; on the day everyone scores from the cart QR with
 * no sign-in.
 *
 * So a blank email no longer says "guest": a member may have none. The
 * standing is STORED (`Player.standing`, A039) and every door asks this file:
 *
 * - `entryStanding` reads a stored entry. "" is every entry made before A039
 *   and reads as a member: today's behaviour, never re-labelled. Anything
 *   unknown reads as a member too — the guest branch is the one later work
 *   anonymises, so it is never the fallback.
 * - `readStanding` checks a standing a caller SENT (a server action is a public
 *   endpoint; TypeScript types are erased at runtime).
 * - `defaultStanding` is the CSV rule, Ajay's, row by row.
 *
 * "guest" is the club's own word for the same person: `ORG_GUEST_ROLES` in
 * `services/access.ts` ("somebody entered for one event who is not a member of
 * the club"). `entry-standing.test.ts` holds the two to one spelling.
 *
 * Pure: the Entries screen, the roster and the actions all import it.
 */
import { inClubWords, type GolfWords } from "./golf-terms";

export const ENTRY_STANDINGS = ["member", "guest"] as const;
export type EntryStanding = (typeof ENTRY_STANDINGS)[number];

/** The club role and the entry standing share one word. */
export const GUEST: EntryStanding = "guest";
export const MEMBER: EntryStanding = "member";

/** A stored entry's standing. "" (before A039) and anything unknown read as a member. */
export function entryStanding(entry: { standing?: string | null }): EntryStanding {
  return (entry.standing ?? "").trim().toLowerCase() === GUEST ? GUEST : MEMBER;
}

/** Whether a stored entry is a guest — `entryStanding`, said as a yes or no. */
export function isGuest(entry: { standing?: string | null }): boolean {
  return entryStanding(entry) === GUEST;
}

/** A standing a caller sent, or null when it is not one this app has. */
export function readStanding(value: unknown): EntryStanding | null {
  return typeof value === "string" && (ENTRY_STANDINGS as readonly string[]).includes(value)
    ? (value as EntryStanding)
    : null;
}

/** Why a row's default is worth a second look in the preview. */
export type StandingCheck = "handicap-id" | "roster-name";

/**
 * THE CSV DEFAULT (Ajay's rule, design §3.3), for one row:
 *
 * | Row                                              | Default | Check        |
 * | the file's own column says member or guest       | written | —            |
 * | has an email                                     | member  | —            |
 * | no email, has a handicap ID                      | member  | handicap-id  |
 * | no email, name matches a member on the roster    | member  | roster-name  |
 * | no email, no ID, no match                        | guest   | —            |
 *
 * Every input is REQUIRED, so a caller cannot leave one out and get a quiet
 * guest: `written` is null when the file says nothing.
 */
export function defaultStanding(row: {
  written: EntryStanding | null;
  email: string;
  handicapId: string;
  rosterMatch: boolean;
}): { standing: EntryStanding; check?: StandingCheck } {
  if (row.written) return { standing: row.written };
  if (row.email.trim()) return { standing: MEMBER };
  if (handicapIdKey(row.handicapId)) return { standing: MEMBER, check: "handicap-id" };
  if (row.rosterMatch) return { standing: MEMBER, check: "roster-name" };
  return { standing: GUEST };
}

/** A handicap ID as a key: upper-case, letters and digits only ("12-345 67" → "1234567"). */
export function handicapIdKey(id: string): string {
  return (id ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * What a file's standing cell says, or null when it says nothing we can read.
 *
 * Under a "member or guest" column: member / m, guest / g (and "Guest (not a
 * club member)", which is what the app writes). Under a column headed "guest":
 * yes / y is a guest and no / n a member. A word we cannot read ("Social",
 * "Junior") is null, and the row takes the default rule rather than a guess.
 */
export function standingWritten(value: string, column: "standing" | "guestFlag"): EntryStanding | null {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return null;
  if (column === "guestFlag") {
    if (["yes", "y", "true", "x", "1", "guest", "g"].includes(v)) return GUEST;
    if (["no", "n", "false", "0", "member", "m"].includes(v)) return MEMBER;
    return null;
  }
  if (["member", "m", "club member"].includes(v)) return MEMBER;
  if (["guest", "g", "non-member", "non member", "visitor"].includes(v) || v.startsWith("guest (")) return GUEST;
  return null;
}

/* ── The words (UX Writer, design §10.1–10.2). A guest is never lesser. ── */

/** The choice, as the screens print it. */
export const STANDING_CHOICE: Record<EntryStanding, string> = {
  member: "Member",
  guest: "Guest (not a club member)",
};

/** The short tag beside a name. */
export const STANDING_TAG: Record<EntryStanding, string> = {
  member: "Member",
  guest: "Guest",
};

export const NO_EMAIL_YET = "No email yet";

/**
 * The organizer's hint, wherever the list is built (Add, the field, approval,
 * the roster, the CSV import). True before the player link exists: a guest
 * scores from the cart QR. `club` is the club's name, or "the club"; `words`
 * are the club's golf words (a {cart} is a buggy in Britain).
 */
export function standingHint(club: string, words: GolfWords): string {
  const who = club.trim() || "the club";
  return inClubWords(
    `Member: belongs to ${who}. Add their email so they can sign in. ` +
      `Guest (not a club member): no email needed. Everyone scores from the {cart} QR on the day.`,
    words,
  );
}

/** Said under Email when a member is being added without one. */
export const MEMBER_WITHOUT_EMAIL = "They can play and score now. Add an email later so they can sign in.";

/** Said when an entry without an email turned round codes on. */
export const CODES_TURNED_ON =
  "Players without an email score with the round code, so round codes are on now too. Change it on Tournament details.";

/** The roster's line after entering members who have no email. */
export function rosterNoEmailYet(names: string, words: GolfWords): string {
  const verb = names.includes(",") || names.includes(" and ") ? "have" : "has";
  return inClubWords(`${names} ${verb} no email yet. They're entered and score from the {cart} QR.`, words);
}

/** The import's column guide. */
export const CSV_STANDING_GUIDE =
  "Member or guest: optional. Write member or guest. Handicap ID: optional, helps us recognise a player next time. " +
  "With no email, a row is a guest unless it has a handicap ID or matches a member.";

/** The template a club downloads and fills in. Header only: an example row is a player somebody forgets to delete. */
export const CSV_TEMPLATE_HEADER = "name,email,handicap,handicap id,member or guest";

/** A check flag in the preview. */
export const CHECK_WORDS: Record<StandingCheck, string> = {
  "handicap-id": "No email, but has a handicap ID",
  "roster-name": "Same name as a member on your roster",
};

/** A guest row whose file carried an email (before guests can hold one, A040). */
export const GUEST_EMAIL_DROPPED = "Imported without the email.";

/** "18 members (3 to check), 6 guests. 2 rows skipped." */
export function previewSummary(n: { members: number; toCheck: number; guests: number; skipped: number }): string {
  const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const members = plural(n.members, "member", "members") + (n.toCheck > 0 ? ` (${n.toCheck} to check)` : "");
  const head = `${members}, ${plural(n.guests, "guest", "guests")}.`;
  return n.skipped > 0 ? `${head} ${plural(n.skipped, "row", "rows")} skipped.` : head;
}

/** The confirm button: "Import 24 players". */
export function importButtonWords(count: number): string {
  return `Import ${count} ${count === 1 ? "player" : "players"}`;
}
