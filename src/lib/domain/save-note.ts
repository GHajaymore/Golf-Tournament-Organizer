/**
 * How long "Saved." is allowed to stay on the screen.
 *
 * The console's stroke-play entry screen kept it in a plain string, set when a
 * save returned and never cleared again — not when the scorer picked a
 * different player, not when they typed another score. It renders inside the
 * footer line immediately after "18/18 holes", which is exactly where somebody
 * reads "this card is in".
 *
 * The sequence that loses a round is the ordinary one for a fourball. Save the
 * first player. Pick the second. Type their eighteen holes. The footer then
 * reads
 *
 *     Front 37 · Back 37 · 18/18 holes · Saved.
 *
 * over a card the server has never seen — under `scoreEntryWindow: "after"`
 * the screen holds a partial card on the device, and the note is left over
 * from the previous player. Walk away and that round is gone.
 *
 * Found exactly that way on 2026-09-11, walking a two-player round: the second
 * card read Saved, and the database held one scorecard.
 *
 * DERIVED, NOT CLEARED, and that is the whole point of it being here. There
 * are five places in that component that mutate the cards; clearing the note
 * in each is a rule a sixth can forget. This asks instead whether anything has
 * changed since the save the note describes, so a caller written later is
 * correct without knowing the rule exists — the same shape `standingRows` uses
 * to make a manual format safe at the sink.
 */

export interface SavedNote {
  /** What to say, already worded by the caller. */
  text: string;
  /**
   * Every card as it stood when the save was sent, serialised.
   *
   * The WHOLE set rather than the visible one, because the hole-by-hole view
   * saves each player in the tee group at once: a note about four cards has to
   * stop being shown the moment any of the four is edited, not only the one on
   * screen.
   */
  cards: string;
  /** Who was on screen when it was sent. */
  playerId: string;
}

/**
 * The note to render, or "" when it would no longer be true.
 *
 * Both halves matter and they fail differently. A changed card means the save
 * described something else — the dangerous case, and the one that loses a
 * round. A changed player means the save was about a card the reader is no
 * longer looking at, which is merely wrong rather than costly, and is the one
 * that made the first case so easy to believe.
 */
export function visibleSaveNote(
  saved: SavedNote | null | undefined,
  cards: string,
  playerId: string,
): string {
  if (!saved) return "";
  if (saved.cards !== cards) return "";
  if (saved.playerId !== playerId) return "";
  return saved.text;
}
