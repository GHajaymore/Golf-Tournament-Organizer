/**
 * WHAT A FLIGHT IS CALLED, ON EVERY SCREEN (2026-10-08).
 *
 * A flight has a name. Generating flights stores "A", "B", … (`grouping.ts`),
 * and an organizer may rename one to whatever the club calls it —
 * "Championship", "Seniors", "Ladies" — through `renameGroup`. The Flights
 * screen showed that name. The leaderboard, the public board, the player's
 * own board, the dashboard's flight standings, Registration and Score entry
 * all printed "Flight 1", "Flight 2" by position instead, and messaging
 * printed "Flight " + the name. Four readers, three answers: a member in the
 * club's "Seniors" flight read "Flight 2" beside their name and had no way to
 * know that was them.
 *
 *   ""            → "Flight 1"    nothing set: the position, as before
 *   "A", "2", "AB" → "Flight A"   a bare letter or number is not a name on
 *                                its own — "A" in a column of names reads
 *                                as an initial
 *   "Seniors"     → "Seniors"    the club's own word, as it typed it
 *
 * `index` is the flight's place among the event's FLIGHTS (never a match
 * carrier — see `Group.isCarrier`), counted from 0.
 */
export function flightLabel(name: string | null | undefined, index: number): string {
  const n = (name ?? "").trim();
  if (!n) return `Flight ${index + 1}`;
  if (/^[A-Za-z0-9]{1,2}$/.test(n)) return `Flight ${n}`;
  return n;
}
