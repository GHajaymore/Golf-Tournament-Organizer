import "server-only";
import { fieldChangeAllowed, fieldFactsOf, type FieldChange, type FieldFacts } from "../domain/field-change";
import { todayForEvent } from "./club-clock";
import { tournamentFactsFor } from "./tournament-facts";

/**
 * THE SERVER'S DOOR TO THE ONE FIELD RULE (`domain/field-change.ts`).
 *
 * Every action that changes who is in the field asks this — `addSignup`,
 * `addMembersToEvent`, `removeSignup`, `removeSignups`, `approveSignup`,
 * `reinstateWithdrawn`, `placeInFlight`, `movePlayerToGroup`, `updateSignup`
 * and `importCsvSignups` — so a refusal has one spelling and the four lock
 * spellings those actions used (inline, `assertUnlocked`, `lockedRefusal`, the
 * confirmed-draw check) are gone from them. RETURNED, never thrown (state
 * machine J10): the person pressing is told something, and a production build
 * blanks a thrown message anyway.
 *
 * Here and not in `action-shared.ts`, where the design put it: the facts reader
 * builds the tournament's whole state (the event state, a cup's board), and
 * `action-shared` is the small module the services themselves import
 * (`waitlist`, `stroke-cut`, `group-keeping`) — putting the heavy reader inside
 * the light one would hand each of them the whole state builder and an import
 * cycle waiting to happen. The facts are the state machine's own
 * (`tournamentFactsFor`), told
 * the club's day, never the server's.
 */
export async function fieldFactsFor(eventId: string): Promise<FieldFacts | null> {
  const facts = await tournamentFactsFor(eventId, await todayForEvent(eventId));
  return facts ? fieldFactsOf(facts) : null;
}

/** The refusal in a sentence, or null when the change may be made. */
export async function fieldRefusal(eventId: string, change: FieldChange): Promise<string | null> {
  const facts = await fieldFactsFor(eventId);
  if (!facts) return "This tournament could not be found.";
  const v = fieldChangeAllowed(facts, change);
  return v.ok ? null : v.says;
}
