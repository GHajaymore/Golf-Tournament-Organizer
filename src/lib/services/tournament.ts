import "server-only";
import { prisma } from "../db";
import {
  computeStandings,
  groupCutoff,
  buildBracket,
  pickQualifiers,
  splitBrackets,
  roundRobinMatchCount,
  resolveMatch,
  type Player,
  type Match as DomainMatch,
  type ScoringRules,
  type RankedPlayer,
  type BracketView,
  type TiebreakerKey,
} from "../domain";
import type { Event, Player as DbPlayer, Group as DbGroup, Stage as DbStage, Match as DbMatch } from "@prisma/client";

export type HoleResultArr = DomainMatch["holes"];

const AUTO_CONFIRM_MS = 24 * 60 * 60 * 1000;
export type ScoreStatus = "pending" | "confirmed" | "disputed" | "auto-confirmed";

/** Effective confirmation status, applying the lazy 24h auto-confirm. */
export function effectiveScoreStatus(m: { scoreStatus: string; scoredAt: Date | null }): ScoreStatus {
  if (m.scoreStatus === "confirmed") return "confirmed";
  if (m.scoreStatus === "disputed") return "disputed";
  if (m.scoreStatus === "pending" && m.scoredAt && Date.now() - new Date(m.scoredAt).getTime() > AUTO_CONFIRM_MS) {
    return "auto-confirmed";
  }
  return "pending";
}

function scoringFrom(event: Event): ScoringRules {
  let tiebreakers: TiebreakerKey[];
  try {
    tiebreakers = JSON.parse(event.tiebreakers) as TiebreakerKey[];
  } catch {
    tiebreakers = ["head-to-head", "holes-won-ratio", "fewest-holes-lost", "lower-handicap"];
  }
  return {
    winPts: event.winPts,
    tiePts: event.tiePts,
    lossPts: event.lossPts,
    holeRatioPts: event.holeRatioPts,
    bonusPts: event.bonusPts,
    tiebreakers,
  };
}

function toDomainPlayer(p: DbPlayer): Player {
  return { id: p.id, name: p.name, handicap: p.handicap, seed: p.seed, groupId: p.groupId };
}

function toDomainMatch(m: DbMatch): DomainMatch {
  let holes: HoleResultArr;
  try {
    holes = JSON.parse(m.holes) as HoleResultArr;
  } catch {
    holes = [];
  }
  return {
    id: m.id,
    stageId: m.stageId,
    groupId: m.groupId,
    round: m.round,
    playerAId: m.playerAId,
    playerBId: m.playerBId,
    holes,
  };
}

export interface GroupStanding {
  group: DbGroup;
  ranked: RankedPlayer[];
  cutoff: number | null;
}

export interface EventState {
  event: Event;
  scoring: ScoringRules;
  accounts: Awaited<ReturnType<typeof prisma.account.findMany>>;
  players: DbPlayer[];
  confirmed: DbPlayer[];
  waitlist: DbPlayer[];
  groups: DbGroup[];
  stages: DbStage[];
  matches: DbMatch[];
  /** Round-robin matches (stage 0), the pool standings derive from. */
  rrMatches: DbMatch[];
  domainPlayers: Player[];
  domainMatches: DomainMatch[];
  overall: RankedPlayer[];
  groupStandings: GroupStanding[];
  advancingCount: number;
  advancingIds: Set<string>;
  pendingConfirmations: number;
  overallCutoff: number | null;
  brackets: { winners: BracketView; consolation: BracketView };
  qualifiers: Player[];
}

export async function loadEventState(eventId: string): Promise<EventState | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return null;

  const [accounts, players, groups, stages, matches, bracketWinners] = await Promise.all([
    prisma.account.findMany({ where: { eventId }, orderBy: { name: "asc" } }),
    prisma.player.findMany({ where: { eventId }, orderBy: { seed: "asc" } }),
    prisma.group.findMany({ where: { eventId }, orderBy: { position: "asc" } }),
    prisma.stage.findMany({ where: { eventId }, orderBy: { position: "asc" } }),
    prisma.match.findMany({ where: { eventId } }),
    prisma.bracketWinner.findMany({ where: { eventId } }),
  ]);

  const scoring = scoringFrom(event);
  const confirmed = players.filter((p) => p.status === "confirmed");
  const waitlist = players.filter((p) => p.status === "waitlisted");

  // Standings derive from the round-robin stage (position 0) match pool.
  const rrStage = stages.find((s) => s.type === "Round Robin") ?? stages[0];
  const rrMatches = matches.filter((m) => rrStage && m.stageId === rrStage.id);
  const domainMatches = rrMatches.map(toDomainMatch);
  const domainPlayers = confirmed.map(toDomainPlayer);

  const overall = computeStandings(domainPlayers, domainMatches, scoring);

  const groupStandings: GroupStanding[] = groups.map((g) => {
    const gp = confirmed.filter((p) => p.groupId === g.id).map(toDomainPlayer);
    const ranked = computeStandings(gp, domainMatches, scoring);
    return { group: g, ranked, cutoff: groupCutoff(ranked, event.qualifyPerGroup) };
  });

  // Qualification: top N per flight, or top N overall.
  const qualifierIds =
    event.qualifyMode === "overall"
      ? new Set(overall.slice(0, event.qualifyOverall).map((rp) => rp.player.id))
      : new Set(
          groupStandings.flatMap((gs) =>
            gs.ranked.slice(0, event.qualifyPerGroup).map((rp) => rp.player.id),
          ),
        );

  const advancingIds = qualifierIds;
  const advancingCount = qualifierIds.size;

  // Completed matches still awaiting the other player's confirmation (not auto-confirmed).
  const pendingConfirmations = rrMatches.filter((m) => {
    let holes: HoleResultArr;
    try {
      holes = JSON.parse(m.holes) as HoleResultArr;
    } catch {
      return false;
    }
    return resolveMatch(holes).complete && effectiveScoreStatus(m) === "pending";
  }).length;
  const qualifiers = overall.filter((rp) => qualifierIds.has(rp.player.id)).map((rp) => rp.player);

  const advTotals = overall
    .filter((rp) => qualifierIds.has(rp.player.id))
    .map((rp) => rp.stats.totalPoints);
  const overallCutoff = advTotals.length ? Math.min(...advTotals) : null;
  const { winners, consolation } = splitBrackets(qualifiers);
  const winnersMap: Record<string, string> = {};
  for (const bw of bracketWinners) winnersMap[bw.key] = bw.winnerId;
  const brackets = {
    winners: buildBracket("winners", winners, winnersMap),
    consolation: buildBracket("consolation", consolation, winnersMap),
  };

  return {
    event,
    scoring,
    accounts,
    players,
    confirmed,
    waitlist,
    groups,
    stages,
    matches,
    rrMatches,
    domainPlayers,
    domainMatches,
    overall,
    groupStandings,
    advancingCount,
    advancingIds,
    pendingConfirmations,
    overallCutoff,
    brackets,
    qualifiers,
  };
}

/** Dashboard stat helpers. */
export function matchProgress(state: EventState): { done: number; total: number; pct: number } {
  const done = state.rrMatches.filter((m) => {
    try {
      const holes = JSON.parse(m.holes) as HoleResultArr;
      return holes.some((h) => h !== null);
    } catch {
      return false;
    }
  }).length;
  const total = state.rrMatches.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, pct };
}

export function expectedRrTotal(state: EventState): number {
  return state.groups.reduce((acc, g) => {
    const n = state.confirmed.filter((p) => p.groupId === g.id).length;
    return acc + roundRobinMatchCount(n);
  }, 0);
}
