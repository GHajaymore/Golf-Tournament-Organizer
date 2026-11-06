/**
 * WHO MAY CHANGE THE FIELD, AND WHEN — the one rule (day-of field changes,
 * design of 6 Nov, PR A; `docs/one-rule-one-place.md`).
 *
 * Until this, launching locked the whole tournament with one blanket
 * (`configurationLocked`), reached through four spellings in the field actions
 * — an inline check, `assertUnlocked` (thrown), `lockedRefusal` (returned) and
 * the confirmed-draw check beside it — and the only way through was the
 * Organizer's Unlock. On the morning of play an Assistant could not record a
 * withdrawal at all, and an Organizer had to unlock the format, the rounds and
 * every handicap to write one name off the sheet.
 *
 * The office practice it now matches:
 *
 *   - A WITHDRAWAL is written on the sheet at any time before the results are
 *     final. The group goes out short at its starting time (Rule 5.3a); nobody
 *     is re-paired. The cards a player returned stay on the record (Rule
 *     3.3b(2), returning the scorecard), though a player who withdraws has no
 *     score and no place in the competition. In a match the opponent wins by
 *     the withdrawn player's concession (Rule 3.2b(1)) or failure to start
 *     (Rule 5.3a) — recorded by the committee as a walkover, never by the app.
 *     A withdrawal never reopens anything, so it is open in every family.
 *     "WD" and "DNS" are not in the Rules; they are the scoring office's codes
 *     (withdrew after starting; did not start).
 *   - PUTTING ONE BACK undoes a mistaken tap, on the same terms: an office
 *     error corrected, not a ruling (the spirit of Rule 20.2d), and refused
 *     once the competition is completed (Rule 20.2e: results are final).
 *   - A LATE ENTRY in stroke play or Stableford is a term of the competition
 *     (Committee Procedures, Section 5A); this rule closes it once any card is
 *     in, so that no new name lacks a score for a round already under way. In
 *     match play, a round robin, a knockout or a cup the draw IS the field, so
 *     nobody is added after launch. A league's field changes week to week by
 *     nature, so it keeps taking entries between weeks.
 *   - An UNPLACED player (a late entrant) may be placed in a prize division —
 *     stroke or Stableford, before play — without moving anybody else.
 *   - Moving a PLACED player between flights, editing a player's details and
 *     bulk imports or deletions are not day-of acts: they stay locked.
 *
 * Pure: no prisma, no clock. The facts are a subset of `TournamentFacts`
 * (`fieldFactsOf`), read by `tournamentFactsFor`, so the state machine's PR 5
 * can make `locks.field` the body of this function without a caller changing.
 * The server's door is `fieldRefusal` (services/field-change.ts); every field
 * action asks it, and the Entries screen draws its controls from `fieldDoors`.
 */
import { configurationLocked, isFinished, isLaunched } from "./lifecycle-state";
import { tournamentFamily, type Family, type TournamentFacts, type WayOut } from "./tournament-status";

export const FIELD_CHANGES = ["withdraw", "reinstate", "add", "approve", "place-in-flight", "edit", "bulk", "move-flight"] as const;
export type FieldChange = (typeof FIELD_CHANGES)[number];

export interface FieldFacts {
  /** Stored status: draft | registration | ready | live | completed. */
  status: string;
  /** Today's blanket Unlock. */
  configUnlocked: boolean;
  /** `tournamentFamily` — the machine's answer, not a second reading of it. */
  family: Family;
  /** The first round with a result ("Round 1"), or null when nobody has played. */
  playedRound: string | null;
  /** The Flights board's confirmed draw. */
  flightsConfirmed: boolean;
}

export type FieldVerdict = { ok: true } | { ok: false; says: string; wayOut: WayOut };

/** The families that take a late entry once launched (a casual round has its own limit of eight). */
export const LATE_ENTRY_FAMILIES: readonly Family[] = ["stroke", "stableford", "league", "casual"];
/** Families whose field keeps changing after play has begun. */
const LIVE_BY_NATURE: readonly Family[] = ["league", "casual"];
/** Families whose flights are prize divisions a late entrant may be placed in. */
const PRIZE_DIVISIONS: readonly Family[] = ["stroke", "stableford"];

const UNLOCK: WayOut = { says: "Unlock it on the dashboard", href: "/dashboard" };
const REOPEN: WayOut = { says: "Reopen it on the dashboard", href: "/dashboard" };
const REOPEN_DRAW: WayOut = { says: "Reopen the draw on Flights", href: "/grouping" };
const ONE_AT_A_TIME: WayOut = { says: "Withdraw players one at a time on Entries", href: "/registration" };

const OPEN: FieldVerdict = { ok: true };
const no = (says: string, wayOut: WayOut): FieldVerdict => ({ ok: false, says, wayOut });

/** The field facts of a tournament's facts — what `tournamentFactsFor` already reads. */
export function fieldFactsOf(f: TournamentFacts): FieldFacts {
  return {
    status: f.status,
    configUnlocked: f.configUnlocked,
    family: tournamentFamily(f),
    playedRound: f.rounds.find((r) => r.hasResult)?.label ?? null,
    flightsConfirmed: f.flightsConfirmed,
  };
}

/**
 * MAY THIS CHANGE BE MADE TO THE FIELD NOW. Questions in order: completed
 * refuses everything; a confirmed draw refuses a flight change; not launched,
 * or unlocked, allows (exactly the behaviour before this rule); otherwise the
 * day-of table above.
 */
export function fieldChangeAllowed(facts: FieldFacts, change: FieldChange): FieldVerdict {
  if (isFinished(facts.status)) {
    return no("The tournament is completed, so its field is as it finished. Reopen it to change the field.", REOPEN);
  }
  const locked = configurationLocked(facts);
  const flightChange = change === "place-in-flight" || change === "move-flight";
  if (flightChange && facts.flightsConfirmed) {
    return locked
      ? no("The draw is confirmed, so the flights are fixed. To change them, unlock the tournament.", UNLOCK)
      : no("Draw confirmed. Reopen it to move anyone.", REOPEN_DRAW);
  }
  if (!locked) return OPEN;

  const begun = facts.playedRound;
  switch (change) {
    case "withdraw":
    case "reinstate":
      return OPEN;
    case "add":
    case "approve":
      if (!LATE_ENTRY_FAMILIES.includes(facts.family)) {
        return facts.family === "teamCup"
          ? no("The sides are picked, so the field is fixed. To change it, unlock the tournament.", UNLOCK)
          : no("The draw is made, so the field is fixed. To change it, unlock the tournament.", UNLOCK);
      }
      if (begun && !LIVE_BY_NATURE.includes(facts.family)) {
        return no(`${begun} has begun, so a new entry would have no score for it. To add someone anyway, unlock the tournament.`, UNLOCK);
      }
      return OPEN;
    case "place-in-flight":
      if (!PRIZE_DIVISIONS.includes(facts.family)) {
        return no("Flights are fixed once the tournament is launched. To place a player, unlock the tournament.", UNLOCK);
      }
      if (begun) return no(`${begun} has begun, so the flights are fixed. To place a player, unlock the tournament.`, UNLOCK);
      return OPEN;
    case "move-flight":
      return no("Flights are fixed once the tournament is launched. To move a player, unlock the tournament.", UNLOCK);
    case "edit":
      return no("A player’s details are locked once the tournament is launched. To correct one, unlock the tournament.", UNLOCK);
    case "bulk":
      return no(
        "Importing a list or removing several players at once is locked once the tournament is launched. Withdraw players one at a time, or unlock the tournament.",
        ONE_AT_A_TIME,
      );
  }
}

/** Every change's refusal as a sentence, or null where it is open — what the Entries screen draws from. */
export function fieldDoors(facts: FieldFacts): Record<FieldChange, string | null> {
  return Object.fromEntries(
    FIELD_CHANGES.map((c) => {
      const v = fieldChangeAllowed(facts, c);
      return [c, v.ok ? null : v.says];
    }),
  ) as Record<FieldChange, string | null>;
}

/**
 * The Entries banner while the tournament is under way (launched, locked, not
 * completed), in place of "Setup locked"; null otherwise. Built from the
 * verdicts, so it never promises an add the rule refuses.
 */
export function fieldBanner(facts: FieldFacts): string | null {
  if (!isLaunched(facts.status) || isFinished(facts.status) || !configurationLocked(facts)) return null;
  const add = fieldChangeAllowed(facts, "add");
  return add.ok
    ? "The tournament is under way. You can withdraw a player, put one back or add a late entry; the waiting list moves up by itself. The format, rounds and players’ details stay locked."
    : `The tournament is under way. You can withdraw a player or put one back. ${add.says}`;
}
