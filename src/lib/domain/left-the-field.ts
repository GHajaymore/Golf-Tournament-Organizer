/**
 * A PLAYER WHO LEFT THE FIELD — withdrew, or was disqualified by the committee.
 *
 * Neither is playing any more, and both can still owe or be owed: a stake taken
 * before they left stays in its pot (a disqualified player forfeits the entry,
 * which is the standard ruling), so the money screens must still find them by
 * name. A withdrawn player with no history is deleted rather than kept, so a
 * row in this state is somebody with something on the record.
 */
export function hasLeftTheField(status: string): boolean {
  return status === "withdrawn" || status === "disqualified";
}

/**
 * The same two statuses as a list, for a database query: `status: { notIn:
 * LEFT_THE_FIELD }` is "still in it", in whatever state.
 *
 * A dozen readers were written when withdrawing was the only way out, and
 * spelled this `status: { not: "withdrawn" }` — which a disqualified player
 * answers the wrong way round: counted as an entrant, priced into a side's
 * handicap, refused a share of a cost already spent (2026-10-10). One list, so
 * a third way out is added here and nowhere else.
 */
export const LEFT_THE_FIELD: string[] = ["withdrawn", "disqualified"];
