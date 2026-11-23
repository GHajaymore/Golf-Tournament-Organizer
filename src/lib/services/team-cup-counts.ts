import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { TEAM_FORMAT_NAMES } from "@/lib/formats";

/**
 * HOW MANY ROUNDS ARE PLAYED IN A TEAM FORMAT, AND HOW MANY ARE A CUP'S SESSIONS: the one answer to "does this tournament have a
 * Teams screen / a cup", read by the Players room's tabs (`playersRoomFor`); `layout.tsx` adopts it at its next Core change, held to the same predicates by `players-room.test.tsx`. Cached for the
 * request, so asking twice costs one read.
 */
export const teamAndCupCounts = cache(async (eventId: string): Promise<{ teamRounds: number; cupRounds: number }> => {
  const [teamRounds, cupRounds] = await Promise.all([
    prisma.stage.count({ where: { eventId, format: { in: TEAM_FORMAT_NAMES } } }),
    prisma.stage.count({ where: { eventId, type: "Team Session" } }),
  ]);
  return { teamRounds, cupRounds };
});
