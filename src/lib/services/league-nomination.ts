import "server-only";
import { prisma } from "../db";
import { resolveAttendance, tracksPerRound, type AttendanceMode } from "../domain/attendance";
import { loadEventState, playingStages, settingsOf } from "./tournament";
import { roundLabel } from "../domain/round-label";
import { cleanIsoDate, shortDate } from "../domain/round-dates";
import { todayIso } from "../deadline";

/**
 * WHO A CAPTAIN HAS TO PICK FROM, AND WHO THEY HAVE ALREADY PICKED.
 *
 * THE CLUB IS A FLIGHT. A `Group` is already everything a league's club team
 * is: named, belonging to the tournament rather than to any one round, its
 * roster is `Player.groupId`, and it carries an optional `captainId` and
 * `viceCaptainId` that the organizer appoints in flights setup. Not every
 * flight has a captain and not every flight is a club — a league is simply a
 * tournament whose flights are clubs.
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
  handicapType?: string | null;
  /** ghin | manual | none — see indexLabel. A captain must not pick a pair on a figure nobody has claimed. */
  handicapSource?: string | null;
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
  /** Who the organizer appointed, if anybody. Null = no captain. */
  captainName: string;
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
    prisma.group.findFirst({
      where: { id: clubId, eventId, isCarrier: false },
      include: {
        players: { select: { id: true, name: true, handicap: true, handicapType: true, handicapSource: true } },
        captain: { select: { name: true } },
      },
    }),
    prisma.team.findMany({
      where: { eventId, stageId, clubGroupId: clubId },
      include: { members: true },
      orderBy: { seed: "asc" },
    }),
  ]);
  if (!event || !club) return null;

  const rosterIds = club.players.map((p) => p.id);

  /**
   * Availability through the round's own mode, so this screen and the player's
   * own availability card cannot disagree about what silence means.
   *
   * A tournament that does not ask the weekly question at all treats everybody
   * as available, which is the honest reading: nobody has been asked, so
   * nobody has declined.
   */
  const mode = settingsOf(event).attendanceMode as AttendanceMode;
  const tracked = tracksPerRound(mode);
  const explicit = tracked
    ? await prisma.roundAttendance.findMany({ where: { eventId, stageId } })
    : [];
  const attendance = tracked
    ? resolveAttendance(
        mode,
        rosterIds,
        explicit.map((e) => ({ playerId: e.playerId, status: e.status, decidedBy: e.decidedBy })),
      )
    : null;
  const statusOf = new Map(
    (attendance?.rows ?? []).map((r) => [
      r.playerId,
      { available: r.status === "in", answered: r.explicit },
    ]),
  );

  const pairOf = new Map<string, { id: string; name: string }>();
  for (const p of pairs) {
    for (const m of p.members) pairOf.set(m.playerId, { id: p.id, name: p.name });
  }

  const roster: NomineeRow[] = club.players.map((p) => {
    const a = statusOf.get(p.id);
    const inPair = pairOf.get(p.id);
    return {
      playerId: p.id,
      name: p.name,
      handicap: p.handicap,
      handicapType: p.handicapType,
      handicapSource: p.handicapSource,
      available: a ? a.available : true,
      answered: a ? a.answered : false,
      pairId: inPair?.id ?? "",
      pairName: inPair?.name ?? "",
    };
  });

  /**
   * Available first, then by handicap — which is the order a captain reads in.
   * Somebody who has said no is still listed, because a captain may know
   * something the app does not.
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
    captainName: club.captain?.name ?? "",
    pairs: pairs.map((p) => ({
      id: p.id,
      name: p.name,
      playerIds: p.members.map((m) => m.playerId),
    })),
    roster,
    expected: event.leaguePairs,
  };
}

export interface CaptainTeamSheet {
  /** The round the captain is picking for now. */
  round: { stageId: string; label: string; dateLabel: string };
  /** True when every round is behind us — the captain is viewing the last one. */
  seasonOver: boolean;
  /** One team sheet per flight this caller captains — usually exactly one. */
  clubs: ClubNominations[];
}

/**
 * A CAPTAIN'S OWN TEAM SHEET, for the week they are picking now.
 *
 * The read side of the captain's screen. Authorization is the same rule
 * `captainClubs` enforces on the write actions and `availabilityFor` on the
 * read view: the caller may see only a flight they captain (or deputise for)
 * AND still belong to — a captain moved out of a flight by a regroup keeps
 * neither. Returns null when the caller captains nothing here, or the event
 * doesn't run the weekly question, so the screen shows one honest empty state
 * rather than branching on three shapes of absence.
 *
 * "This week" is the first round not yet in the past — the one a captain is
 * actually choosing for. When the season is done it falls back to the last
 * round so the sheet still reads rather than vanishing.
 */
export async function captainTeamSheetFor(
  eventId: string,
  email: string,
  now: Date = new Date(),
): Promise<CaptainTeamSheet | null> {
  const state = await loadEventState(eventId);
  if (!state) return null;
  const mode = settingsOf(state.event).attendanceMode as AttendanceMode;
  if (!tracksPerRound(mode)) return null;

  const own = await prisma.player.findMany({
    where: { eventId, email: { equals: email, mode: "insensitive" }, status: "confirmed" },
    select: { id: true, groupId: true },
  });
  if (!own.length) return null;
  const ownIds = own.map((o) => o.id);

  const captained = await prisma.group.findMany({
    where: { eventId, OR: [{ captainId: { in: ownIds } }, { viceCaptainId: { in: ownIds } }] },
    select: { id: true },
  });
  // Still IN the flight they captain — the membership re-check `availability.ts`
  // documents at length: `movePlayerToGroup`/`regroup` leave `captainId` behind.
  const mine = captained.filter((g) => own.some((o) => o.groupId === g.id));
  if (!mine.length) return null;

  const rounds = playingStages(state.stages);
  if (!rounds.length) return null;
  const today = todayIso(now);
  const next = rounds.find((r) => {
    const d = cleanIsoDate(r.playedOn);
    return !d || d >= today;
  });
  const round = next ?? rounds[rounds.length - 1];
  const playedOn = cleanIsoDate(round.playedOn);

  const clubs = (
    await Promise.all(mine.map((g) => nominationsFor(eventId, round.id, g.id)))
  ).filter((c): c is ClubNominations => c !== null);

  return {
    round: {
      stageId: round.id,
      label: roundLabel(state.stages, round.id),
      dateLabel: playedOn ? shortDate(playedOn) : "",
    },
    seasonOver: !next,
    clubs,
  };
}

/**
 * The flights that are league clubs.
 *
 * A flight is a club when it has fielded a side, which is the honest test —
 * an ordinary member-guest's flights have none, so nothing here turns a
 * four-flight tournament into a league of four. Before the first nomination a
 * league has no clubs by this reading, which is why the screen falls back to
 * every flight when it is setting up.
 */
export async function clubsIn(eventId: string): Promise<{ id: string; name: string }[]> {
  const withSides = await prisma.group.findMany({
    where: { eventId, isCarrier: false, sides: { some: {} } },
    select: { id: true, name: true },
    orderBy: { position: "asc" },
  });
  return withSides;
}

/**
 * Every flight, for the screen that is still setting a league up.
 *
 * `clubsIn` answers "which flights ARE clubs", which is empty until somebody
 * nominates. This answers "which flights COULD be", and the two are different
 * questions — a captain opening an empty team sheet needs the second.
 */
export async function flightsIn(eventId: string): Promise<{ id: string; name: string }[]> {
  return prisma.group.findMany({
    where: { eventId, stageId: null, isCarrier: false },
    select: { id: true, name: true },
    orderBy: { position: "asc" },
  });
}
