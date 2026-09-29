import { prisma } from "@/lib/db";
import { parseTeeSheet } from "@/lib/domain/tee-sheet";
import { holesEntered, type PaceGroupIn } from "@/lib/domain/pace";
import { holesPlayed } from "@/lib/domain/handicap";
import { roundLabel } from "@/lib/domain/round-label";

/**
 * The rounds that could be under way today, with each timed group and how far
 * its furthest card has got — for the committee's pace-of-play panel.
 *
 * "Today" is decided in the BROWSER, which knows the course's clock (see
 * `domain/pace.ts`); the server only narrows to rounds dated within a day of
 * its own, so a panel in any time zone gets its round and a season of league
 * weeks is not shipped to the page. A round with no date, no saved sheet or no
 * times on it has nothing to measure and is left out, as is a closed round.
 *
 * Every card is counted wherever it lives: an individual Scorecard, or a
 * TeamScorecard — a shared ball's row belongs to its side, so each of the
 * side's players is credited with it.
 */
export interface PaceRound {
  stageId: string;
  label: string;
  playedOn: string;
  holes: number;
  paceMinutes: number;
  groups: PaceGroupIn[];
}

const DAY = 86_400_000;

export async function paceRoundsFor(eventId: string, now = new Date()): Promise<PaceRound[]> {
  const stages = await prisma.stage.findMany({
    where: { eventId },
    select: {
      id: true,
      type: true,
      position: true,
      playedOn: true,
      holes: true,
      paceMinutes: true,
      teeSheet: true,
      closedAt: true,
    },
    orderBy: { position: "asc" },
  });
  const near = stages.filter((s) => {
    if (s.closedAt || !/^\d{4}-\d{2}-\d{2}$/.test(s.playedOn)) return false;
    const day = Date.parse(`${s.playedOn}T12:00:00Z`);
    return Math.abs(day - now.getTime()) <= 1.5 * DAY;
  });

  const out: PaceRound[] = [];
  for (const s of near) {
    const sheet = parseTeeSheet(s.teeSheet);
    const timed = (sheet?.groups ?? []).filter((g) => g.time.trim() && g.playerIds.length > 0);
    if (timed.length === 0) continue;

    const [cards, teamCards, members] = await Promise.all([
      prisma.scorecard.findMany({ where: { eventId, stageId: s.id }, select: { playerId: true, strokes: true } }),
      prisma.teamScorecard.findMany({
        where: { eventId, stageId: s.id },
        select: { teamId: true, playerId: true, strokes: true },
      }),
      prisma.teamMember.findMany({
        where: { team: { eventId, stageId: s.id } },
        select: { teamId: true, playerId: true },
      }),
    ]);
    const thruOf = new Map<string, number>();
    const credit = (playerId: string, n: number) => thruOf.set(playerId, Math.max(thruOf.get(playerId) ?? 0, n));
    for (const c of cards) credit(c.playerId, holesEntered(c.strokes));
    for (const c of teamCards) {
      const n = holesEntered(c.strokes);
      if (c.playerId) credit(c.playerId, n);
      else for (const m of members) if (m.teamId === c.teamId) credit(m.playerId, n);
    }

    out.push({
      stageId: s.id,
      label: roundLabel(stages, s.id),
      playedOn: s.playedOn,
      holes: holesPlayed(s.holes),
      paceMinutes: s.paceMinutes,
      groups: timed.map((g) => ({
        name: g.name,
        time: g.time,
        size: g.playerIds.length,
        thru: Math.max(0, ...g.playerIds.map((id) => thruOf.get(id) ?? 0)),
      })),
    });
  }
  return out;
}
