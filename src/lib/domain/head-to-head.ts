/**
 * HEAD-TO-HEAD — a member's record against each opponent they have met in a
 * match, across every tournament the club has run.
 *
 * The unit is a MEETING: two members, one decided match, one result. What a
 * meeting's result IS is not decided here — the service hands over outcomes
 * read through the same resolver each tournament's own table used
 * (`decidedOutcome`, and the knockout's recorded winner), so a record can never
 * disagree with the table a meeting was part of. This file only counts.
 *
 * Individual meetings only: a four-ball between sides is a partnership's result
 * and not a meeting between two people. An opponent with no member record — a
 * guest entered by name — cannot be followed from one tournament to the next,
 * so they are left out rather than matched by name.
 */

export interface Meeting {
  eventId: string;
  eventName: string;
  /** "Round 2", "Semi-final" — where in the tournament it happened. */
  where: string;
  /** ISO date if known, else "". Newest first when sorted. */
  date: string;
  /** Member ids of the two players. */
  a: string;
  b: string;
  /** The winning member id, or null for a halved match. */
  winner: string | null;
  /** "3&2", "1 UP", "AS", "conceded" — as recorded. */
  margin: string;
}

export interface OpponentRecord {
  opponentId: string;
  won: number;
  lost: number;
  halved: number;
  /** This member's meetings with that opponent, newest first. */
  meetings: Meeting[];
}

/** One member's record against each opponent, most-played opponent first. */
export function recordAgainst(memberId: string, meetings: readonly Meeting[]): OpponentRecord[] {
  const byOpp = new Map<string, OpponentRecord>();
  for (const m of meetings) {
    if (m.a !== memberId && m.b !== memberId) continue;
    const opp = m.a === memberId ? m.b : m.a;
    if (!opp || opp === memberId) continue;
    const rec = byOpp.get(opp) ?? { opponentId: opp, won: 0, lost: 0, halved: 0, meetings: [] };
    if (m.winner === null) rec.halved += 1;
    else if (m.winner === memberId) rec.won += 1;
    else if (m.winner === opp) rec.lost += 1;
    else continue; // a winner who is neither — never count a meeting we cannot read
    rec.meetings.push(m);
    byOpp.set(opp, rec);
  }
  const out = [...byOpp.values()];
  for (const r of out) r.meetings.sort((x, y) => y.date.localeCompare(x.date));
  return out.sort(
    (x, y) =>
      y.won + y.lost + y.halved - (x.won + x.lost + x.halved) ||
      (y.meetings[0]?.date ?? "").localeCompare(x.meetings[0]?.date ?? ""),
  );
}

/** "Won 2 · Lost 1 · Halved 1" — every figure said, none implied. */
export function recordLine(r: Pick<OpponentRecord, "won" | "lost" | "halved">): string {
  const parts = [`Won ${r.won}`, `Lost ${r.lost}`];
  if (r.halved) parts.push(`Halved ${r.halved}`);
  return parts.join(" · ");
}

/**
 * The same said TO the player, for their own card: "you lead 2–1, 1 halved.
 * Last time: won 3&2 in the Summer Matchplay."
 */
export function yourHistory(r: OpponentRecord, currentEventId = ""): string {
  const lead = r.won > r.lost ? `you lead ${r.won}–${r.lost}` : r.won < r.lost ? `you trail ${r.won}–${r.lost}` : `all square ${r.won}–${r.lost}`;
  const halved = r.halved ? `, ${r.halved} halved` : "";
  const last = r.meetings[0];
  if (!last) return `You've met before: ${lead}${halved}.`;
  const how = last.winner === null ? "halved" : last.winner === r.opponentId ? "lost" : "won";
  const margin = last.margin && last.margin !== "AS" ? ` ${last.margin}` : "";
  // Met earlier in THIS tournament (a group stage before the knockout): say
  // where in it, not its name back to the player standing in it.
  const place = last.eventId === currentEventId && last.where ? `${last.where} of this one` : last.eventName;
  return `You've met before: ${lead}${halved}. Last time: ${how}${margin} in ${place}.`;
}

/** "Leads 2–1", "Trails 0–1", "All square 1–1" — the golfer's summary of it. */
export function recordVerdict(r: Pick<OpponentRecord, "won" | "lost">): string {
  if (r.won > r.lost) return `Leads ${r.won}–${r.lost}`;
  if (r.won < r.lost) return `Trails ${r.won}–${r.lost}`;
  return `All square ${r.won}–${r.lost}`;
}
