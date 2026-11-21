import type { BracketMode } from "./bracket";

/**
 * WHAT A NEW EVENT STARTS WITH, in one place (redesign design 2.4).
 *
 * The column default is the legacy reading; a new row's value is this. The
 * schema's `Event.bracketMode` default is "split", which is what every event
 * made before this existed holds and must keep reading as. A NEW event is
 * written with the value below by every place that creates one (a tournament,
 * its copy, a casual round, the demo club), and
 * `every-event-create-says-its-defaults` refuses a create that forgets.
 *
 * ONE BRACKET, which is what a club knockout is (2026-09-28, left to my
 * recommendation). The schema's "split" divides the qualifiers into a main
 * draw and a consolation before anybody has played: right for a society's
 * two-tier day, surprising as the default for a club's match-play
 * championship. Changeable on Bracket until it is played.
 *
 * No argument yet: the next field that depends on the event's shape adds it.
 */
export function newEventDefaults(): { bracketMode: BracketMode } {
  return { bracketMode: "single" };
}
