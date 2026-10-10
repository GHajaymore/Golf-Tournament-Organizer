import { isIndividualStrokeRound } from "../stage-types";
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

/** "Top 16 and ties", "Top 25% in each flight and ties". */
export function cutRuleWords(rule: CutRule): string {
  const top = rule.mode === "percent" ? `Top ${rule.percent}%` : `Top ${rule.count}`;
  return `${top}${rule.scope === "perFlight" ? " in each flight" : ""} and ties`;
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
