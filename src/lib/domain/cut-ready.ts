import { isIndividualStrokeRound, isPlayingRound, seededFromQualifiers } from "../stage-types";
import type { CutRule, CutLineKind } from "./cut";
import { roundLabel } from "./round-label";

/**
 * The cut a round's settings describe. One reader for the cut itself
 * (`applyStrokeCut`) and the dashboard's preview of it, so "3 go through" on the
 * card is the number the button then makes.
 */
export function cutRuleOf(next: { cutScope: string; cutMode: string; cutCount: number; cutPercent: number }): CutRule {
  return {
    scope: next.cutScope === "perFlight" ? "perFlight" : "overall",
    mode: next.cutMode === "percent" ? "percent" : "count",
    count: next.cutCount,
    percent: next.cutPercent,
  };
}

/**
 * How a tie for the last place at a stroke cut is settled — see
 * `strokeCutOutcome` in `cut.ts`, which applies it, for the three and the
 * default. Read off `Stage.cutTies` here, beside `cutRuleOf`.
 */
export type CutTieRule = "ties" | "playoff" | "countback";
export const CUT_TIE_RULES: readonly CutTieRule[] = ["ties", "playoff", "countback"];
export const DEFAULT_CUT_TIE_RULE: CutTieRule = "ties";

/** A stored value read as a rule; anything unknown is the default. */
export function cutTieRuleOf(v: string | null | undefined): CutTieRule {
  return v === "playoff" || v === "countback" ? v : DEFAULT_CUT_TIE_RULE;
}

/**
 * WHETHER THE CUT INTO THIS ROUND HAS BEEN MADE — the one answer.
 *
 * A round after a stroke cut belongs to the players who made it, and the app
 * keeps that as who holds a card for it: `applyStrokeCut` gives each survivor
 * one when the round before is closed, and records when (`Stage.cutMadeAt`).
 * So the cut is made when the round has a cut, the cut has been recorded, and
 * the individual stroke round it comes out of is CLOSED — re-opening that round
 * to correct a card opens the next one to everybody again until it is closed.
 *
 * Until 2026-10-14 nothing recorded it, and four readers inferred it from "the
 * round holds a card" — also true of a card somebody STARTED in round 2 while
 * round 1 was still open, which the card guard allows since no cut has been
 * made. The dashboard then counted a cut with one survivor, and the money
 * waited for that one card (`a-cut-is-made-once-for-every-reader.audit.test.ts`).
 *
 * `feeder` is the playing round before this one, or undefined for the first.
 */
export function cutHasBeenMade(
  round: { cutEnabled: boolean; cutMadeAt: Date | null; type: string; format: string },
  feeder: { closedAt: Date | null; type: string; format: string } | undefined,
): boolean {
  if (!round.cutEnabled || !round.cutMadeAt || !feeder || !feeder.closedAt) return false;
  return isIndividualStrokeRound(feeder) && isIndividualStrokeRound(round);
}

/**
 * THE ROUNDS A CUT HAS ALREADY BEEN MADE OUT OF — each playing round whose next
 * playing round's cut `cutHasBeenMade` (the one answer), by id. The rounds rule
 * (J12, PR 7b) refuses a change to how such a round is priced: the field of the
 * next round was decided on these figures (`domain/round-change.ts`). The
 * playing rounds in order, as the board and `strokeCutField` take them.
 */
export function cutsMadeAfter(
  stages: ReadonlyArray<{ id: string; position: number; type: string; format: string; cutEnabled: boolean; cutMadeAt: Date | null; closedAt: Date | null }>,
): Set<string> {
  const rounds = [...stages].filter((s) => isPlayingRound(s.type)).sort((a, b) => a.position - b.position);
  return new Set(rounds.flatMap((r, i) => (i > 0 && cutHasBeenMade(r, rounds[i - 1]) ? [rounds[i - 1].id] : [])));
}

/**
 * "Top 16 and ties", "Top 25% in each flight and ties" — or without the ties,
 * for a cut whose tie is settled another way (a play-off, a countback), or one
 * that settles no tie of its own.
 */
export function cutRuleWords(rule: CutRule, ties = true): string {
  const top = rule.mode === "percent" ? `Top ${rule.percent}%` : `Top ${rule.count}`;
  return `${top}${rule.scope === "perFlight" ? " in each flight" : ""}${ties ? " and ties" : ""}`;
}

/**
 * THE CUT MADE AFTER THIS ROUND — what a player in it is playing for.
 *
 * A cut belongs to the round it FEEDS (`cutEnabled` on round 2 means only round
 * 1's survivors play it), so the cut a player in round 1 needs to know about is
 * round 2's. Until 2026-10-14 the rules sheet read the round being played's own
 * setting: it printed no cut at all while round 1 was played, and once round 2
 * began it said "Top 16 advance to the next round" about a cut already made.
 *
 * A cut between two individual stroke rounds settles a tie for the last place
 * the way the organizer chose (`cutTies`): "and ties" only where the ties go
 * through. So does a cut out of a round robin's table since J31 (2026-11-06) —
 * the same setting, on points and the table's tie-breaks rather than a card
 * (`decidedOn`). A round seeded from qualifiers (a bracket) has no cut to
 * print — its field is its qualifiers. Null for a round with no cut after it.
 *
 * AND IT IS PRINTED ON THE SHEET OF THE ROUND THAT DECIDES IT (2026-11-07,
 * ruled by the main session on the J31 review): the round whose card or table
 * the cut is taken on (`cutFeederOf`), not simply the round before the one it
 * feeds. For round robin → medal → cut round, Round 1's sheet says "Top N and
 * ties advance to Round 3" with the tie method, and the medal's says nothing
 * of that cut — its scores do not decide it. `into` names the round the cut
 * feeds when it is not the next one. A cut that no engine makes (no table and
 * no card before it — a scramble's) is printed nowhere: it is a promise
 * nobody keeps.
 */
export function cutAfterRound<R extends { id: string; type: string; format: string; position?: number; cutEnabled: boolean; cutScope: string; cutMode: string; cutCount: number; cutPercent: number; cutTies: string }>(
  rounds: readonly R[],
  roundId: string,
): { rule: CutRule; ties: boolean; tieRule: CutTieRule; decidedOn: CutLineKind; intoId: string; into: string | null } | null {
  const decided = cutDecidedBy(rounds, roundId);
  if (!decided) return null;
  const { next, kind } = decided;
  const playing = rounds.filter((r) => isPlayingRound(r.type));
  const after = playing[playing.findIndex((r) => r.id === roundId) + 1];
  const tieRule = cutTieRuleOf(next.cutTies);
  return {
    rule: cutRuleOf(next),
    ties: tieRule === "ties",
    tieRule,
    decidedOn: kind,
    intoId: next.id,
    into: after?.id === next.id ? null : roundLabel(rounds, next.id),
  };
}

/**
 * THE CUT `roundId` DECIDES — the first round after it, with a cut and a field
 * of its own (not a bracket's qualifiers), whose cut is taken out of this round
 * (`cutFeederOf`) — or null. The rules sheet and the round's card ask it.
 */
export function cutDecidedBy<R extends { id: string; type: string; format: string; cutEnabled: boolean }>(
  rounds: readonly R[],
  roundId: string,
): { next: R; kind: CutLineKind } | null {
  for (const next of rounds) {
    if (!next.cutEnabled || seededFromQualifiers(next.type)) continue;
    const line = cutFeederOf(rounds, next.id);
    if (line && line.feeder.id === roundId) return { next, kind: line.kind };
  }
  return null;
}

/**
 * WHAT A CUT OUT OF `feeder` INTO `next` IS DRAWN THROUGH — a card (two
 * individual stroke rounds, `applyStrokeCut`) or a round robin's table
 * (`generateCutRound`) — or null for a cut that settles no tie of its own.
 * The stroke test first: a Round Robin set to Stroke Play between two medals
 * is cut on its cards, as `applyStrokeCut` cuts it.
 *
 * NOT EXPORTED (2026-11-07): handed two neighbouring rounds it answers for the
 * round beside the cut, and every reader that did so named the wrong round
 * when a medal stood between a round robin and its cut. Ask `cutFeederOf` or
 * `cutDecidedBy`; `one-reading-of-a-cut.test.ts` refuses a second reading.
 */
function cutLineKindOf(
  feeder: { type: string; format: string } | undefined,
  next: { type: string; format: string },
): CutLineKind | null {
  if (!feeder) return null;
  if (isIndividualStrokeRound(feeder) && isIndividualStrokeRound(next)) return "card";
  if (feeder.type === "Round Robin") return "table";
  return null;
}

/**
 * THE ROUND A CUT INTO `stageId` IS TAKEN OUT OF, AND WHAT IT IS DRAWN ON
 * (J31 review, 2026-11-07) — the one answer the round's tie card, the record
 * of a play-off (`settleCutTie`) and the board ask, so none of them can name a
 * different round from the engine that makes the cut.
 *
 * A CARD when this round and the round before it are both individual stroke
 * rounds: `applyStrokeCut` cuts on the round just played. Otherwise the TABLE
 * of the last Round Robin before it BY POSITION, not the round beside it —
 * `generateCutRound` cuts from that table, so a medal played between a round
 * robin and the round it qualifies for does not move the cut off the table.
 * They asked the adjacent round, and for Round robin → medal → cut round the
 * draw refused "record who won it below" while the card showed no tie, and
 * the record said there was no cut out of the round robin at all.
 *
 * Null where neither engine cuts: the first round, or a cut with no round
 * robin before it that is not a stroke cut (`generateCutRound` refuses it as
 * `no-prior-round`). Rounds that are not played (`isPlayingRound`) are passed
 * over, so the caller may hand in every stage in position order.
 */
export function cutFeederOf<R extends { id: string; type: string; format: string }>(
  stages: readonly R[],
  stageId: string,
): { feeder: R; kind: CutLineKind } | null {
  const rounds = stages.filter((s) => isPlayingRound(s.type));
  const i = rounds.findIndex((s) => s.id === stageId);
  if (i <= 0) return null;
  const next = rounds[i];
  const before = rounds[i - 1];
  if (cutLineKindOf(before, next) === "card") return { feeder: before, kind: "card" };
  const table = rounds.slice(0, i).filter((s) => s.type === "Round Robin").pop();
  return table ? { feeder: table, kind: "table" } : null;
}

/**
 * A STROKE CUT THAT IS READY TO BE MADE, AND IS WAITING ON THE ORGANIZER.
 *
 * The cut out of a round is made when the organizer marks that round finished
 * (`setRoundClosed` → `applyStrokeCut`) — deliberately, and Ajay confirmed it on
 * 2026-10-05: completing the TOURNAMENT does not make a cut, because on a real
 * championship the committee closes Round 1, the cut goes up, and only then is
 * Round 2 drawn. A cut made at the end of the event would be a cut nobody had
 * played to.
 *
 * What was missing is the prompt. Every card for Round 1 comes back, the board
 * shows the cut line, and nothing says the one step left is to close the round —
 * so Round 2 sits open to the whole field until somebody finds the checkbox on
 * Rounds & formats. As a committee would put it: "All Round 1 cards are in —
 * mark Round 1 finished to make the cut".
 *
 * READY means every card the round's FIELD owes is FINAL — Ajay, 2026-10-05:
 * "Cut can't be final unless organizer approve all cards and approve the Cut".
 * Final is `cardIsFinal`: APPROVED by the committee, or merely certified where
 * the tournament has no committee step (`scoreApproval: "players"`, where a
 * signed card is the result). Not "every hole written", and not "signed" where
 * a committee reviews: a cut made on a card the committee then corrects is a
 * cut somebody has to unpick. An empty field is never ready.
 *
 * And the cut is then APPROVED, by the organizer, by marking the round
 * finished — which is the act that makes it (`applyStrokeCut`). This only says
 * when that act is due; `cutBlockers` is what refuses it before then.
 *
 * The FIRST such round only. A cut is made one round at a time, and the round
 * after a cut is not ready to be closed until its own field — the survivors —
 * has returned its cards, which this then reports in its turn.
 */
export interface CutRound {
  id: string;
  type: string;
  format: string;
  cutEnabled: boolean;
  closedAt: Date | string | null;
}

/**
 * Whether a card is a RESULT a cut may be made on. Approved always is; certified
 * is only where nobody reviews it.
 */
export function cardIsFinal(status: string, staffApproves: boolean): boolean {
  return status === "approved" || (!staffApproves && status === "certified");
}

/** The round after `roundId`, when its field is made by a stroke cut out of it. */
export function cutRoundAfter<R extends CutRound>(rounds: readonly R[], roundId: string): R | null {
  const i = rounds.findIndex((r) => r.id === roundId);
  const feeder = rounds[i];
  const next = rounds[i + 1];
  if (!feeder || !next || !next.cutEnabled) return null;
  if (!isIndividualStrokeRound(feeder) || !isIndividualStrokeRound(next)) return null;
  return next;
}

/**
 * The cards in a cut round that are NOT yet a result — what stands between
 * the organizer and making the cut. A player with no card at all is not here:
 * somebody who returned nothing has not completed the round and misses the cut
 * (Rule 3.3b), which is the committee's call to make by closing the round, not
 * a card it can wait on.
 */
export function cutBlockers(
  cards: ReadonlyArray<{ status: string; strokes: string }>,
  staffApproves: boolean,
): { awaitingApproval: number; notReturned: number; disputed: number; total: number } {
  const split = cardsNotFinal(cards, staffApproves);
  const disputed = split.disputed.length;
  // Where a committee reviews, any card it has not approved is waiting on IT —
  // a card the organizer typed in from the paper one is "entered", and telling
  // them it "hasn't been returned" would be false. Where players confirm, an
  // unsigned card is waiting on its player.
  const pending = split.pending;
  const awaitingApproval = staffApproves ? pending.length : 0;
  const notReturned = staffApproves ? 0 : pending.length;
  return { awaitingApproval, notReturned, disputed, total: awaitingApproval + notReturned + disputed };
}

/**
 * THE CARDS IN A ROUND THAT ARE NOT YET A RESULT, kept as cards — `cutBlockers`
 * counts them; closing a round names them (`roundCloseCheck`, state machine
 * PR 4). One split, so the cut and the close cannot disagree about which card
 * is final: a card with no score on it is nobody's card yet, a disputed one
 * waits on a ruling, and any other card not `cardIsFinal` waits on a signature.
 */
export function cardsNotFinal<C extends { status: string; strokes: string }>(
  cards: readonly C[],
  staffApproves: boolean,
): { pending: C[]; disputed: C[] } {
  const played = cards.filter((c) => hasAnyStroke(c.strokes));
  return {
    disputed: played.filter((c) => c.status === "disputed"),
    pending: played.filter((c) => c.status !== "disputed" && !cardIsFinal(c.status, staffApproves)),
  };
}

/**
 * HOW FAR A CUT ROUND IS FROM BEING MADE, in the terms `roundReadyForCut` reads
 * — counted over the cards `cutBlockers` judges, so the dashboard asking for the
 * cut and `setRoundClosed` refusing it cannot disagree (2026-10-09).
 *
 * Walked on a 120-player championship: every returned card approved, closing
 * the round would have made the cut, and the dashboard never asked — because it
 * counted final cards against the whole field, and one player had not turned
 * up. A player with no card is not a card anybody waits on (see `cutBlockers`);
 * they miss the cut, and the prompt says so (`noCard`).
 */
export function cutProgress(
  cards: ReadonlyArray<{ status: string; strokes: string }>,
  staffApproves: boolean,
): { final: number; total: number } {
  const played = cards.filter((c) => hasAnyStroke(c.strokes)).length;
  return { final: played - cutBlockers(cards, staffApproves).total, total: played };
}

function hasAnyStroke(json: string): boolean {
  try {
    return (JSON.parse(json) as unknown[]).some((v) => typeof v === "number" && v > 0);
  } catch {
    return false;
  }
}

/** What the organizer is told when closing the round is refused. */
export function cutBlockedSentence(
  b: ReturnType<typeof cutBlockers>,
  feederName: string,
): string {
  const parts: string[] = [];
  if (b.awaitingApproval) parts.push(`${b.awaitingApproval} ${b.awaitingApproval === 1 ? "card needs" : "cards need"} your approval`);
  if (b.notReturned) parts.push(`${b.notReturned} ${b.notReturned === 1 ? "card hasn't" : "cards haven't"} been signed by the player`);
  if (b.disputed) parts.push(`${b.disputed} ${b.disputed === 1 ? "card is" : "cards are"} disputed`);
  return `${parts.join(", ")}. Closing ${feederName} makes the cut, so every card in it has to be final first.`;
}

export function roundReadyForCut<R extends CutRound>(
  /** The rounds the field plays, in order (`playRounds`). */
  rounds: readonly R[],
  /** How many of the round's field hold a FINAL card (`cardIsFinal`), of how many. */
  progress: (round: R) => { final: number; total: number },
): { feeder: R; next: R } | null {
  for (let i = 0; i + 1 < rounds.length; i += 1) {
    const feeder = rounds[i];
    if (feeder.closedAt) continue;
    const next = cutRoundAfter(rounds, feeder.id);
    if (!next) continue;
    const p = progress(feeder);
    if (p.total > 0 && p.final >= p.total) return { feeder, next };
    // An earlier round still owing cards: any later cut waits behind it.
    return null;
  }
  return null;
}
