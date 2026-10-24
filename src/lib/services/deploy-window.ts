import { prisma } from "@/lib/db";
import { deployWindow, type DeployWindow } from "@/lib/domain/deploy-window";
import { clubToday } from "@/lib/domain/club-clock";

/**
 * The deploy window, read from the database: every club's zone, and the
 * tournaments that might be on today somewhere — a round dated within a day
 * either side of the server's, or dates that take that in. The rule itself is
 * `domain/deploy-window.ts`. READ-ONLY: two `findMany`s, no write.
 *
 * Statuses: a tournament in draft is not being played (`playRefusal` stops a
 * card), and a completed one is over; everything between is counted.
 */
export async function currentDeployWindow(at: Date = new Date()): Promise<DeployWindow> {
  // The UTC day either side: every club's own day falls inside it (no zone is more than 14 hours from UTC).
  const day = (offset: number) => clubToday("UTC", new Date(at.getTime() + offset * 24 * 60 * 60 * 1000));
  const days = [day(-1), day(0), day(1)];
  const [clubs, events] = await Promise.all([
    prisma.organization.findMany({ select: { timeZone: true }, distinct: ["timeZone"] }),
    prisma.event.findMany({
      where: {
        status: { notIn: ["draft", "completed"] },
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
