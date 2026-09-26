import { prisma } from "@/lib/db";
import { playingStages, settingsOf } from "@/lib/services/tournament";
import {
  effectiveStatus,
  playerMayChange,
  playersAnswer,
  tracksPerRound,
  type AttendanceMode,
} from "@/lib/domain/attendance";
import { cleanIsoDate, shortDate } from "@/lib/domain/round-dates";
import { roundLabel } from "@/lib/domain/round-label";
import type { Commitment } from "@/lib/domain/club-calendar";

/**
 * EVERYTHING THIS MEMBER IS ENTERED IN, ACROSS THE WHOLE CLUB, ON DAYS.
 *
 * The club-wide calendar's data. `availabilityFor` answers the same shape of
 * question for ONE league — this gathers a member's every dated round, in
 * every tournament they hold a confirmed place in, so one screen can show a
 * member what golf they have on without opening each tournament in turn.
 *
 * ENTERED MEANS CONFIRMED, the rule `myPlayerIds` and every card guard use: a
 * commitment is a place in a field, and a waitlisted applicant does not have
 * one yet. Resolved by email against the Player rows, the same linkage
 * `availabilityFor` and the score-entry guards use.
 *
 * TOURNAMENTS, NOT CASUAL ROUNDS — the same `shape != "match"`, `expiresAt:
 * null` pair `clubEventsFor` draws, and for the same reason (`round-expiry.ts`,
 * Ajay 2026-09-19): a Sunday fourball is stored as an Event but is not one of
 * the club's fixtures, and it should not sit on the member's club calendar
 * beside the Club Championship.
 *
 * Dates are FORMATTED here, server-side, exactly as `availabilityFor` does it:
 * a round is a calendar day, and a browser asked to format one will
 * occasionally disagree with the server about which day it is.
 */
export async function clubCommitmentsFor(
  email: string,
  now: Date = new Date(),
): Promise<Commitment[]> {
  /**
   * The member's confirmed places, in real tournaments only.
   *
   * One query, filtered on the event's own shape so a casual round never
   * reaches the rest of the work. `email` is matched case-insensitively, the
   * same as every other by-email resolution in the app.
   */
  const places = await prisma.player.findMany({
    where: {
      email: { equals: email, mode: "insensitive" },
      status: "confirmed",
      event: { shape: { not: "match" }, expiresAt: null },
    },
    select: { id: true, eventId: true },
  });
  if (places.length === 0) return [];

  const playerByEvent = new Map(places.map((p) => [p.eventId, p.id]));
  const eventIds = [...playerByEvent.keys()];

  const [events, attendance] = await Promise.all([
    prisma.event.findMany({
      where: { id: { in: eventIds } },
      // In play order: the rounds are numbered off this list (`roundLabel`).
      include: { stages: { orderBy: { position: "asc" } } },
    }),
    prisma.roundAttendance.findMany({
      where: { eventId: { in: eventIds }, playerId: { in: places.map((p) => p.id) } },
      select: { stageId: true, playerId: true, status: true },
    }),
  ]);

  // (stageId, playerId) -> explicit answer, for one lookup per round.
  const answerByStage = new Map(
    attendance.map((a) => [`${a.stageId}:${a.playerId}`, a.status]),
  );

  const out: Commitment[] = [];
  for (const event of events) {
    const playerId = playerByEvent.get(event.id);
    if (!playerId) continue;
    const mode = settingsOf(event).attendanceMode as AttendanceMode;
    const tracked = tracksPerRound(mode);
    const asks = playersAnswer(mode);
    const playing = playingStages(event.stages);
    // Only number the rounds when there is more than one to tell apart. A
    // single-round medal reads "Spring Medal", not "Spring Medal · Round 1".
    const numbered = playing.length > 1;

    for (const stage of playing) {
      /**
       * When it is played.
       *
       * The stage's own day, or — for a tournament with no weekly question and
       * so no per-round dating — the event's start, so a single-day medal lands
       * on the calendar rather than in the undated list. A LEAGUE round with no
       * date stays undated deliberately: piling a season's rounds onto its
       * start day would be a worse lie than leaving them in the list, which is
       * the sibling calendar's own reading of an undated season.
       */
      const playedOn =
        cleanIsoDate(stage.playedOn) || (tracked ? "" : cleanIsoDate(event.startOn));

      const chosenRaw = answerByStage.get(`${stage.id}:${playerId}`);
      const chosen =
        chosenRaw === "in" || chosenRaw === "out" ? (chosenRaw as "in" | "out") : null;

      let status: "in" | "out";
      let explicit: boolean;
      let locked: boolean;
      let canAnswer: boolean;

      if (!tracked) {
        // Everyone plays every round: a firm commitment because they entered,
        // no weekly question to answer.
        status = "in";
        explicit = true;
        locked = false;
        canAnswer = false;
      } else {
        status = effectiveStatus(mode, chosen);
        explicit = chosen !== null;
        if (asks) {
          // A league that asks the player: answerable here until its deadline,
          // and after that it reads as a settled fact.
          canAnswer = playerMayChange(stage.optDeadline, now);
          locked = !canAnswer;
        } else {
          // Captains: the club holds the answer; the member reads it, never
          // sets it. See `setOwnAttendance` refusing the same at the endpoint.
          canAnswer = false;
          locked = true;
        }
      }

      out.push({
        eventId: event.id,
        eventName: event.name,
        stageId: stage.id,
        roundLabel: numbered ? roundLabel(event.stages, stage.id) : "",
        playedOn,
        dateLabel: playedOn ? shortDate(playedOn) : "",
        status,
        explicit,
        locked,
        canAnswer,
      });
    }
  }

  return out;
}
