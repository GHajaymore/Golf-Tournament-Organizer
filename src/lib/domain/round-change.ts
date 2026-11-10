/**
 * WHAT A CHANGE TO A ROUND WOULD INVALIDATE, AND SO WHETHER IT MAY BE MADE —
 * the one rule for the J12 rounds-and-format rows (state machine PR 7b; the
 * proposal's section 3, the Golf Pro's Q2 and Q5, the panel's summary item 10).
 *
 * Until this, every one of these changes asked the setup lock (`refuseIfLocked`,
 * "rounds"): refused from launch to the end, whatever it touched, with a
 * committee correction as the only way through — while before launch a round
 * holding scores could have its format, its allowance or its very existence
 * changed on one confirm. The principle of section 3 is the opposite: an edit is
 * judged by what it would INVALIDATE, not by the status. Each answer is one of
 * four — open, WARN (do it and say what changed), RE-DRAW (do it, and say what
 * must be drawn again) or REFUSE (a sentence with the way out). Results already
 * recorded are never silently rewritten.
 *
 * THE ROWS (columns: before the draw · after the draw · after scores in that
 * round · completed):
 *
 *   - THE ALLOWANCE, THE HANDICAP SPLIT AND THE SCORING BASIS (`allowance`):
 *     open · open · WARN WITH A CONFIRM, then recompute and log · refuse.
 *     Applying handicaps is the Committee's job (Rule 3.3b(4): the player is not
 *     responsible for it), so a wrong allowance is a Committee error, and the
 *     Committee corrects its own errors (Rule 20.2d) — refusing at the first card
 *     would block exactly that correction (Golf Pro, Q2). Changing a Term after
 *     play has begun is exceptional (Committee Procedures, Section 5A), so the
 *     confirm says what it is. The basis rides with the allowance (the brief: "a
 *     round's allowance or scoring basis"): gross or net is how the handicaps are
 *     applied to the same holed-out strokes, not how the round was played.
 *   - A ROUND'S OWN TEES OR VENUE (`round-tees`): open · open · REFUSE · refuse.
 *     A Course Handicap is for one set of tees (Rules of Handicapping 6.1), and a
 *     scored round's were frozen off its tees at its first card. Working them out
 *     again needs the Handicap Index the round was frozen with, and that is not
 *     stored (`RoundHandicap` keeps the converted figures only). Re-freezing from
 *     today's index would move a player for an index edited since, so a tee
 *     change after scores is REFUSED until the frozen index is stored (the
 *     coordinator's ruling of 8 Nov, option C; follow-up: `frozenIndex` +
 *     `frozenTeeId`). The way out: "Clear Round 1's scores on Score entry first."
 *     A player's own figure cannot be set by hand on a scored round either
 *     (`setRoundHandicapOverride` refuses there: `FROZEN_HANDICAP_REFUSAL`).
 *   - THE TOURNAMENT'S, A FLIGHT'S OR A PLAYER'S TEES (`field-tees`): asked of
 *     EVERY playing round (`acrossRounds`); REFUSED while any scored round of
 *     cards would be reached, for the same reason. A round of matches keeps the
 *     strokes it was frozen at and does not refuse it.
 *   - A ROUND'S FORMAT (`format`): open · RE-DRAW where the new format draws
 *     differently (a round robin set to match play becomes a medal, or back),
 *     else open · REFUSE, both ways (Golf Pro, Q5: Stableford to stroke is
 *     impossible — a Stableford card may hold a hole with no score, Rule 21.1b,
 *     which in stroke play is a disqualification, Rule 3.3b(3); stroke to
 *     Stableford changes the Terms after play, Committee Procedures 5A) · refuse.
 *   - A ROUND'S HOLES, 18 ↔ 9 (`holes`; added 8 Nov, format-like): open · open
 *     · REFUSE (the stroke index is re-ranked to the holes played and every card
 *     is measured against another length) · refuse.
 *   - A CUT ALREADY MADE OUT OF A ROUND (8 Nov): the allowance and basis
 *     of that round (its tees are refused after scores anyway, above) are
 *     REFUSED, the way out the cut's own undo: "The cut after Round 1 was made
 *     on these figures. Undo the cut first, then change it: untick “This round
 *     is finished” on Round 1." The next round's field was decided on them.
 *   - DELETING A ROUND (`delete`): open · WARN WITH A CONFIRM (its pairings or
 *     tee sheet go with it) · REFUSE ("Round 2 has scores. Clear them on Score
 *     entry first.") · refuse.
 *   - A ROUND'S DAY OR DEADLINE (`day`): open · open · WARN (players' schedules
 *     show the new day) · refuse ("Name, dates, venue", lock `details`).
 *   - ADDING A ROUND is not here: it is refused only once completed, and that
 *     rule is already one function (`addRoundLockOf`, PR 5b; the matrix cell
 *     holds it to the table).
 *
 * A RECORDED MATCH IS NEVER WORKED OUT AGAIN. Where a round's results are filed
 * as MATCHES (match play, a round robin of matches, a knockout, a cup session),
 * the hole results are stored when the cards are (`deriveMatchFromItsCards`),
 * or tapped by the players with no strokes at all; a match result stands once
 * the match is decided (Rule 3.2a(5)). So a change of that round's allowance,
 * basis or tees after a match is scored is REFUSED with the way out — clear the
 * scores — rather than warned: there is nothing the app could honestly re-work.
 * A tournament-wide tee change leaves such a round exactly as it is (its
 * handicaps were frozen at its first card, `freezeRoundHandicaps`).
 *
 * THE STEP is the ROUND's (section 3: "after scores in that round"), derived
 * from its facts (`roundStepOf`) and never handed in beside them: completed ·
 * a result in it · a draw made for it (pairings, or a saved tee sheet) · none.
 * LAUNCH IS NOT A STEP HERE. Launching invalidates nothing a round setting
 * decides, so after launch these changes are judged as before it — the scoped
 * lock "rounds" (PR 5b) still holds every round setting this rule does not own
 * (holes, how many scores count, the cut, tie-breakers, points). No committee
 * correction is ever named: every refusal here is by scores or by completion,
 * and a correction never opens over recorded scores (TD, panel 8.1).
 *
 * Pure: no prisma, no clock. The facts are a slice of `TournamentFacts`
 * (`roundChangeFactsOf`), so the round each verdict judges is the state
 * machine's own. The server's door is `services/round-change.ts`; the Rounds
 * screen draws its controls from `roundDoors`.
 */
import { isFinished } from "./lifecycle-state";
import { isKnockoutRound, roundIsStroke } from "../stage-types";
import type { RoundFacts, TournamentFacts, WayOut } from "./tournament-status";

/** The changes this rule judges. */
export const ROUND_CHANGES = ["allowance", "round-tees", "field-tees", "format", "holes", "delete", "day"] as const;
export type RoundChange = (typeof ROUND_CHANGES)[number];

/**
 * WHAT IS ASKED: the change, and — for a format — the format it would become,
 * REQUIRED, because whether the round must be drawn again depends on it.
 */
type PlainChange = Exclude<RoundChange, "format">;
export type RoundChangeAsk = { kind: "format"; to: string } | { [K in PlainChange]: { kind: K } }[PlainChange];

/** The J12 column a round stands in (see the header). */
export const ROUND_STEPS = ["before-draw", "after-draw", "after-scores", "completed"] as const;
export type RoundStep = (typeof ROUND_STEPS)[number];

/** What a taken change leaves to say: re-scored (confirm), drawn again, taken with it (confirm), or the new day. */
export type RoundWarn = "rescore" | "redraw" | "goes-with-it" | "schedules";

/** The warnings asked before the change is made (`needsConfirm`), not only said after it. */
export const CONFIRMED_WARNINGS: readonly RoundWarn[] = ["rescore", "goes-with-it"];

/** The part a change belongs to: the rounds, or — for a day — the details (section 3's Lock column). */
export type RoundPart = "rounds" | "details";

/**
 * One round's facts, as the state machine read them — and whether the cut OUT
 * of it has been made (`cutsMadeAfter`, from `cutHasBeenMade`, the one answer):
 * the next round's field was decided on this round's figures.
 */
export type RoundChangeRound = Pick<RoundFacts, "id" | "label" | "type" | "format" | "playing" | "hasResult" | "matches" | "teeSheetSaved"> & {
  cutMadeAfter: boolean;
};

export interface RoundChangeFacts {
  /** Stored status: draft | registration | ready | live | completed. */
  status: string;
  /** The round the change is to. */
  round: RoundChangeRound;
}

export type RoundVerdict =
  | { ok: true; scope: RoundPart; step: RoundStep; warn: RoundWarn | null }
  | { ok: false; scope: RoundPart; step: RoundStep; says: string; wayOut: WayOut };

const REOPEN: WayOut = { says: "Reopen it on the dashboard", href: "/dashboard" };
const CLEAR_SCORES: WayOut = { says: "Clear its scores on Score entry", href: "/entry" };
/** A knockout's results are its winners, recorded and cleared on the Bracket — the way out the rounds lock names too (`locksOf`). */
const CLEAR_RESULTS: WayOut = { says: "Clear its results on the Bracket", href: "/bracket" };

/** Where a round's recorded play is cleared, and the words for it: a knockout's results on the Bracket, anything else's scores on Score entry. */
function clearing(round: Pick<RoundChangeRound, "type">): { wayOut: WayOut; what: "scores" | "results"; where: string } {
  return isKnockoutRound(round.type)
    ? { wayOut: CLEAR_RESULTS, what: "results", where: "on the Bracket" }
    : { wayOut: CLEAR_SCORES, what: "scores", where: "on Score entry" };
}

/**
 * WHERE A MADE CUT IS UNDONE TODAY: the round it came out of is reopened —
 * "This round is finished" unticked on its card — which opens the next round to
 * everybody again until it is closed, and closing it again makes the cut again
 * on the figures it then has (`cutHasBeenMade`, `applyStrokeCut`).
 */
const UNDO_CUT: WayOut = { says: "Untick “This round is finished” on its card", href: "/stages" };

/** A change to how a round a cut was made out of is priced, refused (the coordinator's words, 8 Nov). */
export function cutMadeWords(label: string): string {
  const r = label || "this round";
  return `The cut after ${r} was made on these figures. Undo the cut first, then change it: untick “This round is finished” on ${r}.`;
}

/**
 * The round's facts out of the tournament's — the state machine's reading,
 * never a second one — with the rounds a cut has been made out of
 * (`cutsMadeAfter`), REQUIRED, so no caller can forget the cut.
 */
export function roundChangeFactsOf(f: Pick<TournamentFacts, "status" | "rounds">, roundId: string, cutsMade: ReadonlySet<string>): RoundChangeFacts | null {
  const round = f.rounds.find((r) => r.id === roundId);
  return round ? { status: f.status, round: { ...round, cutMadeAfter: cutsMade.has(round.id) } } : null;
}

/** The J12 column, from the facts alone (header). */
export function roundStepOf(f: RoundChangeFacts): RoundStep {
  if (isFinished(f.status)) return "completed";
  if (f.round.hasResult) return "after-scores";
  if (f.round.matches > 0 || f.round.teeSheetSaved === true) return "after-draw";
  return "before-draw";
}

/**
 * THE ROUND'S RESULTS ARE FILED AS MATCHES — somebody drawn against somebody
 * in a format the match engine scores (`roundIsStroke`, both halves). A round
 * robin set to Stroke Play is a medal and files cards.
 */
export function filesMatches(round: Pick<RoundChangeRound, "type" | "format">): boolean {
  return !roundIsStroke(round.type, round.format);
}

/**
 * WOULD THE NEW FORMAT DRAW DIFFERENTLY: a round that files matches becoming
 * one that files cards, or back — its pairings stop meaning anything, or must
 * be drawn. Same family of formats, same draw.
 */
export function drawsDifferently(type: string, from: string, to: string): boolean {
  return roundIsStroke(type, from) !== roundIsStroke(type, to);
}

/** A completed tournament's day, refused — exported so a screen can tell it from the plan's own refusal. */
export const COMPLETED_DATES = "The tournament is completed, so its dates are final. An Organizer can reopen it on the dashboard.";
/** A completed tournament's rounds, refused. */
export const COMPLETED_ROUNDS = "The tournament is completed, so its rounds are final. An Organizer can reopen it on the dashboard.";

/** Completed refuses every change (Rule 20.2e, results final); Reopen is the deliberate route (Golf Pro, Q2). */
function completedRefusal(kind: RoundChange, scope: RoundPart): Extract<RoundVerdict, { ok: false }> {
  return { ok: false, scope, step: "completed", says: kind === "day" ? COMPLETED_DATES : COMPLETED_ROUNDS, wayOut: REOPEN };
}

/** The label a sentence opens with: "Round 2", or "This round" for one the field does not play. */
function named(round: Pick<RoundChangeRound, "label">): string {
  return round.label || "This round";
}

/**
 * MAY THIS CHANGE BE MADE TO THE ROUND NOW, AND IF NOT, WHAT IS THE WAY OUT —
 * the one rule for the J12 rounds-and-format rows. The step from the facts
 * (`roundStepOf`), the part from the change; the table in the header.
 */
export function roundChangeAllowed(facts: RoundChangeFacts, ask: RoundChangeAsk): RoundVerdict {
  const step = roundStepOf(facts);
  const scope: RoundPart = ask.kind === "day" ? "details" : "rounds";
  const no = (says: string, wayOut: WayOut): RoundVerdict => ({ ok: false, scope, step, says, wayOut });
  const yes = (warn: RoundWarn | null = null): RoundVerdict => ({ ok: true, scope, step, warn });
  const round = facts.round;
  const label = named(round);
  const clear = clearing(round);

  if (step === "completed") return completedRefusal(ask.kind, scope);

  switch (ask.kind) {
    case "allowance":
      if (step !== "after-scores") return yes();
      // A recorded match is never worked out again (header).
      if (filesMatches(round)) return no(`${label}’s matches were played off these strokes. Clear its ${clear.what} ${clear.where} first.`, clear.wayOut);
      // A cut made out of it was decided on these figures: undo the cut first.
      if (round.cutMadeAfter) return no(cutMadeWords(round.label), UNDO_CUT);
      return yes("rescore");
    case "round-tees":
      if (step !== "after-scores") return yes();
      if (filesMatches(round)) return no(`${label}’s matches were played off these strokes. Clear its ${clear.what} ${clear.where} first.`, clear.wayOut);
      // Option C (8 Nov): its handicaps were frozen off these tees, and the index they were frozen with is not stored.
      return no(teesFrozenWords(round.label, clear), clear.wayOut);
    case "field-tees":
      // A round of matches keeps the handicaps frozen at its first card; a scored round of cards refuses (option C).
      if (step !== "after-scores" || filesMatches(round)) return yes();
      return no(teesFrozenWords(round.label, clear), clear.wayOut);
    case "holes":
      // Format-like (8 Nov): eighteen to nine re-ranks the stroke index and the denominator of every card.
      if (step === "after-scores") return no(`${label} has ${clear.what}; at another length its cards would mean something else. Clear its ${clear.what} ${clear.where} first.`, clear.wayOut);
      return yes();
    case "format":
      if (ask.to === round.format) return yes();
      if (step === "after-scores") {
        return no(`${label} was scored as ${round.format}; its cards would mean something else. Clear its ${clear.what} ${clear.where} first.`, clear.wayOut);
      }
      return step === "after-draw" && drawsDifferently(round.type, round.format, ask.to) ? yes("redraw") : yes();
    case "delete":
      if (step === "after-scores") return no(`${label} has ${clear.what}. Clear them ${clear.where} first.`, clear.wayOut);
      return step === "after-draw" ? yes("goes-with-it") : yes();
    case "day":
      return step === "after-scores" ? yes("schedules") : yes();
  }
}

/**
 * A TEE OR COURSE CHANGE AFTER PLAY, REFUSED (option C, 8 Nov): the round's
 * handicaps were frozen off its tees at its first card, and re-freezing them
 * needs the index they were frozen with, which is not stored. The way out is
 * the round's scores cleared; a player's own figure cannot be set by hand on a
 * scored round (`FROZEN_HANDICAP_REFUSAL`), so it is not offered.
 */
export function teesFrozenWords(label: string, clear: { what: string; where: string } = { what: "scores", where: "on Score entry" }): string {
  const r = label || "This round";
  return `${r}’s handicaps were frozen off its tees at its first card. Clear ${r}’s ${clear.what} ${clear.where} first.`;
}

/**
 * A CHANGE THAT REACHES SEVERAL ROUNDS (a tournament's, a flight's or a
 * player's tees; dating every round): each playing round is asked, and the
 * first refusal is the answer; otherwise the first warning, else open. A
 * tournament with no rounds is open (completed still refuses).
 */
export function acrossRounds(
  f: Pick<TournamentFacts, "status" | "rounds">,
  ask: Extract<RoundChangeAsk, { kind: "field-tees" | "day" }>,
  cutsMade: ReadonlySet<string>,
): RoundVerdict {
  const rounds = f.rounds.filter((r) => r.playing).map((r) => ({ ...r, cutMadeAfter: cutsMade.has(r.id) }));
  const verdicts = rounds.map((round) => roundChangeAllowed({ status: f.status, round }, ask));
  const refused = verdicts.find((v) => !v.ok);
  if (refused) return refused;
  if (rounds.length === 0) {
    // No round to ask: completed still refuses (its own words), anything else is open.
    const scope: RoundPart = ask.kind === "day" ? "details" : "rounds";
    if (!isFinished(f.status)) return { ok: true, scope, step: "before-draw", warn: null };
    return completedRefusal(ask.kind, scope);
  }
  return verdicts.find((v) => v.ok && v.warn !== null) ?? verdicts[0];
}

/** "Round 1", "Round 1 and Round 2", "Round 1, Round 2 and Round 3". */
export function roundsInWords(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "this round";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * THE CONFIRM BEFORE A TERM IS CHANGED AFTER PLAY, in the Golf Pro's words (Q2):
 * what it is, what is worked out again and how much, and what it cannot touch.
 * Money is final-only (`money-layout.ts`), so nothing paid changes.
 */
export function rescoreWords(labels: readonly string[], cards: number): string {
  const count = cards > 0 ? ` (${cards} card${cards === 1 ? "" : "s"})` : "";
  return `This changes a term of the competition after play. Every net score in ${roundsInWords(labels)}${count} is worked out again. Money is final-only, so nothing paid changes.`;
}

/** A round whose format now draws differently: what must be drawn, said after the change (the re-draw). */
export function redrawWords(label: string, nowFilesMatches: boolean): string {
  const r = label || "This round";
  return nowFilesMatches
    ? `${r} is now played as matches, so its pairings must be drawn. Generate them on its card.`
    : `${r} is now played on cards, so its pairings no longer decide anything. Its groups go out from the tee sheet.`;
}

/** Deleting a round after its draw: what goes with it, asked before. */
export function goesWithItWords(round: Pick<RoundChangeRound, "label" | "matches" | "teeSheetSaved">): string {
  const r = named(round);
  const drawn = round.matches > 0 && round.teeSheetSaved === true ? "pairings and tee sheet go" : round.matches > 0 ? "pairings go" : "tee sheet goes";
  return `${r}’s ${drawn} with it.`;
}

/**
 * THE ROUNDS SCREEN'S BANNER WHILE THE TOURNAMENT IS LIVE, above the setup
 * lock's own line — what this rule leaves open, in two short lines (the field
 * rule's banner is the model, `fieldBanner`). Without it the lock's "Locked
 * because the tournament is live" would read as covering every control.
 */
export const ROUNDS_UNDER_WAY = [
  "Until a round has scores, its format, holes, allowance, tees and day can change.",
  "A round with no scores can still be deleted. The cut, tie-breakers and scores that count stay locked.",
] as const;

/** A played round's day moved: who sees it (section 3, "Name, dates, venue"). */
export const SCHEDULES_WORDS = "Players’ schedules show the new day.";

/**
 * EVERY CHANGE'S REFUSAL AS A SENTENCE, for one round, or null where it is open
 * — what the Rounds screen draws its controls from, so a control is never
 * offered that the action refuses. The format door asks a change to some other
 * format, since the picker does not know what will be chosen (refused after
 * scores whatever it is); the action asks the real one.
 */
export type RoundDoors = Record<Exclude<RoundChange, "field-tees">, string | null>;

export function roundDoors(facts: RoundChangeFacts): RoundDoors {
  const door = (ask: RoundChangeAsk) => {
    const v = roundChangeAllowed(facts, ask);
    return v.ok ? null : v.says;
  };
  return {
    allowance: door({ kind: "allowance" }),
    "round-tees": door({ kind: "round-tees" }),
    // Any OTHER format (none named): after scores every one is refused, and before them none is.
    format: door({ kind: "format", to: "" }),
    holes: door({ kind: "holes" }),
    delete: door({ kind: "delete" }),
    day: door({ kind: "day" }),
  };
}

/**
 * EVERY ROUND'S REFUSAL OF ONE CHANGE, by round id — the rounds that refuse it
 * and nothing else (a round missing from the map is open). The ONE answer the
 * action asks (`roundRefusal` in `services/round-change.ts` reads a round out of
 * this map) and the one a screen draws its controls from before anybody
 * presses them: Score entry's Tees and Played at (`round-tees`), so a round
 * whose handicaps were frozen off its tees at its first card is drawn shut with
 * that sentence rather than offered and then refused (round G594-1, 10 Nov).
 * The cut is REQUIRED, as for `roundChangeFactsOf`.
 */
export function roundRefusals(f: Pick<TournamentFacts, "status" | "rounds">, ask: RoundChangeAsk, cutsMade: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of f.rounds) {
    const one = roundChangeFactsOf(f, r.id, cutsMade);
    const v = one ? roundChangeAllowed(one, ask) : null;
    if (v && !v.ok) out.set(r.id, v.says);
  }
  return out;
}

/** One player's playing handicap in a round, before and after — as the round's handicap list prices it. */
export interface PricedPlayer {
  playerId: string;
  /** What their own ball plays off (`RoundHandicapView.playing`), or — where a side shares one ball — the handicap the side is priced from. */
  figure: number;
}

/** A playing handicap that moved. */
export interface HandicapMove {
  playerId: string;
  from: number;
  to: number;
}

/** WHAT MOVED: each player whose figure is not what it was, in the order given. A player on one list only did not move — they joined or left. */
export function handicapMoves(before: readonly PricedPlayer[], after: readonly PricedPlayer[]): HandicapMove[] {
  const was = new Map(before.map((p) => [p.playerId, p.figure]));
  return after.flatMap((p) => {
    const from = was.get(p.playerId);
    return from !== undefined && from !== p.figure ? [{ playerId: p.playerId, from, to: p.figure }] : [];
  });
}

/** How many moves an audit line names before "and N more" — a line is read, not scrolled. */
export const MOVES_NAMED = 8;

/**
 * THE AUDIT LINE FOR A TERM CHANGED AFTER PLAY (panel item 10: "warn,
 * recompute and log"): what changed, how many cards were worked out again, and
 * whose playing handicap moved, old to new. Players are named by id —
 * `recentChanges` turns each into the name (`namesForIds`), so no name is
 * stored in the line. `moves` is null where a side shares one ball and only
 * the side has a playing handicap: the line then says the sides were.
 */
export function recomputedLine(what: string, labels: readonly string[], cards: number, moves: readonly HandicapMove[] | null): string {
  const counted = `${cards} card${cards === 1 ? "" : "s"} in ${roundsInWords(labels)} worked out again`;
  if (moves === null) return `${what} after play. ${counted}, each side’s handicap with them.`;
  if (moves.length === 0) return `${what} after play. ${counted}; no playing handicap moved.`;
  const named = moves.slice(0, MOVES_NAMED).map((m) => `${m.playerId} ${m.from} → ${m.to}`);
  const more = moves.length > MOVES_NAMED ? `, and ${moves.length - MOVES_NAMED} more` : "";
  return `${what} after play. ${counted}. Playing handicaps moved: ${named.join(", ")}${more}.`;
}
