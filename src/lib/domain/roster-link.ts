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
