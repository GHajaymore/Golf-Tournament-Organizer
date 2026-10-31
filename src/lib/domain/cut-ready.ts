import { isIndividualStrokeRound, seededFromQualifiers } from "../stage-types";
import type { CutRule } from "./cut";

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
 * "Top 16 and ties", "Top 25% in each flight and ties" — or without the ties,
 * for a cut that does not take them (a round robin's, which `survivors` makes
 * on the standings' own order).
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
 * through; a round robin's cut takes the standings' order. A round seeded from
 * qualifiers (a bracket) has no cut to print — its field is its qualifiers.
 * Null for a round with no cut after it.
 */
export function cutAfterRound<R extends { id: string; type: string; format: string; cutEnabled: boolean; cutScope: string; cutMode: string; cutCount: number; cutPercent: number; cutTies: string }>(
  rounds: readonly R[],
  roundId: string,
): { rule: CutRule; ties: boolean; tieRule: CutTieRule | null } | null {
  const i = rounds.findIndex((r) => r.id === roundId);
  const next = i >= 0 ? rounds[i + 1] : undefined;
  if (!next || !next.cutEnabled || seededFromQualifiers(next.type)) return null;
  const stroke = isIndividualStrokeRound(rounds[i]) && isIndividualStrokeRound(next);
  const tieRule = stroke ? cutTieRuleOf(next.cutTies) : null;
  return { rule: cutRuleOf(next), ties: tieRule === "ties", tieRule };
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
  const played = cards.filter((c) => hasAnyStroke(c.strokes));
  const disputed = played.filter((c) => c.status === "disputed").length;
  // Where a committee reviews, any card it has not approved is waiting on IT —
  // a card the organizer typed in from the paper one is "entered", and telling
  // them it "hasn't been returned" would be false. Where players confirm, an
  // unsigned card is waiting on its player.
  const pending = played.filter((c) => c.status !== "disputed" && !cardIsFinal(c.status, staffApproves));
  const awaitingApproval = staffApproves ? pending.length : 0;
  const notReturned = staffApproves ? 0 : pending.length;
  return { awaitingApproval, notReturned, disputed, total: awaitingApproval + notReturned + disputed };
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
