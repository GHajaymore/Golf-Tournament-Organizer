import { parseTeeSheet } from "./tee-sheet";

/**
 * Who a pot is OFFERED to — which is not the same as who is in it.
 *
 * `potMembership` answers "who is in", from the audience and each player's own
 * decision. This answers the question before it, and in OPT-OUT mode the two
 * collapse: the audience IS the membership, because nobody has to tick
 * anything. Get this wrong there and a fourball's £5 birdie pot enters every
 * player in the tournament and charges each of them a stake they never agreed
 * to — money appearing in a stranger's settle-up.
 *
 * The club's game is offered to the field. A group's game is offered to the
 * players in that group, read from the round's published tee sheet, because
 * the sheet is the only record of who is playing with whom.
 *
 * Two deliberate fallbacks, both to the field rather than to nobody:
 *
 *  - a groupKey naming no group on the sheet — a redraw renamed them, or the
 *    key is an ad-hoc bet rather than a fourball;
 *  - a group whose players are all gone from the confirmed field.
 *
 * Stranding a pot is the worse failure of the two. A pot has to settle to
 * somebody or the ledger does not balance, and money nobody can reach is worse
 * than money reaching too many people — the second is visible and arguable,
 * the first just disappears.
 */
export function potAudience(
  groupKey: string,
  teeSheetJson: string,
  fieldIds: string[],
): string[] {
  const key = (groupKey ?? "").trim();
  if (!key) return fieldIds;

  const group = parseTeeSheet(teeSheetJson ?? "")?.groups.find((g) => g.name === key);
  if (!group) return fieldIds;

  // Narrowed to the confirmed field, so a name left on a stale sheet — a
  // player who withdrew after it was published — cannot be staked in a bet.
  const inField = new Set(fieldIds);
  const members = group.playerIds.filter((id) => inField.has(id));
  return members.length > 0 ? members : fieldIds;
}
