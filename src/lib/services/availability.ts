import { prisma } from "@/lib/db";
import { playingStages, settingsOf, type EventState } from "@/lib/services/tournament";
import {
  effectiveStatus,
  playerMayChange,
  resolveAttendance,
  type AttendanceMode,
} from "@/lib/domain/attendance";
import { cleanIsoDate, relativeDay, shortDate } from "@/lib/domain/round-dates";
import { todayIso } from "@/lib/deadline";

/**
 * "Am I playing, and when?" — assembled once, for every screen that asks.
 *
 * This lived inside the dashboard page, which had two consequences. The small
 * one is duplication. The large one is that the player shell could not show it
 * at all: players land on /me (see landingScreenFor), so the weekly sign-up
 * question — a feature whose entire audience is players — sat on the one screen
 * players are routed away from. Moving it here is what makes it reachable.
 *
 * Dates are resolved and FORMATTED here, on the server, rather than in the
 * client component. A round is a calendar day, and a browser asked to format
 * one is a browser that will occasionally disagree with the server about which
 * day it is — either through its locale or its timezone. Formatting once,
 * server-side, removes the question.
 */

export interface AvailabilityRound {
  stageId: string;
  /** "Round 3" — the league's own numbering, in season order. */
  label: string;
  /** The day it is played, ISO, or "" when the round has no fixed day. */
  playedOn: string;
  /** "Tue 19 May", or "" when there is no date to show. */
  dateLabel: string;
  /** "Today" / "Tomorrow" / "in 5 days", or "" past a fortnight. */
  whenLabel: string;
  /** Last day to change the answer, ISO, or "" for an open window. */
  optDeadline: string;
  /** The same deadline in words, ready to print. */
  deadlineLabel: string;
  /** The signed-in player's effective answer. */
  status: "in" | "out";
  /** Whether that answer was stated, or is the league's default. */
  explicit: boolean;
  /** True once the window has closed for players. */
  locked: boolean;
}

export interface CaptainFlightCell {
  stageId: string;
  status: "in" | "out";
  /** Whether that answer was stated, or is the league's default. */
  explicit: boolean;
}

export interface CaptainFlightRow {
  playerId: string;
  name: string;
  /** One cell per round, in the same order as the flight's `rounds`. */
  cells: CaptainFlightCell[];
}

/**
 * A flight a player captains, across every round still to be played.
 *
 * Read-only by design. Captains do not set other players' availability; that
 * stays with the organizer, from whatever the captain tells them.
 */
export interface CaptainFlight {
  flightName: string;
  rounds: { stageId: string; label: string }[];
  rows: CaptainFlightRow[];
  /** True when this player deputises rather than captains. */
  deputy?: boolean;
}

export interface AvailabilityView {
  /** "" when this session maps to no player in this event. */
  playerId: string;
  /**
   * The round to answer for now — the first that has not already been played.
   *
   * Null only when every round is behind us. A round played TODAY is still
   * "next", not past: someone deciding at breakfast whether they can make
   * tonight is the exact person this question exists for.
   */
  next: AvailabilityRound | null;
  /** Everything after that, in season order. */
  future: AvailabilityRound[];
  /** Rounds whose day has gone. Kept, because what you answered is a record. */
  past: AvailabilityRound[];
  captainOf: CaptainFlight[];
}

const EMPTY: AvailabilityView = { playerId: "", next: null, future: [], past: [], captainOf: [] };

/**
 * Split the season around today.
 *
 * Order is the league's round order, not date order. A rained-off week moved to
 * the end of the season is still Round 4, and renumbering it under the player
 * would be a lie about which round they are answering for.
 */
export function splitBySchedule(
  rounds: AvailabilityRound[],
  now: Date = new Date(),
): Pick<AvailabilityView, "next" | "future" | "past"> {
  const today = todayIso(now);
  const past: AvailabilityRound[] = [];
  const ahead: AvailabilityRound[] = [];
  for (const r of rounds) {
    // No date means no way to know it has gone, so it stays ahead. Guessing
    // would hide a round a player still has to answer for.
    if (r.playedOn && r.playedOn < today) past.push(r);
    else ahead.push(r);
  }
  return { next: ahead[0] ?? null, future: ahead.slice(1), past };
}

/**
 * The weekly sign-up picture for one signed-in person.
 *
 * Returns an empty view — not null — when the league doesn't ask the question
 * or the session isn't a player, so callers render nothing without branching on
 * three different shapes of absence.
 */
export async function availabilityFor(
  state: EventState,
  email: string,
  now: Date = new Date(),
): Promise<AvailabilityView> {
  const mode = settingsOf(state.event).attendanceMode as AttendanceMode;
  if (mode === "everyone") return EMPTY;

  const own = await prisma.player.findMany({
    where: {
      eventId: state.event.id,
      email: { equals: email, mode: "insensitive" },
      status: "confirmed",
    },
    select: { id: true, groupId: true },
  });
  const playerId = own[0]?.id ?? "";
  if (!playerId) return EMPTY;

  const leagueRounds = playingStages(state.stages);
  const explicit = await prisma.roundAttendance.findMany({
    where: { eventId: state.event.id, stageId: { in: leagueRounds.map((r) => r.id) } },
  });

  const today = todayIso(now);
  const rounds: AvailabilityRound[] = leagueRounds.map((r, i) => {
    const mine = explicit.find((e) => e.stageId === r.id && e.playerId === playerId);
    const chosen = mine && (mine.status === "in" || mine.status === "out") ? (mine.status as "in" | "out") : null;
    const playedOn = cleanIsoDate(r.playedOn);
    const optDeadline = cleanIsoDate(r.optDeadline);
    const locked = !playerMayChange(r.optDeadline, now);
    return {
      stageId: r.id,
      label: `Round ${i + 1}`,
      playedOn,
      dateLabel: playedOn ? shortDate(playedOn) : "",
      whenLabel: playedOn ? relativeDay(playedOn, today) : "",
      optDeadline,
      deadlineLabel: locked
        ? "Sign-up closed"
        : optDeadline
          ? `Answer by ${shortDate(optDeadline)}`
          : "Open",
      status: effectiveStatus(mode, chosen),
      explicit: chosen !== null,
      locked,
    };
  });

  return {
    playerId,
    ...splitBySchedule(rounds, now),
    captainOf: await captainFlightsFor(state, mode, own.map((o) => o.id), leagueRounds, explicit),
  };
}

/** The flights this player captains or deputises for, across the whole season. */
async function captainFlightsFor(
  state: EventState,
  mode: AttendanceMode,
  ownIds: string[],
  leagueRounds: EventState["stages"],
  explicit: { stageId: string; playerId: string; status: string; decidedBy: string }[],
): Promise<CaptainFlight[]> {
  const captained = await prisma.group.findMany({
    where: {
      eventId: state.event.id,
      OR: [{ captainId: { in: ownIds } }, { viceCaptainId: { in: ownIds } }],
    },
    select: { id: true, name: true, captainId: true },
  });
  if (!captained.length) return [];

  const roundCols = leagueRounds.map((r, i) => ({ stageId: r.id, label: `R${i + 1}` }));
  // Resolve each round once for the whole field rather than per flight, so a
  // twelve-flight league doesn't repeat the work twelve times.
  const resolvedByStage = new Map(
    leagueRounds.map((r) => [
      r.id,
      resolveAttendance(
        mode,
        state.confirmed.map((p) => p.id),
        explicit
          .filter((e) => e.stageId === r.id)
          .map((e) => ({ playerId: e.playerId, status: e.status, decidedBy: e.decidedBy })),
      ),
    ]),
  );

  return captained.map((g) => {
    const members = state.confirmed.filter((pl) => pl.groupId === g.id);
    return {
      flightName: g.name,
      deputy: !ownIds.includes(g.captainId ?? ""),
      rounds: roundCols,
      rows: members.map((m) => ({
        playerId: m.id,
        name: m.name,
        cells: leagueRounds.map((r) => {
          const row = resolvedByStage.get(r.id)?.rows.find((x) => x.playerId === m.id);
          return { stageId: r.id, status: row?.status ?? "out", explicit: row?.explicit ?? false };
        }),
      })),
    };
  });
}
