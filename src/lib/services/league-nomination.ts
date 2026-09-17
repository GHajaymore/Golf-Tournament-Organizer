import "server-only";
import { prisma } from "../db";
import { resolveAttendance, tracksPerRound, type AttendanceMode } from "../domain/attendance";
import { settingsOf } from "./tournament";

/**
 * WHO A CAPTAIN HAS TO PICK FROM, AND WHO THEY HAVE ALREADY PICKED.
 *
 * A club team holds a roster of ten or more and nominates pairs for a week.
 * This is the screen behind that: every player on the roster, whether they
 * said they were available, and which pair they are already in.
 *
 * AVAILABILITY AND SELECTION ARE TWO QUESTIONS AND STAY IN TWO PLACES.
 * `RoundAttendance` is the PLAYER's answer to "am I around on Thursday";
 * nomination is the CAPTAIN's answer to "are you playing, and with whom".
 * Putting the second in the column that holds the first would lose the state a
 * captain most needs — available but not picked — and, under the `captains`
 * mode, would reopen the contradiction that mode exists to prevent: "nothing a
 * player does can contradict the list their captain sent".
 *
 * So availability INFORMS the choice and never gates it. A captain who wants
 * somebody who has not answered can still pick them; the screen says what is
 * known rather than refusing on it.
 */

export interface NomineeRow {
  playerId: string;
  name: string;
  handicap: number;
  /**
   * What the player said, resolved through the round's attendance mode — so an
   * opt-out league reads silence as "in" and an opt-in one reads it as "out",
   * exactly as every other screen does.
   */
  available: boolean;
  /** Whether they actually said so, as against the mode assuming it. */
  answered: boolean;
  /** The pair they are already in this week, or "" if they are unpicked. */
  pairId: string;
  pairName: string;
}

export interface ClubNominations {
  clubId: string;
  clubName: string;
  /** This week's pairs, in the order they were made. */
  pairs: { id: string; name: string; playerIds: string[] }[];
  /** The whole roster, available first. */
  roster: NomineeRow[];
  /** How many pairs the league expects, or 0 when nobody has said. */
  expected: number;
}

export async function nominationsFor(
  eventId: string,
  stageId: string,
  clubId: string,
): Promise<ClubNominations | null> {
  const [event, club, pairs] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId } }),
    prisma.team.findUnique({
      where: { id: clubId },
      include: { members: true },
    }),
    prisma.team.findMany({
      where: { eventId, stageId, parentTeamId: clubId },
      include: { members: true },
      orderBy: { seed: "asc" },
    }),
  ]);
  if (!event || !club || club.eventId !== eventId) return null;

  const rosterIds = club.members.map((m) => m.playerId);
  const players = await prisma.player.findMany({
    where: { id: { in: rosterIds } },
    select: { id: true, name: true, handicap: true },
  });
  const byId = new Map(players.map((p) => [p.id, p]));

  /**
   * Availability through the round's own mode, so this screen and the player's
   * own availability card cannot disagree about what silence means.
   *
   * A tournament that does not ask the weekly question at all treats everybody
   * as available, which is the honest reading: nobody has been asked, so
   * nobody has declined.
   */
  const mode = settingsOf(event).attendanceMode as AttendanceMode;
  const explicit = tracksPerRound(mode)
    ? await prisma.roundAttendance.findMany({ where: { eventId, stageId } })
    : [];
  const attendance = tracksPerRound(mode)
    ? resolveAttendance(
        mode,
        rosterIds,
        explicit.map((e) => ({ playerId: e.playerId, status: e.status, decidedBy: e.decidedBy })),
      )
    : null;
  const statusOf = new Map(
    (attendance?.rows ?? []).map((r) => [r.playerId, { available: r.status === "in", answered: r.explicit }]),
  );

  const pairOf = new Map<string, { id: string; name: string }>();
  for (const p of pairs) {
    for (const m of p.members) pairOf.set(m.playerId, { id: p.id, name: p.name });
  }

  const roster: NomineeRow[] = rosterIds.map((playerId) => {
    const p = byId.get(playerId);
    const a = statusOf.get(playerId);
    const inPair = pairOf.get(playerId);
    return {
      playerId,
      name: p?.name ?? "Unknown",
      handicap: p?.handicap ?? 0,
      available: a ? a.available : true,
      answered: a ? a.answered : false,
      pairId: inPair?.id ?? "",
      pairName: inPair?.name ?? "",
    };
  });

  /**
   * Available first, then by handicap — which is the order a captain reads in.
   * The people who can play are the ones being chosen between; somebody who
   * has said no is still listed, because a captain may know something the app
   * does not.
   */
  roster.sort(
    (a, b) =>
      Number(b.available) - Number(a.available) ||
      a.handicap - b.handicap ||
      a.name.localeCompare(b.name),
  );

  return {
    clubId: club.id,
    clubName: club.name,
    pairs: pairs.map((p) => ({
      id: p.id,
      name: p.name,
      playerIds: p.members.map((m) => m.playerId),
    })),
    roster,
    expected: event.leaguePairs,
  };
}

/**
 * Every club in this league, for the picker at the top of the screen.
 *
 * A club team is one with no stage: it plays no single round, it holds the
 * roster the weekly pairs are nominated from.
 */
export async function clubsIn(eventId: string): Promise<{ id: string; name: string }[]> {
  return prisma.team.findMany({
    where: { eventId, stageId: null },
    select: { id: true, name: true },
    orderBy: { seed: "asc" },
  });
}
