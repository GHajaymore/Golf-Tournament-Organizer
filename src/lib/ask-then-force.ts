/**
 * A CHANGE THE SERVER ASKS ABOUT FIRST — a tee change after play (J12, state
 * machine PR 7b). The action answers `needsConfirm` with its own words (the
 * Golf Pro's: "This changes a term of the competition after play. Every net
 * score in Round 2 (14 cards) is worked out again. …"); the person is asked
 * those words, and only a yes sends it again with `force`.
 *
 * For a select that has no room beside it for an inline warning: the tees of a
 * flight, of a player, of the tournament. Returns null when the person said no,
 * so the caller puts the control back to what is stored.
 */
export async function askThenForce<R extends { ok: boolean; needsConfirm?: boolean; says?: string }>(
  call: (force: boolean) => Promise<R>,
): Promise<R | null> {
  const first = await call(false);
  if (!first.needsConfirm) return first;
  if (!window.confirm(`${first.says ?? "This re-scores cards already entered."}\n\nChange it anyway?`)) return null;
  return call(true);
}
