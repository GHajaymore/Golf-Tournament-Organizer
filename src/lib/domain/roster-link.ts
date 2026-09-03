/**
 * Which of the field is actually on the club roster.
 *
 * The Members screen counted roster members flagged as entered and labelled it
 * "In Demo Cup". Both halves were true on their own and the pair was a lie: a
 * club whose field was built before it had a roster saw "0 entered in the open
 * tournament" beside a Registration screen reporting thirty-two confirmed. The
 * number was answering "how many of my members are playing", and reading as
 * "how many people are playing".
 *
 * The honest number needs both sides, so this works out who is in the field
 * but not on the roster — which is also exactly the list needed to fix it.
 *
 * Ways a player ends up unlinked, none of them a mistake:
 *   - the field was imported or typed in before the club had a roster
 *   - placeholder entries added by resizing a field to a round number
 *   - anything created before the roster feature existed
 */

export interface PlayerRef {
  id: string;
  name: string;
  email: string;
  /** The roster member this entry was created from, when it was. */
  memberId?: string | null;
}

export interface MemberRef {
  id: string;
  email: string;
}

const key = (email: string) => email.trim().toLowerCase();

/**
 * Players in the field with no roster member behind them.
 *
 * Matched by member id first and by email second — the same two-step the
 * pickers use, so a player entered before the roster existed still counts as
 * linked once a member with their address is added, without anyone having to
 * repair the id.
 *
 * A player with no email and no memberId can only ever be unlinked: there is
 * nothing to match them on. That is the right answer rather than a gap in the
 * matching — they are a name in a draw and nothing else, which is precisely
 * what needs saying.
 */
export function unlinkedPlayers<T extends PlayerRef>(players: T[], members: MemberRef[]): T[] {
  const ids = new Set(members.map((m) => m.id));
  const emails = new Set(members.map((m) => key(m.email)).filter(Boolean));
  return players.filter((p) => {
    if (p.memberId && ids.has(p.memberId)) return false;
    const e = key(p.email);
    return !(e && emails.has(e));
  });
}

/** Where a roster member stands in the tournament currently open. */
export type EntryStatus = "in" | "waitlisted" | "pending" | "out";

/** One entry row, as much of it as this decision needs. */
export interface EntryRow {
  memberId: string | null;
  email: string;
  status: string;
}

export interface MemberEntry {
  status: EntryStatus;
  /**
   * Whether adding this member again would duplicate a LIVE entry.
   *
   * True for a place, a queue place and an unapproved request alike — all
   * three are entries somebody already has. False for a withdrawn one, which
   * is not an entry: treating it as one greyed the member out of the picker
   * and left an organizer no way to re-enter somebody who pulled out and
   * changed their mind.
   */
  live: boolean;
}

const emailKey = (v: string) => v.trim().toLowerCase();

/** Whether this entry row is this member, by roster link or by address. */
function isSamePerson(member: { id: string; email: string }, row: EntryRow): boolean {
  if (row.memberId && row.memberId === member.id) return true;
  const key = emailKey(member.email);
  return !!key && emailKey(row.email) === key;
}

/**
 * What the roster screen should say about one member.
 *
 * The screen used to ask only "is there a Player row" and tag every answer
 * "in field". That is wrong for three of the four statuses: a WAITLISTED
 * member has no place, a PENDING one has asked and not been approved, and a
 * WITHDRAWN one has left. All three read as being in the tournament, and the
 * organizer standing on this page is deciding who to add.
 *
 * Ordered deliberately. A member can hold more than one row across a
 * tournament's life — withdrawn in the morning, re-entered in the afternoon —
 * so the strongest live claim wins rather than whichever row came back first.
 */
export function memberEntryFor(
  member: { id: string; email: string },
  entries: EntryRow[],
): MemberEntry {
  const mine = entries.filter((row) => isSamePerson(member, row));
  const has = (status: string) => mine.some((row) => row.status === status);
  const live = mine.some((row) => row.status !== "withdrawn");
  if (has("confirmed")) return { status: "in", live };
  if (has("waitlisted")) return { status: "waitlisted", live };
  if (has("pending")) return { status: "pending", live };
  return { status: "out", live };
}

/**
 * The FIELD: confirmed entries, and nothing else.
 *
 * This was every row whatever its status, so a tournament with thirty players
 * and five withdrawn or unapproved reported thirty-five — while Registration,
 * one tab away, said thirty, and both were badged green.
 */
export function fieldSizeOf(entries: EntryRow[]): number {
  return entries.filter((row) => row.status === "confirmed").length;
}

export interface FieldRosterSummary {
  /** Everyone in the field, entered and waitlisted. */
  fieldSize: number;
  /** How many of them are on the roster. */
  linked: number;
  /** How many are not. */
  unlinked: number;
  /** The caption under the count, or "" when there is nothing to explain. */
  note: string;
}

export function fieldRosterSummary(fieldSize: number, unlinked: number): FieldRosterSummary {
  const linked = Math.max(0, fieldSize - unlinked);
  let note = "entered in the open tournament";
  if (fieldSize === 0) {
    note = "nobody entered yet";
  } else if (unlinked > 0) {
    // The sentence that resolves the contradiction. It names the gap rather
    // than leaving a bare 0 to be read as "nobody is playing".
    note =
      unlinked === fieldSize
        ? `none of the ${fieldSize} in the field are on the roster yet`
        : `${unlinked} more in the field ${unlinked === 1 ? "isn’t" : "aren’t"} on the roster yet`;
  }
  return { fieldSize, linked, unlinked, note };
}
