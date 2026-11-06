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
 *     once the competition is completed (Rule 20.2e: results are final). Put
 *     back after a walkover has been awarded against the player is the
 *     COMMITTEE'S CALL: the app returns them to the field and leaves the
 *     recorded walkover exactly as it stands; whether the match is replayed or
 *     the walkover kept is a ruling, made and recorded on Score entry or the
 *     Bracket by the committee, never by Put back.
 *   - A LATE ENTRY in stroke play or Stableford is a term of the competition
 *     (Committee Procedures, Section 5A). It closes when the late entrant could
 *     no longer play every round: at the LAST PUBLISHED STARTING TIME of the
 *     round they would start in — Round 1, the field's first round — on that
 *     round's day, by the club's own clock (the panel, PR B; `lateEntryClosed`).
 *     Until then a walk-in can still be written into a group that has room,
 *     even with the early groups' cards coming in. With no published sheet
 *     there is no starting time to hold it to, and it closes at the FIRST CARD
 *     of any round (PR A's rule). After either, a walk-in needs an Organizer to
 *     unlock the tournament. In
 *     match play, a round robin, a knockout or a cup the draw IS the field, so
 *     nobody is added after launch. A league's field changes week to week by
 *     nature, so it keeps taking entries between weeks.
 *   - An UNPLACED player (a late entrant) may be placed in a prize division —
 *     stroke or Stableford, while late entries are open, confirmed draw or
 *     not — without moving anybody else.
 *   - PUTTING ONE UNDRAWN PLAYER IN A TEE-SHEET GROUP with room (PR B) moves
 *     nobody and changes no one's time: the office writes a late entry or a
 *     reserve into a group (Rule 5.3a, the starting time is the group's). Open
 *     in every family until the competition is completed; the room in the
 *     group is `placeInGroup`'s (domain/tee-sheet.ts).
 *   - Moving a PLACED player between flights, editing a player's details and
 *     bulk imports or deletions are not day-of acts: they stay locked.
 *
 * Pure: no prisma, no clock. The facts are a subset of `TournamentFacts`
 * (`fieldFactsOf`), read by `tournamentFactsFor`, so the state machine's PR 5
 * can make `locks.field` the body of this function without a caller changing.
 * The club's wall clock arrives in the facts (`clubWallClock`, read once by the
 * server's door), never from this machine.
 * The server's door is `fieldRefusal` (services/field-change.ts); every field
 * action asks it, and the Entries screen draws its controls from `fieldDoors`.
 */
import { configurationLocked, isFinished, isLaunched } from "./lifecycle-state";
import { minutesOfTeeTime } from "./tee-sheet";
import { tournamentFamily, type Family, type RoundFacts, type TournamentFacts, type WayOut } from "./tournament-status";

export const FIELD_CHANGES = ["withdraw", "reinstate", "add", "approve", "place-in-flight", "place-in-group", "edit", "bulk", "move-flight"] as const;
export type FieldChange = (typeof FIELD_CHANGES)[number];

/**
 * THE LAST PUBLISHED STARTING TIME of the round a late entrant would start in
 * (`lateEntryRound`): its label, its day (yyyy-mm-dd, a calendar day at the
 * club) and the time as the sheet writes it ("10:40 AM"). Null when that round
 * has no published sheet, no day, or no time that can be read.
 */
export interface LastTeeTime {
  round: string;
  day: string;
  time: string;
}

/** The club's wall clock now (`clubWallClock`): its day and the minutes past midnight there. */
export interface ClubWallClock {
  day: string;
  minutes: number;
}

/** What the server's door reads beside the tournament's facts: the sheet's last time and the club's clock. */
export interface FieldClock {
  lastTee: LastTeeTime | null;
  now: ClubWallClock;
}

export interface FieldFacts extends FieldClock {
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

/**
 * The field facts of a tournament's facts — what `tournamentFactsFor` already
 * reads — and the clock beside them. The clock is REQUIRED, so every caller is
 * listed by the compiler the day the rule asks the time.
 */
export function fieldFactsOf(f: TournamentFacts, clock: FieldClock): FieldFacts {
  return {
    status: f.status,
    configUnlocked: f.configUnlocked,
    family: tournamentFamily(f),
    playedRound: f.rounds.find((r) => r.hasResult)?.label ?? null,
    flightsConfirmed: f.flightsConfirmed,
    lastTee: clock.lastTee,
    now: clock.now,
  };
}

/**
 * THE ROUND A LATE ENTRANT WOULD START IN: the field's first round. In a
 * multi-round stroke competition a name added after it would have no score for
 * a round already played (design of 6 Nov, section 1), so it is the round whose
 * last starting time closes late entries — never a later one.
 */
export function lateEntryRound(f: TournamentFacts): RoundFacts | null {
  return f.rounds.find((r) => r.playing) ?? null;
}

/**
 * WHY LATE ENTRIES ARE CLOSED, as the start of a sentence, or null while they
 * are open (the panel's cutoff, PR B):
 *
 *   - with a published sheet for the first round: closed once the club's clock
 *     reaches its last starting time on its day (a later day, closed);
 *   - a result in any OTHER round closes it whatever the sheet says;
 *   - with no published sheet: closed at the first card (PR A).
 *
 * A wall-clock time is compared with the club's wall clock on the same day,
 * never an instant with a day.
 */
export function lateEntryClosed(f: FieldFacts): { tee: LastTeeTime } | { card: string } | null {
  const t = f.lastTee;
  const at = t ? minutesOfTeeTime(t.time) : null;
  if (t && at !== null && (f.playedRound === null || f.playedRound === t.round)) {
    const passed = f.now.day > t.day || (f.now.day === t.day && f.now.minutes >= at);
    return passed ? { tee: t } : null;
  }
  return f.playedRound ? { card: f.playedRound } : null;
}

/**
 * THE CLOSED WINDOW IN WORDS, for a late entry ("add") or a flight for one
 * ("place"). The tee-time refusal is three short sentences, each read at a
 * glance (panel review of #1029, must-fix 4): what is closed, why, and who can
 * open it. The first-card refusal keeps PR A's words.
 */
function closedWords(c: { tee: LastTeeTime } | { card: string }, what: "add" | "place"): string {
  if ("tee" in c) {
    const why = `${c.tee.round}’s last tee time (${c.tee.time}) has passed.`;
    return what === "add"
      ? `Late entries are closed. ${why} To add someone, an Organizer can unlock it on the dashboard.`
      : `Flights are fixed. ${why} To place someone, an Organizer can unlock it on the dashboard.`;
  }
  return what === "add"
    ? `The first card of ${c.card} is in, so late entries are closed. ${byOrganizer("add someone anyway")}`
    : `The first card of ${c.card} is in, so the flights are fixed. ${byOrganizer("place a player")}`;
}

/**
 * MAY THIS CHANGE BE MADE TO THE FIELD NOW. Questions in order: completed
 * refuses everything; a confirmed draw refuses a move (and a placement where
 * flights make the pairings); not launched,
 * or unlocked, allows (exactly the behaviour before this rule); otherwise the
 * day-of table above.
 */
export function fieldChangeAllowed(facts: FieldFacts, change: FieldChange): FieldVerdict {
  if (isFinished(facts.status)) {
    return no("The tournament is completed, so its field is as it finished. An Organizer can reopen it on the dashboard.", REOPEN);
  }
  const locked = configurationLocked(facts);
  /**
   * A CONFIRMED DRAW MOVES NOBODY — and placing an UNPLACED player in a prize
   * division moves nobody either (panel review of #1028, must-fix 1). So in
   * stroke play and Stableford the confirmed draw is asked of a move only;
   * refusing the placement would send the desk back to the blanket Unlock this
   * rule exists to retire. Where flights decide who plays whom (a round robin,
   * a cup), placing someone changes the pairings, so the draw still holds it.
   */
  const drawHolds = change === "move-flight" || (change === "place-in-flight" && !PRIZE_DIVISIONS.includes(facts.family));
  if (drawHolds && facts.flightsConfirmed) {
    return locked
      ? no(`The draw is confirmed, so the flights are fixed. ${byOrganizer("change them")}`, UNLOCK)
      : no("Draw confirmed. Reopen it to move anyone.", REOPEN_DRAW);
  }
  if (!locked) return OPEN;

  const closed = lateEntryClosed(facts);
  switch (change) {
    case "withdraw":
    case "reinstate":
    case "place-in-group": // into a group with room on the tee sheet: nobody moves, no time changes
      return OPEN;
    case "add":
    case "approve":
      if (!LATE_ENTRY_FAMILIES.includes(facts.family)) {
        return facts.family === "teamCup"
          ? no(`The sides are picked, so the field is fixed. ${byOrganizer("change it")}`, UNLOCK)
          : no(`The draw is made, so the field is fixed. ${byOrganizer("change it")}`, UNLOCK);
      }
      if (closed && !LIVE_BY_NATURE.includes(facts.family)) return no(closedWords(closed, "add"), UNLOCK);
      return OPEN;
    case "place-in-flight":
      if (!PRIZE_DIVISIONS.includes(facts.family)) {
        return no(`Flights are fixed once the tournament is launched. ${byOrganizer("place a player")}`, UNLOCK);
      }
      // The same window as a late entry: a walk-in taken before the last tee time is placed in one.
      if (closed) return no(closedWords(closed, "place"), UNLOCK);
      return OPEN;
    case "move-flight":
      return no(`Flights are fixed once the tournament is launched. ${byOrganizer("move a player")}`, UNLOCK);
    case "edit":
      return no(`A player’s details are locked once the tournament is launched. ${byOrganizer("correct one")}`, UNLOCK);
    case "bulk":
      return no(
        "Importing a list or removing several players at once is locked once the tournament is launched. Withdraw players one at a time, or ask an Organizer to unlock the tournament on the dashboard.",
        ONE_AT_A_TIME,
      );
  }
}

/**
 * WHO CAN UNLOCK, AND WHERE (panel review of #1028, must-fix 2). Only the
 * primary Organizer can unlock (`setConfigUnlocked` is admin-only), and on the
 * morning the person reading a refusal is as likely to be an Assistant — so
 * every refusal that ends in Unlock names who can, in words true for both
 * readers, and the place the guide names ("Unlock it on the dashboard").
 */
function byOrganizer(act: string): string {
  return `To ${act}, an Organizer can unlock the tournament on the dashboard.`;
}

/**
 * HOW THE RESULTS LIST A WITHDRAWN PLAYER (PR B), said after the withdrawal:
 * WD for one who had begun, DNS for one who had not. Office codes, not Rules terms.
 */
export function resultsLine(name: string, begun: boolean): string {
  return begun ? `The results list ${name} as WD.` : `The results list ${name} as DNS: they had not teed off.`;
}

/** The question before a withdrawal under way, in short sentences (panel review of #1029, must-fix 4). */
export function withdrawConfirmation(name: string): string {
  return `Withdraw ${name}? They come off the tee sheet and the board. The results show WD if they began, DNS if not. Their scores and side-game entries stay on the record. You can put them back.`;
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
export function fieldBanner(facts: FieldFacts): string[] | null {
  if (!isLaunched(facts.status) || isFinished(facts.status) || !configurationLocked(facts)) return null;
  const add = fieldChangeAllowed(facts, "add");
  // Two short lines under the title "Under way" (panel review of #1028): what is open, then what is not.
  // And, where a published sheet sets it, when late entries close (PR B) — the time the desk works to.
  const t = facts.lastTee;
  const closes = t && !LIVE_BY_NATURE.includes(facts.family) ? [`Late entries close at ${t.round}’s last tee time, ${t.time}.`] : [];
  return add.ok
    ? ["You can withdraw a player, put one back or add a late entry.", ...closes, "The format, rounds and players’ details stay locked."]
    : ["You can withdraw a player or put one back.", add.says];
}
