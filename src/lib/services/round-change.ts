import "server-only";
import { prisma } from "../db";
import { clubToday } from "../domain/club-clock";
import {
  acrossRounds,
  filesMatches,
  handicapMoves,
  MATCHES_KEEP_THEIR_STROKES,
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
 * `setFlightTee`, `setPlayerTee`, `setStageFormat`, `removeStage`,
 * `setStagePlayedOn`, `setStageDeadline` and `dateUndatedRounds` — in place of
 * the setup lock, so a refusal has one spelling and is RETURNED, never thrown
 * (state machine J10).
 *
 * AND IT DOES THE "RECOMPUTE AND LOG" (panel item 10) through the resolvers the
 * board already prices with, never a second copy: the round's playing handicaps
 * are read before and after through `roundHandicapsFor` (the same
 * `playingHandicapPartsInRound` every card is scored off), a tee change
 * re-freezes the round through `freezeRoundHandicaps` (the same conversion the
 * first card froze it with), and what moved goes in Recent changes.
 *
 * The facts are the state machine's own (`tournamentFactsFor`), told the club's
 * day, never the server's.
 */
export async function roundsFactsFor(eventId: string): Promise<Pick<TournamentFacts, "status" | "rounds"> | null> {
  const facts = await tournamentFactsFor(eventId, clubToday(await zoneOfEvent(eventId)));
  return facts ? { status: facts.status, rounds: facts.rounds } : null;
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
  const one = facts ? roundChangeFactsOf(facts, String(stageId)) : null;
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
  const v = acrossRounds(facts, ask);
  return v.ok ? null : v.says;
}

/**
 * BEFORE A TERM OF ONE ROUND IS CHANGED (its allowance, split, basis or own
 * tees): refused in words; or, after scores and not yet confirmed, ASKED — with
 * the Golf Pro's sentence and the count of cards; or taken, carrying what the
 * recompute will need. Asked only when the value actually changes: re-saving
 * the same figure re-scores nothing, and a question on a no-op teaches an
 * organizer to click through the one that matters.
 */
export async function beforeTermChange(
  eventId: string,
  stageId: string,
  ask: Extract<RoundChangeAsk, { kind: "allowance" | "round-tees" }>,
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
 * BEFORE A TEE CHANGE THAT REACHES EVERY ROUND (the tournament's, a flight's,
 * a player's): the same three answers, over every playing round. The confirm
 * names the rounds whose cards are worked out again, and says so where a round
 * of matches keeps the strokes it was played off.
 */
export async function beforeFieldTeeChange(
  eventId: string,
  opts: { changed: boolean; force: boolean },
): Promise<{ refused: RoundRefusal } | { asked: RoundAsk } | { go: Rescore[] }> {
  if (!opts.changed) return { go: [] };
  const facts = await roundsFactsFor(eventId);
  if (!facts) return { go: [] };
  const v = acrossRounds(facts, { kind: "field-tees" });
  if (!v.ok) return { refused: { ok: false, error: v.says } };
  if (v.rescored.length === 0) return { go: [] };
  const scored = facts.rounds.filter((r) => r.playing && r.hasResult && !filesMatches(r));
  const counts = await Promise.all(scored.map((r) => enteredCardCount(eventId, r.id)));
  const cards = counts.reduce((a, b) => a + b, 0);
  if (!opts.force) {
    const matchesPlayed = facts.rounds.some((r) => r.playing && r.hasResult && filesMatches(r));
    const says = [rescoreWords(v.rescored, cards), matchesPlayed ? MATCHES_KEEP_THEIR_STROKES : ""].filter(Boolean).join(" ");
    return { asked: { ok: false, needsConfirm: true, cards, says } };
  }
  return {
    go: await Promise.all(scored.map(async (r, i) => ({ stageId: r.id, label: r.label, cards: counts[i], before: await pricedRound(eventId, r.id) }))),
  };
}

/**
 * EVERY PLAYER'S PLAYING HANDICAP IN THE ROUND, as the round's handicap list
 * prices it (`roundHandicapsFor`) — frozen first, so a scored round is read off
 * what its cards are being priced off. Null for a round whose side shares one
 * ball: only the side has a playing handicap there.
 */
async function pricedRound(eventId: string, stageId: string): Promise<PricedPlayer[] | null> {
  await freezeRoundHandicaps(eventId, stageId);
  const views = await roundHandicapsFor(eventId, stageId);
  if (views.some((v) => v.playing === null)) return null;
  return views.map((v) => ({ playerId: v.playerId, figure: v.playing ?? v.handicap }));
}

/**
 * A TEE CHANGE AFTER PLAY RE-FREEZES THE ROUND. Its handicaps were frozen at
 * its first card off the tees as they then stood, and `resolveRoundHandicap`
 * prefers the frozen figure over everything — so without this a tee correction
 * would be shown on every screen and change no score. The Committee correcting
 * its own error (Rule 20.2d; Golf Pro, Q2) is the one deliberate exception to
 * "frozen is never rewritten", made only on a confirmed change and logged.
 *
 * `players`: the ones the change reaches (a flight's, one player's), or null for
 * everybody. Only confirmed players are thawed — a withdrawn player keeps what
 * their card was priced off, since the freeze writes only for the confirmed
 * field and would not give it back.
 */
async function refreeze(eventId: string, stageId: string, players: readonly string[] | null): Promise<void> {
  const confirmed = await prisma.player.findMany({ where: { eventId, status: "confirmed", ...(players ? { id: { in: [...players] } } : {}) }, select: { id: true } });
  if (confirmed.length === 0) return;
  await prisma.roundHandicap.updateMany({
    where: { eventId, stageId, playerId: { in: confirmed.map((p) => p.id) } },
    data: { frozen: null, frozenExact: null, frozenParStrokes: null, frozenAt: null },
  });
  await freezeRoundHandicaps(eventId, stageId);
}

/**
 * AFTER THE TERM IS CHANGED: re-freeze where the tees moved, read the round
 * again through the same resolver, and write what moved in Recent changes —
 * one line per round worked out again. Nothing to do for a change that was not
 * made after play.
 */
export async function afterTermChange(
  eventId: string,
  rescores: Rescore | readonly Rescore[] | null,
  what: string,
  tees: { players: readonly string[] | null } | null,
): Promise<void> {
  const list = rescores === null ? [] : Array.isArray(rescores) ? rescores : [rescores as Rescore];
  for (const r of list) {
    if (tees) await refreeze(eventId, r.stageId, tees.players);
    const after = await pricedRound(eventId, r.stageId);
    const moves = r.before && after ? handicapMoves(r.before, after) : null;
    await logAudit(eventId, "round.recomputed", recomputedLine(what, [r.label], r.cards, moves));
  }
}
