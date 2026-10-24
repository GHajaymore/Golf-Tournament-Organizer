"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/services/action-shared";
import { boardChanged } from "@/lib/services/board-refresh";
import { REPORT_AMOUNTS, REPORT_VISIBILITY, reportAmountsOf, reportVisibilityOf } from "@/lib/domain/report-settings";

/**
 * THE REPORT'S SETTINGS, AND A PLAYER'S PUBLIC NAME (2026-10-24) — see
 * `domain/report-settings.ts` for the rules.
 *
 * Staff only, and NOT behind the setup lock: who may read the report and
 * whether a member's name is printed on a public page are decided after the
 * day as often as before it. Every value a caller sends is checked against
 * the lists here — a `"use server"` export is a public endpoint — and a
 * player's id is narrowed to this event.
 */

type Result = { ok: boolean; error?: string };

async function requireStaffEvent(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") {
    throw new Error("Only an organizer or assistant can do that");
  }
  return session.eventId;
}

function refresh(eventId: string) {
  revalidatePath("/reports/final");
  revalidatePath("/live", "layout");
  boardChanged(eventId);
}

/** Who may open the report's link, and who sees side-game amounts on it. */
export async function setReportSettings(visibility: string, amounts: string): Promise<Result> {
  const eventId = await requireStaffEvent();
  if (!(REPORT_VISIBILITY as readonly string[]).includes(visibility) || !(REPORT_AMOUNTS as readonly string[]).includes(amounts)) {
    return { ok: false, error: "Choose who can see the report and who sees the amounts." };
  }
  const v = reportVisibilityOf(visibility);
  const a = reportAmountsOf(amounts);
  await prisma.event.update({ where: { id: eventId }, data: { reportVisibility: v, reportAmounts: a } });
  await logAudit(eventId, "report.settings", `Report: ${v === "board" ? "anyone with the board link" : "players in this tournament"}; amounts: ${a}`);
  refresh(eventId);
  return { ok: true };
}

/** "Don't show my name on public pages", on a player's entry. */
export async function setNameWithheld(playerId: string, withheld: boolean): Promise<Result> {
  const eventId = await requireStaffEvent();
  const player = await prisma.player.findFirst({ where: { id: String(playerId), eventId }, select: { id: true, name: true } });
  if (!player) return { ok: false, error: "That player isn't in this tournament." };
  await prisma.player.update({ where: { id: player.id }, data: { publicNameWithheld: withheld === true } });
  await logAudit(eventId, "player.public-name", `${player.name}: ${withheld === true ? "name withheld on public pages" : "name shown on public pages"}`);
  refresh(eventId);
  return { ok: true };
}
