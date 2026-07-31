import "server-only";
import { prisma } from "../db";
import {
  computeStandings,
  groupCutoff,
  buildBracket,
  pickQualifiers,
  splitBrackets,
  roundRobinMatchCount,
  type Player,
  type Match as DomainMatch,
  type ScoringRules,
  type RankedPlayer,
  type BracketView,
  type TiebreakerKey,
} from "../domain";
import type { Event, Player as DbPlayer, Group as DbGroup, Stage as DbStage, Match as DbMatch } from "@prisma/client";

export type HoleResultArr = DomainMatch["holes"];

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

  const advancingCount = groupStandings.reduce(
    (acc, gs) => acc + Math.min(event.qualifyPerGroup, gs.ranked.length),
    0,
  );

  // Overall cutoff line ~ the lowest total among all advancing players.
  const advancingTotals = groupStandings
    .flatMap((gs) => gs.ranked.slice(0, event.qualifyPerGroup))
    .map((rp) => rp.stats.totalPoints);
  const overallCutoff = advancingTotals.length ? Math.min(...advancingTotals) : null;

  // Bracket seeding from qualifiers.
  const groupsRanked = groupStandings.map((gs) => gs.ranked);
  const qualifiers = pickQualifiers(groupsRanked, event.qualifyPerGroup, overall);
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
