"use server";
import { getSession, type Session } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { settingsOf } from "@/lib/services/tournament";
import { playerMayChange, playersAnswer, tracksPerRound, type AttendanceMode } from "@/lib/domain/attendance";
import { isIsoDate } from "@/lib/deadline";

/**
 * League attendance actions.
 *
 * Every export here is a public HTTP endpoint. The rules, stated once:
 *
 *  - A player answers for themself. The link from a session to "themself" is
 *    the registration email, the same linkage the score-entry guards use.
 *  - The opt deadline binds players, never staff — the organizer marking a
 *    Wednesday-morning no-show is who the freeze protects, not obstructs.
 *  - Captains read; they do not write. Seeing your flight's list is an
 *    appointment; changing someone's answer stays between the player and
 *    the committee.
 */

export interface AttendanceResult {
  ok: boolean;
  error?: string;
}

async function requireStaffSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") {
    throw new Error("Organizer access required");
  }
  return session;
}

/** The Player rows this signed-in person is, in this event — by email. */
async function ownPlayerIds(eventId: string, email: string): Promise<Set<string>> {
  const rows = await prisma.player.findMany({
    where: { eventId, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/**
 * Set one player's in/out for one round.
 *
 * Players set their own, until the round's opt deadline. Staff set anyone's,
 * any time — and the row records who decided, because "why am I not playing
 * this week" has to have a name in the answer.
 */
export async function setAttendance(
  stageId: string,
  playerId: string,
  status: string,
): Promise<AttendanceResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };
  const isStaff = session.role === "admin" || session.role === "assistant";

  if (status !== "in" && status !== "out") return { ok: false, error: "In or out — nothing else." };

  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId: session.eventId },
    select: { id: true, optDeadline: true, eventId: true },
  });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };

  const event = await prisma.event.findUnique({ where: { id: session.eventId } });
  if (!event) return { ok: false, error: "Tournament not found." };
  const mode = settingsOf(event).attendanceMode as AttendanceMode;
  if (!tracksPerRound(mode)) {
    return { ok: false, error: "This tournament doesn't use weekly sign-up — everyone plays every round." };
  }

  /**
   * Under `captains`, only staff record attendance.
   *
   * Enforced HERE and not only by hiding the player's screen. A "use server"
   * export is a public HTTP endpoint, so a player whose UI never offers the
   * question can still call this — and if it were allowed, a player could mark
   * themselves in against the list their captain sent, leaving the club with
   * two answers and no way to tell which was meant.
   */
  if (!isStaff && !playersAnswer(mode)) {
    return {
      ok: false,
      error: "Your captain sends the pairs to the club and the club records them — ask your captain to include you.",
    };
  }

  if (!isStaff) {
    const own = await ownPlayerIds(session.eventId, session.email);
    if (!own.has(playerId)) return { ok: false, error: "You can only answer for yourself." };
    if (!playerMayChange(stage.optDeadline)) {
      return {
        ok: false,
        error: "The sign-up window for this round has closed — ask the organizer to change it.",
      };
    }
  }

  // The player must actually be in this tournament's field, whoever is asking.
  const player = await prisma.player.findFirst({
    where: { id: playerId, eventId: session.eventId },
    select: { id: true },
  });
  if (!player) return { ok: false, error: "Player not found in this tournament." };

  await prisma.roundAttendance.upsert({
    where: { stageId_playerId: { stageId, playerId } },
    update: { status, decidedAt: new Date(), decidedBy: session.name },
    create: { eventId: session.eventId, stageId, playerId, status, decidedBy: session.name },
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * The last day a player may change their answer for a round.
 *
 * Deliberately not behind the setup lock: a league is live for months, and
 * moving next week's deadline is Tuesday-night operations, not tournament
 * restructuring.
 */
export async function setStageOptDeadline(stageId: string, date: string): Promise<AttendanceResult> {
  const session = await requireStaffSession();
  const clean = date.trim();
  if (clean !== "" && !isIsoDate(clean)) {
    return { ok: false, error: "Pick a date, or clear it to leave the window open." };
  }
  const updated = await prisma.stage.updateMany({
    where: { id: stageId, eventId: session.eventId },
    data: { optDeadline: clean },
  });
  if (updated.count === 0) return { ok: false, error: "That round isn't in this tournament." };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Appoint (or clear) a flight's captain.
 *
 * The captain must be a member of the flight — a captain of a flight they
 * are not in could read a list they have no standing over, which is the
 * exact thing the captaincy exists to scope.
 */
export async function setFlightCaptain(
  groupId: string,
  playerId: string | null,
  role: "captain" | "vice" = "captain",
): Promise<AttendanceResult> {
  const session = await requireStaffSession();

  const group = await prisma.group.findFirst({
    where: { id: groupId, eventId: session.eventId },
    select: { id: true },
  });
  if (!group) return { ok: false, error: "Flight not found." };

  if (playerId !== null) {
    const member = await prisma.player.findFirst({
      where: { id: playerId, eventId: session.eventId, groupId },
      select: { id: true },
    });
    if (!member) return { ok: false, error: "The captain has to be a member of the flight." };
  }

  await prisma.group.update({
    where: { id: groupId },
    data: role === "vice" ? { viceCaptainId: playerId } : { captainId: playerId },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
