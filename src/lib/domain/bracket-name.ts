/**
 * WHAT THE BRACKET SCREEN IS CALLED, BY WHAT THE READER MAY DO THERE.
 *
 * `BracketClient` decided this for itself — `readOnly ? "Live bracket" :
 * "Bracket manager"` — which is right: an organizer opens a thing they drive
 * and a player opens a thing they watch, and one word should not claim both.
 *
 * The dashboard's tile linking to that screen did not ask. It said "Open
 * bracket manager" to everybody, so a player was offered a manager and landed
 * on a read-only board. Nothing was exposed — `/bracket` gates its controls on
 * `isStaff` and the h1 was already correct — but two screens named one
 * destination differently, and the one that ignored the role was the one doing
 * the inviting.
 *
 * Read off the demo on 2026-09-16, by diffing what each role is shown on the
 * screens both of them open.
 *
 * Here rather than in either file for the reason `board-copy.ts` exists: a name
 * used in two places is a name that drifts, and this one drifted the day it was
 * written down twice.
 */
export function bracketScreenName(readOnly: boolean): string {
  return readOnly ? "Live bracket" : "Bracket manager";
}
