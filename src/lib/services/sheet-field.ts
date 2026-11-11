import "server-only";
import { prisma } from "../db";
import { resolveAttendance, tracksPerRound, type AttendanceMode } from "../domain/attendance";
import { settingsOf } from "./tournament";
import { strokeCutField } from "./stroke-cut";

/**
 * THE FIELD OF ONE ROUND'S TEE SHEET — the one answer.
 *
 * Everyone confirmed, narrowed to the week's attendees in a league that asks
 * each week (`resolveAttendance`: a player marked out for the week is not in),
 * and then to those who made the cut once a cut has been made into the round
 * (`strokeCutField`). The Tee sheet screen draws its groups from it and
 * `moveInTeeSheet` counts a group's room against it, so the screen can never
 * offer a move the server refuses (a player marked out but still stored in a
 * group is not counted by either). `weekRows` is the week's list as the screen
 * shows it, empty where the tournament does not ask each week.
 */
export interface SheetField {
  /** Player ids in the round's field. */
  ids: Set<string>;
  /** The week's answers, one row per confirmed player; [] outside a league that asks each week. */
  weekRows: Array<{ playerId: string; name: string; status: "in" | "out"; explicit: boolean; decidedBy: string }>;
  /** How many are confirmed, before the week or a cut narrowed them. */
  rosterSize: number;
}

export async function sheetFieldFor(eventId: string, stageId: string): Promise<SheetField> {
  const [event, confirmed] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId } }),
    prisma.player.findMany({ where: { eventId, status: "confirmed" }, select: { id: true, name: true } }),
  ]);
  let ids = confirmed.map((p) => p.id);
  let weekRows: SheetField["weekRows"] = [];
  const mode = event ? (settingsOf(event).attendanceMode as AttendanceMode) : undefined;
  if (mode && tracksPerRound(mode)) {
    const explicit = await prisma.roundAttendance.findMany({ where: { eventId, stageId } });
    const resolved = resolveAttendance(
      mode,
      ids,
      explicit.map((e) => ({ playerId: e.playerId, status: e.status, decidedBy: e.decidedBy })),
    );
    const inIds = new Set(resolved.rows.filter((r) => r.status === "in").map((r) => r.playerId));
    ids = ids.filter((id) => inIds.has(id));
    const nameById = new Map(confirmed.map((p) => [p.id, p.name]));
    weekRows = resolved.rows.map((r) => ({
      playerId: r.playerId,
      name: nameById.get(r.playerId) ?? "",
      status: r.status,
      explicit: r.explicit,
      decidedBy: r.decidedBy,
    }));
  }
  // A round a cut has been made into is played by those who made it.
  const cut = await strokeCutField(eventId, stageId);
  if (cut) ids = ids.filter((id) => cut.has(id));
  return { ids: new Set(ids), weekRows, rosterSize: confirmed.length };
}
