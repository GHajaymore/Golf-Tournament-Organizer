import "server-only";
import { prisma } from "../db";
import { clubToday, clubWallClock } from "../domain/club-clock";
import { fieldChangeAllowed, fieldFactsOf, lateEntryRound, type FieldChange, type FieldFacts, type LastTeeTime } from "../domain/field-change";
import { roundDayOf } from "../domain/round-dates";
import { lastTeeTime, parseTeeSheet } from "../domain/tee-sheet";
import type { TournamentFacts } from "../domain/tournament-status";
import { zoneOfEvent } from "./club-clock";
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
  // ONE instant, read in the club's zone for both the day and the wall clock,
  // so "today" and "now" cannot straddle midnight between two reads.
  const zone = await zoneOfEvent(eventId);
  const at = new Date();
  const facts = await tournamentFactsFor(eventId, clubToday(zone, at));
  if (!facts) return null;
  return fieldFactsOf(facts, { lastTee: await lastTeeFor(facts), now: clubWallClock(zone, at) });
}

/**
 * THE LAST PUBLISHED STARTING TIME OF THE ROUND A LATE ENTRANT WOULD START IN
 * (`lateEntryRound`), or null. Only a PUBLISHED sheet counts — a draft is the
 * organizer's, not a time anybody has been given (Rule 5.3a). The round's day
 * is its own `playedOn`, or the tournament's first day for the first round
 * when the round was never dated on its own.
 */
async function lastTeeFor(facts: TournamentFacts): Promise<LastTeeTime | null> {
  const round = lateEntryRound(facts);
  if (!round) return null;
  const stage = await prisma.stage.findUnique({
    where: { id: round.id },
    select: { teeSheet: true, teeSheetPublished: true, playedOn: true },
  });
  if (!stage?.teeSheetPublished) return null;
  const sheet = parseTeeSheet(stage.teeSheet ?? "");
  const time = sheet ? lastTeeTime(sheet) : null;
  const day = roundDayOf(stage.playedOn, facts.startOn);
  // The round's own label, the same one `playedRound` is read by, so the two compare.
  return time && day ? { round: round.label, day, time } : null;
}

/** The refusal in a sentence, or null when the change may be made. */
export async function fieldRefusal(eventId: string, change: FieldChange): Promise<string | null> {
  const facts = await fieldFactsFor(eventId);
  if (!facts) return "This tournament could not be found.";
  const v = fieldChangeAllowed(facts, change);
  return v.ok ? null : v.says;
}
