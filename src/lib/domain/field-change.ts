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
 *     make a committee correction TO THE FIELD (below). In
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
 *   - THE COMMITTEE CORRECTION IS THE WAY OUT (state machine PR 5b; panel
 *     review of 5b, must-fix 1). Every refusal here ends "an Organizer can make
 *     a committee correction to the field" (or "to the flights"), so a
 *     correction open on that scope (`TournamentFacts.correction`, one scope at
 *     a time, until Done or the club's midnight) OPENS exactly the changes that
 *     named it: the field's are a late entry, an approval, a player's details,
 *     a list, and a late entrant's placement in a prize division; the flights'
 *     are placing where flights make the pairings and moving a placed player —
 *     a confirmed draw included, since that refusal named it too. The TD's
 *     worst case was the desk locked out on the day, told of a way out that
 *     opened nothing.
 *
 * THE UPSTREAM-CHANGE RULES FOR THE FIELD AND FLIGHTS (J12, state machine PR
 * 7a; the panel's Q3 and its summary item 10). An edit is judged by what it
 * would INVALIDATE, and the answer is one of four: open, WARN (do it and say
 * what is left to do), RE-DRAW (do it, and say what was drawn again) or REFUSE
 * (a sentence with the way out). By family, for a late entrant:
 *
 *   - STROKE OR STABLEFORD with flights: taken, with a WARNING and the
 *     unplaced flag — "Sam is in the field but in no flight. Put them in one."
 *     (J04; until this only a cup flagged it). A flight is offered in the add
 *     form, never forced: one division is a complete setup (Golf Pro, Q1).
 *   - ROUND ROBIN IN FLIGHTS: a flight is REQUIRED with the entry. A player in
 *     no flight has no fixtures, so an unplaced round-robin player is a silent
 *     DNS. Taken with a flight, their matches against it are drawn
 *     (`repairPlayerPairings`) and the screen says so — the re-draw. A
 *     confirmed draw still holds the placement (panel review of #1028).
 *   - A KNOCKOUT ONCE ITS DRAW IS MADE: REFUSED, launched or not, with a
 *     reserve as the way out. The draw is made at the first knockout result
 *     (`recordBracketWinner` writes it down then; until it, the bracket
 *     re-seeds from the field) — a bracket has fixed places, and adding a name
 *     after the draw is how a bye is invented past round one (knockouts doc).
 *     After launch with no result yet, still refused (the draw is the field,
 *     as #1029 shipped), with the reserve and the field's correction.
 *     A RESERVE waits on the waiting list (`reserve`), and the waiting list
 *     asks this same rule before it moves anybody in.
 *
 * THE STEP is the J12 column the field stands in (`fieldStepOf`), derived from
 * the facts and never handed in beside them, so no caller can pass a step that
 * disagrees with the tournament. THE SCOPE is the part a correction opens
 * (`partOf`), returned with every verdict.
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
import { knockoutHasResults, tournamentFamily, type Family, type LockScope, type RoundFacts, type TournamentFacts, type WayOut } from "./tournament-status";

/**
 * The changes. `add-to-flight` is a late entry made WITH a flight (the add
 * form's flight); `reserve` puts a name on the waiting list on purpose — the
 * way out of a knockout whose draw is made.
 */
export const FIELD_CHANGES = ["withdraw", "reinstate", "add", "add-to-flight", "reserve", "approve", "place-in-flight", "place-in-group", "edit", "bulk", "move-flight"] as const;
export type FieldChange = (typeof FIELD_CHANGES)[number];

/**
 * THE J12 COLUMN THE FIELD STANDS IN (section 3 of the proposal), for the
 * field and flights rows:
 *
 *   before-draw   nothing is locked: before launch (or a legacy unlock), and —
 *                 for a knockout — no knockout result yet;
 *   after-draw    launched, and late entries still open (Round 1's last tee
 *                 time not reached, no card in); for a knockout, launched with
 *                 no result;
 *   after-scores  late entries closed (`lateEntryClosed`) — or, for a
 *                 knockout, its draw made by its first result, launched or not;
 *   completed     the results are final (Rule 20.2e).
 *
 * For the field, "the draw" is launch — the field is fixed at launch, as #1029
 * shipped — except in a knockout, whose draw is its first result.
 */
export const FIELD_STEPS = ["before-draw", "after-draw", "after-scores", "completed"] as const;
export type FieldStep = (typeof FIELD_STEPS)[number];

/** What a taken change leaves to say: the late entrant in no flight (J04), or a round robin's matches drawn for them. */
export type FieldWarn = "unplaced" | "matches-drawn";

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
  /**
   * The one scope a committee correction holds open (`TournamentFacts.correction`,
   * read off the row only while it stands), or null. REQUIRED, so no caller can
   * build the facts and forget the way out every refusal here names.
   */
  correction: { scope: LockScope } | null;
  /** `tournamentFamily` — the machine's answer, not a second reading of it. */
  family: Family;
  /** The first round with a result ("Round 1"), or null when nobody has played. */
  playedRound: string | null;
  /** The Flights board's confirmed draw. */
  flightsConfirmed: boolean;
  /** Flights made (not match carriers) — `TournamentFacts.groups`. A late entrant can be in no flight only where there are some (J04). */
  flights: number;
  /** A knockout round has a result: the knockout's draw is made (`knockoutHasResults`, the lock's own reading). */
  knockoutDrawn: boolean;
}

/**
 * The verdict, with the SCOPE asked (the part a correction must be opened on).
 * A taken change may carry a warning — what is left to do, said where the
 * press was, never silent.
 */
export type FieldVerdict =
  | { ok: true; scope: FieldPart; warn: FieldWarn | null }
  | { ok: false; scope: FieldPart; says: string; wayOut: WayOut };

/** The families that take a late entry once launched (a casual round has its own limit of eight). */
export const LATE_ENTRY_FAMILIES: readonly Family[] = ["stroke", "stableford", "league", "casual"];
/** Families whose field keeps changing after play has begun. */
const LIVE_BY_NATURE: readonly Family[] = ["league", "casual"];
/** Families whose flights are prize divisions a late entrant may be placed in. */
const PRIZE_DIVISIONS: readonly Family[] = ["stroke", "stableford"];
/** Families whose late entrant may be in no flight — and is then flagged (J04). A round robin's needs one with the entry. */
export const UNPLACED_FLAG_FAMILIES: readonly Family[] = ["stroke", "stableford", "roundRobinFlights"];
/** The knockouts: their draw is made at the first result. */
const KNOCKOUTS: readonly Family[] = ["knockout", "flightedKnockout"];
/** The changes that put somebody INTO the field — what a made knockout draw refuses. */
const ENTERS: readonly FieldChange[] = ["add", "add-to-flight", "approve"];

const UNLOCK: WayOut = { says: "Make a committee correction", href: "/dashboard" };
const REOPEN: WayOut = { says: "Reopen it on the dashboard", href: "/dashboard" };
const REOPEN_DRAW: WayOut = { says: "Reopen the draw on Flights", href: "/grouping" };
const ONE_AT_A_TIME: WayOut = { says: "Withdraw players one at a time on Entries", href: "/registration" };
/** A knockout's way out (panel Q3): the waiting list, from the add form on Entries. */
const RESERVE: WayOut = { says: "Add them as a reserve on Entries", href: "/registration" };
/** A round robin's: the add form's flight. */
const WITH_A_FLIGHT: WayOut = { says: "Choose their flight in the Add form on Entries", href: "/registration" };

/** A knockout whose draw is made: refused, the reserve first, then how to draw again. Each sentence twelve words or fewer. */
export const KNOCKOUT_DRAWN =
  "The draw is made, so nobody can join the knockout. Add them as a reserve: they wait on the waiting list. To draw it again, clear its results on the Bracket.";
/** A launched knockout with no result yet: the same, and the correction that would open the field. */
export const KNOCKOUT_LAUNCHED =
  "The draw is made, so nobody can join the knockout. Add them as a reserve: they wait on the waiting list. An Organizer can open the field with a committee correction.";
/** A round robin's late entry with no flight (panel Q3). */
export const ROUND_ROBIN_NEEDS_A_FLIGHT =
  "In a round robin, a late entrant needs a flight. Without one they have no matches. Choose their flight in the Add form.";
/** And an approval, which has no flight to give. */
export const ROUND_ROBIN_APPROVAL_NEEDS_A_FLIGHT =
  "In a round robin, a late entrant needs a flight. Approving cannot give one. Add them with a flight in the Add form instead.";

/**
 * The field facts of a tournament's facts — what `tournamentFactsFor` already
 * reads — and the clock beside them. The clock is REQUIRED, so every caller is
 * listed by the compiler the day the rule asks the time.
 */
export function fieldFactsOf(f: TournamentFacts, clock: FieldClock): FieldFacts {
  return {
    status: f.status,
    configUnlocked: f.configUnlocked,
    correction: f.correction ? { scope: f.correction.scope } : null,
    family: tournamentFamily(f),
    playedRound: f.rounds.find((r) => r.hasResult)?.label ?? null,
    flightsConfirmed: f.flightsConfirmed,
    flights: f.groups,
    knockoutDrawn: knockoutHasResults(f.rounds),
    lastTee: clock.lastTee,
    now: clock.now,
  };
}

/** The J12 column (see `FIELD_STEPS`), from the facts alone. */
export function fieldStepOf(f: FieldFacts): FieldStep {
  if (isFinished(f.status)) return "completed";
  if (KNOCKOUTS.includes(f.family)) {
    if (f.knockoutDrawn) return "after-scores";
    return configurationLocked(f) ? "after-draw" : "before-draw";
  }
  if (!configurationLocked(f)) return "before-draw";
  return lateEntryClosed(f) ? "after-scores" : "after-draw";
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
function closedWords(c: { tee: LastTeeTime } | { card: string }, what: "add" | "place", part: FieldPart = "field"): string {
  if ("tee" in c) {
    const why = `${c.tee.round}’s last tee time (${c.tee.time}) has passed.`;
    // Each sentence twelve words or fewer (`day-of-words-at-a-glance.test.ts`), and the part it opens named.
    return what === "add"
      ? `Late entries are closed. ${why} An Organizer can open the ${part} with a committee correction.`
      : `Flights are fixed. ${why} An Organizer can open the ${part} with a committee correction.`;
  }
  return what === "add"
    ? `The first card of ${c.card} is in, so late entries are closed. ${byOrganizer("add someone anyway", part)}`
    : `The first card of ${c.card} is in, so the flights are fixed. ${byOrganizer("place a player", part)}`;
}

/** The two scopes the field rule's changes fall under — the part a correction must be opened on. */
type FieldPart = Extract<LockScope, "field" | "flights">;

/**
 * WHICH PART A CORRECTION OPENS FOR A CHANGE. The field for a late entry, an
 * approval, a player's details and a list; the flights for placing where the
 * flights make the pairings and for moving a placed player. A late entrant's
 * placement in a PRIZE DIVISION is the field's: it is part of taking the late
 * entry, and its refusal names the field. A late entry made WITH a flight is
 * the field's in every family: it is an entry first. Withdraw, put back, put in
 * group and a reserve need no correction, and are the field's for the record.
 */
export function partOf(change: FieldChange, family: Family): FieldPart {
  switch (change) {
    case "move-flight":
      return "flights";
    case "place-in-flight":
      return PRIZE_DIVISIONS.includes(family) ? "field" : "flights";
    default:
      return "field";
  }
}

/**
 * MAY THIS CHANGE BE MADE TO THE FIELD NOW, AND IF NOT, WHAT IS THE WAY OUT —
 * the one rule for the J12 field and flights rows. The family, the step and
 * the scope are all asked: the family and the step from the facts
 * (`FieldFacts.family`, `fieldStepOf`), the scope from the change (`partOf`),
 * returned with the verdict. Questions in order:
 *
 *   1. completed refuses everything (Reopen is the remedy);
 *   2. a knockout whose draw is made refuses an entry, a correction included —
 *      the refusal names the reserve, never a correction, because no
 *      correction can give a made bracket a new place;
 *   3. a correction open on the change's part allows it (the way out every
 *      refusal below names, taken);
 *   4. a confirmed draw refuses a move, and a placement where flights make the
 *      pairings;
 *   5. before the draw (not launched, or a legacy unlock) everything else is
 *      open — exactly the behaviour before this rule;
 *   6. otherwise the day-of table and the panel's families (header).
 *
 * A taken late entry carries its warning (`warnFor`): the unplaced flag, or a
 * round robin's matches drawn.
 */
export function fieldChangeAllowed(facts: FieldFacts, change: FieldChange): FieldVerdict {
  const scope = partOf(change, facts.family);
  const step = fieldStepOf(facts);
  const no = (says: string, wayOut: WayOut): FieldVerdict => ({ ok: false, scope, says, wayOut });
  const yes = (): FieldVerdict => ({ ok: true, scope, warn: warnFor(facts, change, step) });

  if (step === "completed") {
    return no("The tournament is completed, so its field is as it finished. An Organizer can reopen it on the dashboard.", REOPEN);
  }
  const knockout = KNOCKOUTS.includes(facts.family);
  if (knockout && step === "after-scores" && ENTERS.includes(change)) return no(KNOCKOUT_DRAWN, RESERVE);

  const locked = configurationLocked(facts);
  /**
   * THE CORRECTION OPENS WHAT NAMED IT (panel review of 5b, must-fix 1). Only
   * while locked: before launch nothing is locked and none can be opened
   * (`openCorrection`); completed was refused above, where Reopen is the remedy
   * — the same two limits `locksOf` puts on `correctable`.
   */
  if (locked && facts.correction?.scope === scope) return yes();
  /**
   * A CONFIRMED DRAW MOVES NOBODY — and placing an UNPLACED player in a prize
   * division moves nobody either (panel review of #1028, must-fix 1). So in
   * stroke play and Stableford the confirmed draw is asked of a move only;
   * refusing the placement would send the desk back to the blanket Unlock this
   * rule exists to retire. Where flights decide who plays whom (a round robin,
   * a cup), placing someone changes the pairings, so the draw still holds it —
   * a late entry made with a flight included, which is a placement too.
   */
  const placing = change === "place-in-flight" || change === "add-to-flight";
  const drawHolds = change === "move-flight" || (placing && !PRIZE_DIVISIONS.includes(facts.family));
  if (drawHolds && facts.flightsConfirmed) {
    if (!locked) return no("Draw confirmed. Reopen it to move anyone.", REOPEN_DRAW);
    // A late entry is the field's (`partOf`): the correction it names is the one that opens it.
    return change === "add-to-flight"
      ? no("The draw is confirmed, so the flights are fixed. An Organizer can open the field with a committee correction.", UNLOCK)
      : no(`The draw is confirmed, so the flights are fixed. ${byOrganizer("change them", "flights")}`, UNLOCK);
  }
  if (!locked) return yes();

  const closed = lateEntryClosed(facts);
  switch (change) {
    case "withdraw":
    case "reinstate":
    case "place-in-group": // into a group with room on the tee sheet: nobody moves, no time changes
    case "reserve": // onto the waiting list: nobody enters the field, nothing drawn changes
      return yes();
    case "add":
    case "approve":
      // A launched knockout: its draw is the field (#1029), the reserve its way out (panel Q3).
      if (knockout) return no(KNOCKOUT_LAUNCHED, RESERVE);
      if (facts.family === "roundRobinFlights") {
        if (closed) return no(closedWords(closed, "add"), UNLOCK);
        return no(change === "add" ? ROUND_ROBIN_NEEDS_A_FLIGHT : ROUND_ROBIN_APPROVAL_NEEDS_A_FLIGHT, WITH_A_FLIGHT);
      }
      if (!LATE_ENTRY_FAMILIES.includes(facts.family)) {
        return facts.family === "teamCup"
          ? no(`The sides are picked, so the field is fixed. ${byOrganizer("change it", "field")}`, UNLOCK)
          : no(`The draw is made, so the field is fixed. ${byOrganizer("change it", "field")}`, UNLOCK);
      }
      if (closed && !LIVE_BY_NATURE.includes(facts.family)) return no(closedWords(closed, "add"), UNLOCK);
      return yes();
    case "add-to-flight": {
      // A round robin's late entry IS an entry with a flight: the window is its only question.
      if (facts.family === "roundRobinFlights") return closed ? no(closedWords(closed, "add"), UNLOCK) : yes();
      // Elsewhere it is an entry first, asked of the entry's rule (the field's, as this is).
      const add = fieldChangeAllowed(facts, "add");
      if (!add.ok) return add;
      // In a prize division, a placement too — the field's part there as well (`partOf`).
      if (PRIZE_DIVISIONS.includes(facts.family)) {
        const place = fieldChangeAllowed(facts, "place-in-flight");
        return place.ok ? yes() : place;
      }
      // A league or a casual round: its flights are not a late entrant's to join once launched.
      return no("Flights are fixed once the tournament is launched. Add them without a flight.", { says: "Add them without a flight", href: "/registration" });
    }
    case "place-in-flight":
      /**
       * A ROUND ROBIN'S UNPLACED PLAYER is placed as a late entrant is (J04's
       * "Put them in one"): their matches are drawn against the flight
       * (`repairPlayerPairings`), and nobody else moves. The same window.
       */
      if (!PRIZE_DIVISIONS.includes(facts.family) && facts.family !== "roundRobinFlights") {
        return no(`Flights are fixed once the tournament is launched. ${byOrganizer("place a player", "flights")}`, UNLOCK);
      }
      // The same window as a late entry: a walk-in taken before the last tee time is placed in one.
      if (closed) return no(closedWords(closed, "place", scope), UNLOCK);
      return yes();
    case "move-flight":
      return no(`Flights are fixed once the tournament is launched. ${byOrganizer("move a player", "flights")}`, UNLOCK);
    case "edit":
      return no(`A player’s details are locked once the tournament is launched. ${byOrganizer("correct one", "field")}`, UNLOCK);
    case "bulk":
      return no(
        "Importing a list or removing several players at once is locked once the tournament is launched. Withdraw players one at a time, or ask an Organizer to make a committee correction to the field on the dashboard.",
        ONE_AT_A_TIME,
      );
  }
}

/**
 * WHAT A TAKEN CHANGE LEAVES TO SAY. After the draw (launched): a late entrant
 * with no flight where flights exist and a flight is a choice — the unplaced
 * flag (J04); a round robin's late entrant given a flight — their matches drawn.
 * Before the draw the setup rail says it (the launch warning), so nothing here.
 */
function warnFor(f: FieldFacts, change: FieldChange, step: FieldStep): FieldWarn | null {
  if (step === "before-draw" || f.flights === 0) return null;
  if ((change === "add" || change === "approve") && UNPLACED_FLAG_FAMILIES.includes(f.family)) return "unplaced";
  if ((change === "add-to-flight" || change === "place-in-flight") && f.family === "roundRobinFlights") return "matches-drawn";
  return null;
}

/**
 * WHO CAN UNLOCK, AND WHERE (panel review of #1028, must-fix 2). Only the
 * primary Organizer can unlock (`setConfigUnlocked` is admin-only), and on the
 * morning the person reading a refusal is as likely to be an Assistant — so
 * every refusal that ends in Unlock names who can, in words true for both
 * readers, and the place the guide names ("Make a committee correction"). It
 * names the PART too (panel review of 5b): the dialog asks which part to open,
 * and a sentence that does not say sends the desk to guess.
 */
function byOrganizer(act: string, part: FieldPart): string {
  return `To ${act}, an Organizer can make a committee correction to the ${part} on the dashboard.`;
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
  // A correction open on the field: the banner's own line says who and why (`CorrectionOpenLine`); this says what it opened.
  if (facts.correction?.scope === "field") {
    return ["The field is open for a correction: late entries, players’ details and imports go through.", "The format and rounds stay locked."];
  }
  const add = fieldChangeAllowed(facts, "add");
  // Two short lines under the title "Under way" (panel review of #1028): what is open, then what is not.
  // And, where a published sheet sets it, when late entries close (PR B) — the time the desk works to.
  const t = facts.lastTee;
  const closes = t && !LIVE_BY_NATURE.includes(facts.family) ? [`Late entries close at ${t.round}’s last tee time, ${t.time}.`] : [];
  if (add.ok) return ["You can withdraw a player, put one back or add a late entry.", ...closes, "The format, rounds and players’ details stay locked."];
  // A round robin takes a late entry WITH a flight (panel Q3): the banner says so, never a bare "add".
  if (fieldChangeAllowed(facts, "add-to-flight").ok) {
    return ["You can withdraw a player, put one back or add a late entry with a flight.", ...closes, "The format, rounds and players’ details stay locked."];
  }
  // A knockout: the reserve is open, and the first sentence of the refusal says why nobody joins.
  if (KNOCKOUTS.includes(facts.family) && fieldChangeAllowed(facts, "reserve").ok) {
    return ["You can withdraw a player, put one back or add a reserve.", add.says.split(/(?<=\.)\s+/)[0]];
  }
  return ["You can withdraw a player or put one back.", add.says];
}

/**
 * THE UNPLACED FLAG (J04), in the panel's words: "Sam is in the field but in
 * no flight. Put them in one." Said after a late entry where a flight is a
 * choice, and on Entries and Flights for as long as it is true — outside a
 * cup too, which until this was the only place that flagged it. Empty for
 * nobody.
 */
export function unplacedWords(names: readonly string[]): string {
  if (names.length === 0) return "";
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${who} ${names.length === 1 ? "is" : "are"} in the field but in no flight. Put ${names.length === 1 ? "them" : "each"} in one.`;
}

/** Whether a family flags a player in no flight, given the flights made (J04): where flights are a division or the pairings. */
export function flagsUnplaced(family: Family, flights: number): boolean {
  return flights > 0 && UNPLACED_FLAG_FAMILIES.includes(family);
}

/**
 * THE ADD FORM'S FLIGHT (panel Q3): offered where a late entrant may be in no
 * flight (stroke play, Stableford — one division is a complete setup),
 * REQUIRED where the entry is refused without one (a round robin once
 * launched), and not drawn where no entry with a flight can be taken. Asked of
 * the rule, so the form never offers what the action refuses.
 */
export function addFlightPick(f: FieldFacts): "offered" | "required" | null {
  if (!flagsUnplaced(f.family, f.flights)) return null;
  if (!fieldChangeAllowed(f, "add-to-flight").ok) return null;
  return fieldChangeAllowed(f, "add").ok ? "offered" : "required";
}

/** A knockout whose entry is refused takes a reserve instead: the add form offers "Add as a reserve" (panel Q3). */
export function reserveOffered(f: FieldFacts): boolean {
  return KNOCKOUTS.includes(f.family) && !fieldChangeAllowed(f, "add").ok && fieldChangeAllowed(f, "reserve").ok;
}

/** A round robin's re-draw, said after a late entrant is given a flight: their matches are drawn, and what that does to the others. */
export function matchesDrawnWords(name: string, flight: string): string {
  return `${name}’s matches against ${flight} are drawn. Each player in it has one more to play.`;
}

/** After a reserve is added: where they are, and what they wait for. */
export function reserveWords(name: string): string {
  return `${name} is on the waiting list as a reserve. The draw does not change.`;
}

/** The words a taken change's warning becomes, for the named player (and their flight, where one was given). */
export function warnWords(warn: FieldWarn | null, name: string, flight: string): string {
  if (warn === "unplaced") return unplacedWords([name]);
  if (warn === "matches-drawn") return matchesDrawnWords(name, flight || "their flight");
  return "";
}
