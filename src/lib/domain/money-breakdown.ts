/**
 * The part of a player's pot money that nothing on the screen accounts for.
 *
 * `gameNets` settles from THREE tables — the skins pot, side games and
 * contests — and their sum is the single `gamesCents` figure a player sees.
 * Only CONTESTS carry a per-player figure. The score pots are listed without
 * saying what they did for you, and **the skins pot is not in the player app at
 * all** — so part of a real number had no line explaining it, on the screen
 * whose own comment says:
 *
 *   > A total a player cannot expand is a number they have to take on trust,
 *   > and this is the screen that can least afford one.
 *
 * Derived by SUBTRACTION rather than by querying the skins pot again, and that
 * is deliberate. `services/expenses.ts` says it outright: "a second
 * implementation of the skins arithmetic living inside a money screen is
 * exactly the drift this app has been burned by, and this one would drift
 * about what somebody owes." The remainder cannot disagree with the total,
 * because it is defined as the total minus what is shown.
 *
 * It is labelled "and other pots" rather than "skins" for the same reason. If a
 * fourth pot table is ever added to `gameNets` without being itemised, its
 * money lands here — visible and slightly vaguely named, rather than silently
 * absorbed into a figure nobody can question. `hasMoneyGames` carries a comment
 * about exactly that fourth-table mistake.
 */

/**
 * Zero when everything is accounted for, so a caller can hide the row.
 *
 * Cents in, cents out — no rounding, because every input is already an integer
 * number of cents and inventing a tolerance here would hide a real gap.
 */
export function unitemisedGames(gamesCents: number, itemised: number[]): number {
  return gamesCents - itemised.reduce((sum, c) => sum + c, 0);
}
