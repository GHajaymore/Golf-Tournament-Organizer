import "server-only";
import { prisma } from "../db";
import { loadEventState } from "./tournament";
import { resolveMatch } from "../domain/match";
import {
  parseSingleMatchRule,
  resolveSingleMatch,
  describeSingleMatchRule,
  type SingleMatchResolution,
  type SingleMatchRule,
} from "../domain/single-match";

/**
 * A Single Match Stage, resolved against the tournament as it stands.
 *
 * The pairing is worked out here rather than stored, so a corrected score
 * upstream changes who plays. See the domain module for why.
 */
export interface SingleMatchView {
  stageId: string;
  rule: SingleMatchRule | null;
  /** The rule in words, for the round header. */
  ruleLabel: string;
  resolution: SingleMatchResolution;
  /** Names for the resolved pair, when there is one. */
  aName: string;
  bName: string;
  /** The match row, once created. */
  matchId: string | null;
  /** True when the pairing is known and no match exists for it yet. */
  canCreate: boolean;
  /** True when a match exists but the rule now resolves to different players. */
  stale: boolean;
  /**
   * The other rounds and the field, for the picker's dropdowns.
   *
   * Carried here rather than threaded through the round-card component tree:
   * the view already had to load both to resolve the rule, and a second query
   * two components away is how the picker would come to offer a round that no
   * longer exists.
   */
  rounds: Array<{ id: string; label: string }>;
  players: Array<{ id: string; name: string }>;
}

/**
 * The winner of an earlier round.
 *
 * A Single Match Stage or a bracket has one obvious winner. A Round Robin
 * round does not — "the winner of round 2" there means whoever came top of
 * that round's own matches, which is what a committee means when they say it.
 * Read from the matches of that stage alone, never from the tournament total.
 */
function winnerOfStageFrom(
  matches: Array<{ stageId: string; playerAId: string; playerBId: string; holes: string; forfeitedBy?: string | null }>,
): (stageId: string) => string | null {
  return (stageId: string) => {
    const own = matches.filter((m) => m.stageId === stageId);
    if (own.length === 0) return null;

    const wins = new Map<string, number>();
    for (const m of own) {
      // A forfeit decides the match, the same as it does everywhere else.
      if (m.forfeitedBy) {
        const winner = m.forfeitedBy === m.playerAId ? m.playerBId : m.playerAId;
        if (winner) wins.set(winner, (wins.get(winner) ?? 0) + 1);
        continue;
      }
      let holes: (string | null)[] = [];
      try {
        holes = JSON.parse(m.holes) as (string | null)[];
      } catch {
        return null;
      }
      const r = resolveMatch(holes as never);
      // A round with an unfinished match has no winner yet — saying otherwise
      // would put somebody in a final on the strength of a half-played round.
      if (!r.complete) return null;
      if (r.winner === "H") continue;
      const winner = r.winner === "A" ? m.playerAId : m.playerBId;
      if (winner) wins.set(winner, (wins.get(winner) ?? 0) + 1);
    }

    const ranked = [...wins.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (ranked.length === 0) return null;
    // A shared lead is not a winner. Two players level at the top of a round
    // is exactly the case a committee has to settle themselves.
    if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;
    return ranked[0][0];
  };
}

export async function singleMatchFor(eventId: string, stageId: string): Promise<SingleMatchView | null> {
  const [state, stage, matches] = await Promise.all([
    loadEventState(eventId),
    prisma.stage.findFirst({ where: { id: stageId, eventId }, select: { id: true, singleMatchRule: true } }),
    prisma.match.findMany({
      where: { eventId },
      select: { id: true, stageId: true, playerAId: true, playerBId: true, holes: true, forfeitedBy: true },
    }),
  ]);
  if (!state || !stage) return null;

  const rule = parseSingleMatchRule(stage.singleMatchRule);
  const nameOf = (id: string) => state.confirmed.find((p) => p.id === id)?.name ?? "Unknown";
  const roundLabelOf = (id: string) => {
    const i = state.stages.findIndex((s) => s.id === id);
    return i >= 0 ? `Round ${i + 1}` : "an earlier round";
  };

  const resolution = resolveSingleMatch(rule, {
    // Only players who hold a POSITION can be seeded — a standing built on
    // nobody having played is not a standing, and neither is one built on a
    // card that stopped short. Seeding a play-off off a rank of 0 would put
    // the unranked at the top of the list.
    standingIds: state.isStroke
      ? state.strokeStandings.filter((s) => s.ranked).map((s) => s.player.id)
      : state.overall.filter((r) => r.stats.played > 0).map((r) => r.player.id),
    winnerOfStage: winnerOfStageFrom(matches),
    fieldIds: state.confirmed.map((p) => p.id),
  });

  const existing = matches.find((m) => m.stageId === stageId) ?? null;
  const pair = resolution.pairing;
  const stale =
    !!existing &&
    !!pair &&
    !(
      (existing.playerAId === pair.playerAId && existing.playerBId === pair.playerBId) ||
      (existing.playerAId === pair.playerBId && existing.playerBId === pair.playerAId)
    );

  return {
    stageId,
    rule,
    ruleLabel: describeSingleMatchRule(rule, nameOf, roundLabelOf),
    resolution,
    aName: pair ? nameOf(pair.playerAId) : "",
    bName: pair ? nameOf(pair.playerBId) : "",
    matchId: existing?.id ?? null,
    canCreate: !!pair && !existing,
    stale,
    rounds: state.stages.map((s, i) => ({ id: s.id, label: `Round ${i + 1}` })),
    players: state.confirmed.map((p) => ({ id: p.id, name: p.name })),
  };
}
