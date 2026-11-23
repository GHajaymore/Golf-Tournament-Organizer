import "server-only";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { TEAM_FORMAT_NAMES } from "@/lib/formats";
import { playerTabsFor, type PlayerTab } from "@/lib/domain/players-tabs";
import { screensShownFor } from "@/lib/services/screens-shown";

/**
 * THE PLAYERS ROOM, FOR THIS REQUEST (R6): null while Players is not shown (the old pages draw themselves,
 * unchanged), or for anybody who is not staff (a player's doors are not moved); otherwise the tabs the
 * tournament lists and the preview query its links carry. The facts are the sidebar's own (`layout.tsx`).
 */
export interface PlayersRoom {
  tabs: PlayerTab[];
  search: string;
}

export async function playersRoomFor(session: { email: string; eventId: string; viewRole: string }): Promise<PlayersRoom | null> {
  if (session.viewRole !== "admin" && session.viewRole !== "assistant") return null;
  const shown = await screensShownFor(session);
  if (!shown.has("players")) return null;
  const [teamRounds, cupRounds] = await Promise.all([
    prisma.stage.count({ where: { eventId: session.eventId, format: { in: TEAM_FORMAT_NAMES } } }),
    prisma.stage.count({ where: { eventId: session.eventId, type: "Team Session" } }),
  ]);
  const asked = await headers();
  return { tabs: playerTabsFor({ hasTeamRound: teamRounds > 0, hasCup: cupRounds > 0 }), search: asked.get("x-search") ?? "" };
}
