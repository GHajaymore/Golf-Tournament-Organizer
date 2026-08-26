/**
 * Whether a side bet may be called this, and if not, WHY not.
 *
 * The two reasons are not the same reason, and telling somebody the wrong one
 * sends them looking for a thing that does not exist. Naming a bet after a
 * fourball used to produce "there is already a skins game called that" when no
 * such game existed; the truth was that the name already belonged to four
 * other players, which is also the ground the server refuses it on.
 *
 * A rule rather than a condition inside a component, because the SERVER
 * enforces the same thing — `requirePotAccess` answers a tee-sheet name by
 * membership alone — and two readers of one rule is the fault this codebase
 * keeps paying for. This one is the courtesy shown while somebody types; the
 * server's is the one that counts.
 */

export interface NameHold {
  name: string;
  /**
   * The game holding it, or `"*"` for a name reserved against EVERY game.
   *
   * A game is keyed on (round, kind, name), so the same crew running skins and
   * a birdie pot under one name is two rows that settle together rather than a
   * collision — refusing the second was the check being too strict.
   *
   * `"*"` is what a tee-sheet group name gets. An ad-hoc bet borrowing one
   * would resolve its audience to that fourball whatever game it is, and in
   * opt-out mode that charges them a stake they never agreed to.
   */
  kind: string;
}

/** What is holding this name, or null when it is free. */
export function nameHold(name: string, game: string, taken: NameHold[]): NameHold | null {
  const wanted = (name ?? "").trim().toLowerCase();
  // An empty name is not yet a clash. Reporting one while somebody has typed
  // nothing puts an error on a form nobody has filled in.
  if (!wanted) return null;

  return (
    taken.find(
      (held) => held.name.toLowerCase() === wanted && (held.kind === "*" || held.kind === game),
    ) ?? null
  );
}
