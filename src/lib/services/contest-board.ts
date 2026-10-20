import { prisma } from "@/lib/db";
import { contestTitle, shownOnBoard, sponsorsToThank } from "@/lib/domain/contest-board";

export interface ContestBoardLine {
  id: string;
  /** "Closest to the pin · 7th". */
  title: string;
  /** Who won it, by name; empty until the committee names somebody. */
  winners: string[];
  sponsorName: string;
  sponsorUrl: string;
}

/**
 * THE CONTESTS A CLUB ANNOUNCES, ONE READER (2026-10-17).
 *
 * The public board and the printed results both say who won the closest to
 * the pin and the long drive, and who sponsors them. One function answers it,
 * so the sheet pinned to the noticeboard and the link sent to members cannot
 * disagree. `stageId` null is every round (a cup's all-sessions board); a
 * round's id is that round and the whole outing's. Names only: no stake, no
 * pot.
 */
export async function contestBoard(
  eventId: string,
  stageId: string | null,
): Promise<{ lines: ContestBoardLine[]; thanks: Array<{ name: string; url: string }> }> {
  const contests = (
    await prisma.contest.findMany({
      where: { eventId, ...(stageId === null ? {} : { stageId: { in: ["", stageId] } }) },
      orderBy: { createdAt: "asc" },
      select: { id: true, kind: true, name: true, hole: true, sponsorName: true, sponsorUrl: true, entrants: { where: { won: true }, select: { playerId: true } } },
    })
  ).filter((c) => shownOnBoard(c.kind));
  if (contests.length === 0) return { lines: [], thanks: [] };

  const winnerIds = [...new Set(contests.flatMap((c) => c.entrants.map((e) => e.playerId)))];
  const names = new Map(
    (await prisma.player.findMany({ where: { eventId, id: { in: winnerIds } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]),
  );
  return {
    lines: contests.map((c) => ({
      id: c.id,
      title: contestTitle(c),
      winners: c.entrants.map((e) => names.get(e.playerId)).filter((n): n is string => !!n),
      sponsorName: c.sponsorName,
      sponsorUrl: c.sponsorUrl,
    })),
    thanks: sponsorsToThank(contests),
  };
}
