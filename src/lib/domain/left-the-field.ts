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
