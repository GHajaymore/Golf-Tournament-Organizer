import { prisma } from "@/lib/db";
import { deployWindow, type DeployWindow } from "@/lib/domain/deploy-window";
import { clubToday } from "@/lib/domain/club-clock";

/**
 * The deploy window, read from the database: every club's zone, and the
 * tournaments that might be on today somewhere — a round dated within a day
 * either side of the server's, or dates that take that in. The rule itself is
 * `domain/deploy-window.ts`. READ-ONLY: two `findMany`s, no write.
 *
 * Statuses: only a completed tournament is over. The three setting-up statuses
 * read as one (G1), and every one not completed is counted.
 */
export async function currentDeployWindow(at: Date = new Date()): Promise<DeployWindow> {
  // The UTC day either side: every club's own day falls inside it (no zone is more than 14 hours from UTC).
  const day = (offset: number) => clubToday("UTC", new Date(at.getTime() + offset * 24 * 60 * 60 * 1000));
  const days = [day(-1), day(0), day(1)];
  // REAL CLUBS ONLY (2026-10-24). The demo club has a tournament "on today" every day of the year,
  // and a freeze that counted it would never lift: it is in neither query (docs/claude/demo-club.md).
  const [clubs, events] = await Promise.all([
    prisma.organization.findMany({ where: { isDemo: false }, select: { timeZone: true }, distinct: ["timeZone"] }),
    prisma.event.findMany({
      where: {
        organization: { isDemo: false },
        // Every tournament not finished, set up or live (G1, 2026-10-31): the three
        // pre-launch statuses read as one, and one being played before launch (a
        // card is allowed once results exist) is a day in play. Holding a deploy
        // for a draft dated today costs an hour; deploying under a field costs more.
        status: { notIn: ["completed"] },
        OR: [
          { stages: { some: { playedOn: { in: days } } } },
          { startOn: { not: "", lte: days[2] }, OR: [{ endOn: { gte: days[0] } }, { endOn: "", startOn: { gte: days[0] } }] },
        ],
      },
      select: {
        startOn: true,
        endOn: true,
        organization: { select: { timeZone: true } },
        stages: { where: { playedOn: { in: days } }, select: { playedOn: true } },
      },
    }),
  ]);
  return deployWindow(
    at,
    clubs.map((c) => c.timeZone),
    events.map((e) => ({ timeZone: e.organization.timeZone, startOn: e.startOn, endOn: e.endOn, playedOn: e.stages.map((s) => s.playedOn) })),
  );
}
