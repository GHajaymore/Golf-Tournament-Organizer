import { prisma } from "../db";
import { lookupFormat } from "../formats";
import {
  cupMatchState,
  cupTally,
  cupVerdict,
  pointsToWin,
  type CupMatchInput,
  type CupMatchState,
  type CupSide,
  type CupTally,
  type CupVerdict,
} from "../domain/cup";
import type { HoleResult } from "../domain/types";

/**
 * THE TEAM CUP BOARD — every session, every match, the running score.
 *
 * The two TEAMS are the event's two flights (`Group` with no stage and not a
 * match carrier), in their position order: the first is Team A. A pair is a
 * `Team` whose `clubGroupId` names its flight; a singles player belongs to
 * their own flight. Each match is turned round when its stored A side is the
 * cup's Team B, so every row and the total read the same way round.
 */

export const TEAM_SESSION = "Team Session";

export interface CupTeam {
  id: string;
  name: string;
  captain: string;
}

export interface CupBoardMatch {
  id: string;
  /** Team A's player(s) in this match, and Team B's. */
  a: string[];
  b: string[];
  /** Every player in the match, both teams — who is already playing this session. */
  playerIds: string[];
  state: CupMatchState;
}

export interface CupSession {
  id: string;
  name: string;
  /** "Four-Ball", "Foursomes", "Singles". */
  kind: string;
  /** Players per side: 1 for singles, 2 for a pair format. */
  sideSize: number;
  matches: CupBoardMatch[];
}

export interface CupBoard {
  teams: [CupTeam, CupTeam];
  sessions: CupSession[];
  tally: CupTally;
  target: number;
  verdict: CupVerdict;
}

export type CupBoardResult = { ok: true; board: CupBoard } | { ok: false; reason: "no-sessions" | "teams" };

/** What a golfer calls a session of this format. */
export function sessionKind(format: string): string {
  const f = lookupFormat(format.trim());
  if (!f || f.sideSize <= 1) return "Singles";
  return f.name;
}

export async function cupBoard(eventId: string): Promise<CupBoardResult> {
  const [event, flights, stages] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { cupPointsToWin: true, cupHolderGroupId: true } }),
    prisma.group.findMany({
      where: { eventId, stageId: null, isCarrier: false },
      orderBy: { position: "asc" },
      select: { id: true, name: true, captain: { select: { name: true } } },
    }),
    prisma.stage.findMany({
      where: { eventId, type: TEAM_SESSION },
      orderBy: { position: "asc" },
      select: { id: true, format: true, description: true },
    }),
  ]);
  if (!event || stages.length === 0) return { ok: false, reason: "no-sessions" };
  if (flights.length !== 2) return { ok: false, reason: "teams" };
  const [ta, tb] = flights;

  const matches = await prisma.match.findMany({
    where: { eventId, stageId: { in: stages.map((s) => s.id) } },
    orderBy: [{ round: "asc" }, { id: "asc" }],
    select: { id: true, stageId: true, holes: true, forfeitedBy: true, playerAId: true, playerBId: true, teamAId: true, teamBId: true },
  });
  const teamIds = matches.flatMap((m) => [m.teamAId, m.teamBId]).filter((id): id is string => !!id);
  const playerIds = matches.flatMap((m) => [m.playerAId, m.playerBId]).filter((id): id is string => !!id);
  const [sides, players] = await Promise.all([
    prisma.team.findMany({
      where: { id: { in: teamIds }, eventId },
      select: {
        id: true,
        clubGroupId: true,
        members: { orderBy: { position: "asc" }, select: { playerId: true, player: { select: { name: true } } } },
      },
    }),
    prisma.player.findMany({ where: { id: { in: playerIds }, eventId }, select: { id: true, name: true, groupId: true } }),
  ]);
  const sideById = new Map(sides.map((s) => [s.id, s]));
  const playerById = new Map(players.map((p) => [p.id, p]));

  /** The flight and the names on one stored side of a match. */
  const sideOf = (
    teamId: string | null,
    playerId: string | null,
  ): { flight: string; names: string[]; ids: string[] } | null => {
    if (teamId) {
      const s = sideById.get(teamId);
      return s
        ? { flight: s.clubGroupId ?? "", names: s.members.map((m) => m.player.name), ids: s.members.map((m) => m.playerId) }
        : null;
    }
    if (playerId) {
      const p = playerById.get(playerId);
      return p ? { flight: p.groupId ?? "", names: [p.name], ids: [p.id] } : null;
    }
    return null;
  };

  const inputs: CupMatchInput[] = [];
  const bySession = new Map<string, CupBoardMatch[]>();
  for (const m of matches) {
    const sa = sideOf(m.teamAId, m.playerAId);
    const sb = sideOf(m.teamBId, m.playerBId);
    // A match the cup cannot place — a side from neither team — is left off
    // the board rather than credited to somebody by guess.
    if (!sa || !sb) continue;
    const flipped = sa.flight === tb.id && sb.flight === ta.id;
    if (!flipped && !(sa.flight === ta.id && sb.flight === tb.id)) continue;

    let holes: HoleResult[] = [];
    try {
      holes = JSON.parse(m.holes) as HoleResult[];
    } catch {
      holes = [];
    }
    const by = (m.forfeitedBy ?? "").trim();
    let conceded: CupSide | null = null;
    if (by) conceded = by === (m.teamAId || m.playerAId) ? "A" : by === (m.teamBId || m.playerBId) ? "B" : null;
    if (flipped) {
      holes = holes.map((h) => (h === "A" ? "B" : h === "B" ? "A" : h));
      if (conceded) conceded = conceded === "A" ? "B" : "A";
    }
    const input = { holes, conceded };
    inputs.push(input);
    const row: CupBoardMatch = {
      id: m.id,
      a: flipped ? sb.names : sa.names,
      b: flipped ? sa.names : sb.names,
      playerIds: [...sa.ids, ...sb.ids],
      state: cupMatchState(input),
    };
    bySession.set(m.stageId, [...(bySession.get(m.stageId) ?? []), row]);
  }

  const tally = cupTally(inputs);
  const holder: CupSide | null =
    event.cupHolderGroupId === ta.id ? "A" : event.cupHolderGroupId === tb.id ? "B" : null;
  return {
    ok: true,
    board: {
      teams: [
        { id: ta.id, name: ta.name, captain: ta.captain?.name ?? "" },
        { id: tb.id, name: tb.name, captain: tb.captain?.name ?? "" },
      ],
      sessions: stages.map((s, i) => {
        const kind = sessionKind(s.format);
        return {
          id: s.id,
          name: s.description.trim() || `Session ${i + 1}`,
          kind,
          sideSize: kind === "Singles" ? 1 : Math.max(1, lookupFormat(s.format.trim())?.sideSize ?? 1),
          matches: bySession.get(s.id) ?? [],
        };
      }),
      tally,
      target: pointsToWin(event.cupPointsToWin, tally.total),
      verdict: cupVerdict(tally, event.cupPointsToWin, holder),
    },
  };
}
