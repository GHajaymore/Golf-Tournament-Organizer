import "server-only";
import { prisma } from "../db";
import { clubToday } from "../domain/club-clock";
import { cutsMadeAfter } from "../domain/cut-ready";
import {
  acrossRounds,
  handicapMoves,
  recomputedLine,
  rescoreWords,
  roundChangeAllowed,
  roundChangeFactsOf,
  type PricedPlayer,
  type RoundChangeAsk,
  type RoundChangeRound,
  type RoundVerdict,
} from "../domain/round-change";
import type { TournamentFacts } from "../domain/tournament-status";
import { logAudit } from "./action-shared";
import { zoneOfEvent } from "./club-clock";
import { enteredCardCount } from "./round-cards";
import { freezeRoundHandicaps, roundHandicapsFor } from "./round-handicap";
import { tournamentFactsFor } from "./tournament-facts";

/**
 * THE SERVER'S DOOR TO THE ONE ROUNDS-AND-FORMAT RULE (`domain/round-change.ts`,
 * J12, state machine PR 7b).
 *
 * Every action that changes a round's allowance, split, basis, tees, format,
 * existence or day asks this — `setStageAllowance`, `setStageAllowanceWeights`,
 * `setStageScoringBasis`, `setStageCourse`, `setEventDefaultTee`,
 * `setFlightTee`, `setPlayerTee`, `setStageFormat`, `setStageHoles`, `removeStage`,
 * `setStagePlayedOn`, `setStageDeadline` and `dateUndatedRounds` — in place of
 * the setup lock, so a refusal has one spelling and is RETURNED, never thrown
 * (state machine J10).
 *
 * AND IT DOES THE "RECOMPUTE AND LOG" (panel item 10) for the allowance, split
 * and basis through the resolvers the board already prices with, never a second
 * copy: the round's playing handicaps are read before and after through
 * `roundHandicapsFor` (the same `playingHandicapPartsInRound` every card is
 * scored off), which takes the allowance of the FROZEN exact Course Handicap —
 * no current index is read for a frozen player — and what moved goes in Recent
 * changes. A tee or course change after play is REFUSED, never re-frozen
 * (option C, 8 Nov: the index a round was frozen with is not stored).
 *
 * The facts are the state machine's own (`tournamentFactsFor`), told the club's
 * day, never the server's.
 */
export async function roundsFactsFor(eventId: string): Promise<(Pick<TournamentFacts, "status" | "rounds"> & { cutsMade: Set<string> }) | null> {
  const [facts, stages] = await Promise.all([
    tournamentFactsFor(eventId, clubToday(await zoneOfEvent(eventId))),
    // The rounds a cut has been made out of — `cutsMadeAfter`, the one answer (`cutHasBeenMade`).
    prisma.stage.findMany({ where: { eventId }, select: { id: true, position: true, type: true, format: true, cutEnabled: true, cutMadeAt: true, closedAt: true } }),
  ]);
  return facts ? { status: facts.status, rounds: facts.rounds, cutsMade: cutsMadeAfter(stages) } : null;
}

const NOT_FOUND = "That round isn’t in this tournament.";

/** A refusal, as every one of these actions returns it. */
export interface RoundRefusal {
  ok: false;
  error: string;
}

/** The server asking before it re-scores: how many cards, and the confirm's words. */
export interface RoundAsk {
  ok: false;
  needsConfirm: true;
  cards: number;
  says: string;
}

/** A term change about to be made after play: the round, its playing handicaps before, and its cards. */
export interface Rescore {
  stageId: string;
  label: string;
  cards: number;
  /** Null where a side shares one ball and only the side has a playing handicap (`RoundHandicapView.playing`). */
  before: PricedPlayer[] | null;
}

/** The round's verdict on one change, with the round it judged. */
export async function roundVerdictFor(eventId: string, stageId: string, ask: RoundChangeAsk): Promise<{ verdict: RoundVerdict; round: RoundChangeRound } | null> {
  const facts = await roundsFactsFor(eventId);
  const one = facts ? roundChangeFactsOf(facts, String(stageId), facts.cutsMade) : null;
  return one ? { verdict: roundChangeAllowed(one, ask), round: one.round } : null;
}

/** The refusal in a sentence, or null when the change may be made (or the round is not this tournament's — the action says that itself). */
export async function roundRefusal(eventId: string, stageId: string, ask: RoundChangeAsk): Promise<string | null> {
  const r = await roundVerdictFor(eventId, stageId, ask);
  return r && !r.verdict.ok ? r.verdict.says : null;
}

/** A change that reaches every round (`acrossRounds`): its refusal in a sentence, or null. */
export async function acrossRoundsRefusal(eventId: string, ask: Extract<RoundChangeAsk, { kind: "field-tees" | "day" }>): Promise<string | null> {
  const facts = await roundsFactsFor(eventId);
  if (!facts) return null;
  const v = acrossRounds(facts, ask, facts.cutsMade);
  return v.ok ? null : v.says;
}

/**
 * BEFORE A TERM OF ONE ROUND IS CHANGED (its allowance, split or basis):
 * refused in words; or, after scores and not yet confirmed, ASKED — with
 * the Golf Pro's sentence and the count of cards; or taken, carrying what the
 * recompute will need. Asked only when the value actually changes: re-saving
 * the same figure re-scores nothing, and a question on a no-op teaches an
 * organizer to click through the one that matters.
 */
export async function beforeTermChange(
  eventId: string,
  stageId: string,
  ask: Extract<RoundChangeAsk, { kind: "allowance" }>,
  opts: { changed: boolean; force: boolean },
): Promise<{ refused: RoundRefusal } | { asked: RoundAsk } | { go: Rescore | null }> {
  if (!opts.changed) return { go: null };
  const r = await roundVerdictFor(eventId, stageId, ask);
  if (!r) return { refused: { ok: false, error: NOT_FOUND } };
  if (!r.verdict.ok) return { refused: { ok: false, error: r.verdict.says } };
  if (r.verdict.warn !== "rescore") return { go: null };
  const cards = await enteredCardCount(eventId, stageId);
  if (!opts.force) return { asked: { ok: false, needsConfirm: true, cards, says: rescoreWords([r.round.label], cards) } };
  return { go: { stageId, label: r.round.label, cards, before: await pricedRound(eventId, stageId) } };
}

/**
 * EVERY PLAYER'S PLAYING HANDICAP IN THE ROUND, as the round's handicap list
 * prices it (`roundHandicapsFor`) — frozen first, so a scored round is read off
 * what its cards are being priced off: `freezeRoundHandicaps` writes only where
 * nothing is frozen yet (a player confirmed since the first card, exactly as the
 * next card write would), and the list prefers the frozen exact figure to
 * everything. Null for a round whose side shares one ball: only the side has a
 * playing handicap there.
 */
async function pricedRound(eventId: string, stageId: string): Promise<PricedPlayer[] | null> {
  await freezeRoundHandicaps(eventId, stageId);
  const views = await roundHandicapsFor(eventId, stageId);
  if (views.some((v) => v.playing === null)) return null;
  return views.map((v) => ({ playerId: v.playerId, figure: v.playing ?? v.handicap }));
}

/**
 * AFTER THE TERM IS CHANGED: read the round again through the same resolver,
 * and write what moved in Recent changes. Nothing to do for a change that was
 * not made after play. Nothing is thawed or re-frozen here.
 */
export async function afterTermChange(eventId: string, rescore: Rescore | null, what: string): Promise<void> {
  if (!rescore) return;
  const after = await pricedRound(eventId, rescore.stageId);
  const moves = rescore.before && after ? handicapMoves(rescore.before, after) : null;
  await logAudit(eventId, "round.recomputed", recomputedLine(what, [rescore.label], rescore.cards, moves));
}
