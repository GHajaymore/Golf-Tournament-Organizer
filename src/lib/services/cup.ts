import { byAddress } from "../domain/my-entry";
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
import { lineupHidden } from "../domain/cup-lineup";
import { firstHoleForRound } from "../domain/hole-number";
import { cardLine, type CardLine } from "../domain/card-line";
import { matchKeptBy } from "../domain/match-kept-by";
import { oneCardPerSide } from "../domain/team-entry";
import { holesPlayed } from "../domain/handicap";
import { loadEventState } from "./tournament";
import { teamsForStage } from "./teams";

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
  /** Team A's player ids and Team B's, in the same order as `a` and `b`. */
  aIds: string[];
  bIds: string[];
  /**
   * The id each team is stored under on this match — a pair's Team id or a
   * singles player's id — which is what a concession names (`forfeitMatch`).
   */
  aSideId: string;
  bSideId: string;
  /** Which team conceded, or null. */
  conceded: CupSide | null;
  state: CupMatchState;
  /**
   * Each ball's gross and net, side A's and side B's, for a match kept on
   * stroke cards (`matchKeptBy`) once a card has a hole on it; null otherwise.
   * "Always publish gross and net" — Ajay, 2026-10-17.
   */
  cards: { a: CardLine[]; b: CardLine[]; holes: number } | null;
}

export interface CupSession {
  id: string;
  name: string;
  /** "Four-Ball", "Foursomes", "Singles". */
  kind: string;
  /** Players per side: 1 for singles, 2 for a pair format. */
  sideSize: number;
  /**
   * Whether the organizer has announced this session's lineup. Until then its
   * matches are a draft: on the board staff read they are listed and marked,
   * and on every other board they are not there at all.
   */
  published: boolean;
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

/** A session by the name the club gave it, or its place in the cup. */
export function sessionName(s: { description: string }, index: number): string {
  return s.description.trim() || `Session ${index + 1}`;
}

interface StageLike {
  id: string;
  type: string;
  format: string;
  description: string;
  lineupPublished?: boolean | null;
}
interface MatchLike {
  stageId: string;
  playerAId: string;
  playerBId: string;
  teamAId: string;
  teamBId: string;
  holes: string;
  forfeitedBy?: string | null;
}

/**
 * Which of a person's ids they play under in this tournament: their entries,
 * matched by email the way every "me" in the app is, and the pairs those
 * entries are in.
 */
export async function myCupIds(eventId: string, email: string): Promise<{ players: Set<string>; sides: Set<string> }> {
  const players = new Set(
    (
      await prisma.player.findMany({
        where: { eventId, ...byAddress(email) },
        select: { id: true },
      })
    ).map((p) => p.id),
  );
  const sides = players.size
    ? new Set(
        (
          await prisma.teamMember.findMany({ where: { playerId: { in: [...players] } }, select: { teamId: true } })
        ).map((t) => t.teamId),
      )
    : new Set<string>();
  return { players, sides };
}

/** Whether a stored match has been decided — a result, or a concession. */
function matchDecided(m: MatchLike): boolean {
  if ((m.forfeitedBy ?? "").trim()) return true;
  let holes: HoleResult[] = [];
  try {
    holes = JSON.parse(m.holes) as HoleResult[];
  } catch {
    holes = [];
  }
  return cupMatchState({ holes, conceded: null }).status === "final";
}

/**
 * A TEAM CUP'S SESSIONS, FOR SCORE ENTRY: which this person may open, and
 * which one is theirs to play now.
 *
 * Staff see every session and open on the active round when it is one. A
 * player sees the sessions they have a match in and opens on the first one
 * whose match is not yet decided — Saturday afternoon's foursomes once the
 * morning four-ball is in — or their last match when every one is.
 *
 * Empty, and no default, for a tournament with no cup sessions, so nothing
 * changes anywhere else.
 */
export async function cupSessionsFor<S extends StageLike>(
  state: { event: { id: string }; stages: S[]; matches: MatchLike[]; activeStage?: S | null },
  email: string,
  isStaff: boolean,
): Promise<{ sessions: Array<{ id: string; name: string; kind: string }>; defaultStage: S | null }> {
  const cupStages = state.stages.filter((s) => s.type === TEAM_SESSION);
  if (cupStages.length === 0) return { sessions: [], defaultStage: null };
  const link = (s: S) => ({ id: s.id, name: sessionName(s, cupStages.indexOf(s)), kind: sessionKind(s.format) });

  if (isStaff) {
    const active = state.activeStage && state.activeStage.type === TEAM_SESSION ? state.activeStage : null;
    const open = cupStages.find((s) => state.matches.some((m) => m.stageId === s.id && !matchDecided(m)));
    return { sessions: cupStages.map(link), defaultStage: active ?? open ?? cupStages[0] };
  }

  const me = await myCupIds(state.event.id, email);
  const mine = (m: MatchLike) =>
    me.players.has(m.playerAId) || me.players.has(m.playerBId) || me.sides.has(m.teamAId) || me.sides.has(m.teamBId);
  // Only announced sessions: a draft lineup is not a match a player has yet.
  const announced = cupStages.filter((s) => !lineupHidden(s));
  const myMatches = state.matches.filter((m) => announced.some((s) => s.id === m.stageId) && mine(m));
  const mySessions = announced.filter((s) => myMatches.some((m) => m.stageId === s.id));
  const toPlay = mySessions.find((s) => myMatches.some((m) => m.stageId === s.id && !matchDecided(m)));
  return {
    sessions: mySessions.map(link),
    defaultStage: toPlay ?? mySessions[mySessions.length - 1] ?? null,
  };
}

/**
 * `staff`: the organizer's own board on the Team cup screen, which lists a
 * session's DRAFT lineup too (marked as such). Every other board — players,
 * the public link, the console leaderboard — is the announced cup only. The
 * score is the announced cup on both: a draft can still change, so it counts
 * for nobody.
 */
export async function cupBoard(eventId: string, opts: { staff?: boolean } = {}): Promise<CupBoardResult> {
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
      select: {
        id: true,
        format: true,
        description: true,
        lineupPublished: true,
        holes: true,
        nine: true,
        // How the session's matches are kept, and what a side plays off — for
        // the gross and net under each name of a match kept on cards.
        type: true,
        scoreInput: true,
        matchKeptBy: true,
        scoringBasis: true,
        handicapAllowance: true,
        allowanceWeights: true,
      },
    }),
  ]);
  const published = new Set(stages.filter((s) => s.lineupPublished).map((s) => s.id));
  const firstHoleOfSession = new Map(stages.map((s) => [s.id, firstHoleForRound(s)]));
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
  const cardsByMatch = await cardLinesFor(eventId, stages, matches, sideById, playerById);

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
    // A draft lineup is on the staff board only, and never in the score.
    const announced = published.has(m.stageId);
    if (!announced && !opts.staff) continue;
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
    const input = { holes, conceded, firstHole: firstHoleOfSession.get(m.stageId) ?? 1 };
    if (announced) inputs.push(input);
    const row: CupBoardMatch = {
      id: m.id,
      a: flipped ? sb.names : sa.names,
      b: flipped ? sa.names : sb.names,
      playerIds: [...sa.ids, ...sb.ids],
      aIds: flipped ? sb.ids : sa.ids,
      bIds: flipped ? sa.ids : sb.ids,
      aSideId: flipped ? m.teamBId || m.playerBId : m.teamAId || m.playerAId,
      bSideId: flipped ? m.teamAId || m.playerAId : m.teamBId || m.playerBId,
      conceded,
      state: cupMatchState(input),
      cards: (() => {
        const c = cardsByMatch.get(m.id);
        return c ? { a: flipped ? c.B : c.A, b: flipped ? c.A : c.B, holes: c.holes } : null;
      })(),
    };
    bySession.set(m.stageId, [...(bySession.get(m.stageId) ?? []), row]);
  }

  const tally = cupTally(inputs);
  const holder: CupSide | null =
    event.cupHolderGroupId === ta.id ? "A" : event.cupHolderGroupId === tb.id ? "B" : null;
  // Every session lined up AND announced, so "more than half" is half of the
  // real total. A draft lineup can still change, so it is not a total yet.
  const totalKnown = stages.every((s) => published.has(s.id) && (bySession.get(s.id)?.length ?? 0) > 0);
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
          name: sessionName(s, i),
          kind,
          sideSize: kind === "Singles" ? 1 : Math.max(1, lookupFormat(s.format.trim())?.sideSize ?? 1),
          published: published.has(s.id),
          matches: bySession.get(s.id) ?? [],
        };
      }),
      tally,
      // Zero when there is no target yet — see `cupVerdict`'s `totalKnown`.
      target: event.cupPointsToWin > 0 || totalKnown ? pointsToWin(event.cupPointsToWin, tally.total) : 0,
      verdict: cupVerdict(tally, event.cupPointsToWin, holder, totalKnown),
    },
  };
}

/**
 * EACH BALL'S GROSS AND NET, per match, for the sessions kept on stroke cards.
 *
 * Read from the rows the cards are saved in — `MatchScorecard` for a singles
 * match (slot A and B are its two player columns), `TeamScorecard` for a pair
 * (one card per partner, or the side's one card where the side plays one ball
 * — `oneCardPerSide`). Keyed by the STORED side, A and B, so the caller flips
 * them with the rest of the row.
 *
 * Net goes through the handicaps the round is scored with: a player's playing
 * handicap in the match (`matchHandicapFor`, which falls through to the round),
 * a side's playing handicap (`teamsForStage`), each allocated over the round's
 * own card (`strokeCourseFor`). The event state is loaded only when a session
 * kept on cards has a card in it, so a tapped cup's board costs nothing more.
 */
async function cardLinesFor(
  eventId: string,
  stages: Array<{
    id: string;
    type: string;
    format: string;
    holes: number;
    scoreInput: string;
    matchKeptBy: string;
    scoringBasis: string;
    handicapAllowance: number;
    allowanceWeights: number[];
  }>,
  matches: Array<{ id: string; stageId: string; playerAId: string; playerBId: string; teamAId: string; teamBId: string }>,
  sideById: Map<string, { id: string; members: Array<{ playerId: string; player: { name: string } }> }>,
  playerById: Map<string, { id: string; name: string }>,
): Promise<Map<string, { A: CardLine[]; B: CardLine[]; holes: number }>> {
  const out = new Map<string, { A: CardLine[]; B: CardLine[]; holes: number }>();
  const onCards = stages.filter((s) => matchKeptBy({ ...s, type: s.type }) === "cards");
  if (onCards.length === 0) return out;
  const cardStageIds = new Set(onCards.map((s) => s.id));
  const cardMatches = matches.filter((m) => cardStageIds.has(m.stageId));
  if (cardMatches.length === 0) return out;
  const matchIds = cardMatches.map((m) => m.id);
  const [singles, sides] = await Promise.all([
    prisma.matchScorecard.findMany({ where: { matchId: { in: matchIds } }, select: { matchId: true, slot: true, strokes: true } }),
    prisma.teamScorecard.findMany({
      where: { stageId: { in: [...cardStageIds] }, matchId: { in: matchIds } },
      select: { matchId: true, teamId: true, playerId: true, strokes: true },
    }),
  ]);
  if (singles.length === 0 && sides.length === 0) return out;

  const parse = (raw: string): (number | null)[] => {
    try {
      const v = JSON.parse(raw) as unknown;
      return Array.isArray(v) ? v.map((x) => (typeof x === "number" ? x : null)) : [];
    } catch {
      return [];
    }
  };
  const state = await loadEventState(eventId);
  if (!state) return out;
  const stageById = new Map(onCards.map((s) => [s.id, s]));
  // A side's playing handicap, per session that plays one ball a side.
  const sidePlaying = new Map<string, number>();
  for (const s of onCards) {
    if (!oneCardPerSide(s.format, s.scoreInput, s.scoringBasis)) continue;
    for (const t of await teamsForStage(eventId, s.id, s.format, s.handicapAllowance, holesPlayed(s.holes), s.allowanceWeights)) {
      sidePlaying.set(t.id, t.playingHandicap);
    }
  }

  for (const m of cardMatches) {
    const s = stageById.get(m.stageId)!;
    const holeCount = holesPlayed(s.holes);
    const index = state.strokeCourseFor(s.id).holeDifficulty;
    const line = (name: string, raw: string, playing: number) =>
      cardLine({ name, strokes: parse(raw), playing, strokeIndex: index, holeCount });
    const lines = { A: [] as CardLine[], B: [] as CardLine[], holes: holeCount };
    if (m.playerAId && m.playerBId) {
      for (const slot of ["A", "B"] as const) {
        const pid = slot === "A" ? m.playerAId : m.playerBId;
        const row = singles.find((c) => c.matchId === m.id && c.slot === slot);
        const l = row ? line(playerById.get(pid)?.name ?? "", row.strokes, state.matchHandicapFor(pid, m.id)) : null;
        if (l) lines[slot].push(l);
      }
    } else {
      const oneBall = oneCardPerSide(s.format, s.scoreInput, s.scoringBasis);
      for (const slot of ["A", "B"] as const) {
        const side = sideById.get(slot === "A" ? m.teamAId : m.teamBId);
        if (!side) continue;
        if (oneBall) {
          const row = sides.find((c) => c.matchId === m.id && c.teamId === side.id && c.playerId === "");
          const l = row
            ? line(side.members.map((x) => x.player.name).join(" & "), row.strokes, sidePlaying.get(side.id) ?? 0)
            : null;
          if (l) lines[slot].push(l);
          continue;
        }
        for (const member of side.members) {
          const row = sides.find((c) => c.matchId === m.id && c.teamId === side.id && c.playerId === member.playerId);
          const l = row ? line(member.player.name, row.strokes, state.matchHandicapFor(member.playerId, m.id)) : null;
          if (l) lines[slot].push(l);
        }
      }
    }
    if (lines.A.length || lines.B.length) out.set(m.id, lines);
  }
  return out;
}
