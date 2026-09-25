"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/services/action-shared";
import { isLeaguePointsSystem } from "@/lib/domain/league-meeting";
import { drawMeeting, leagueWeekMeetings } from "@/lib/domain/league-draw";
import { isLeaguePlayoffSize } from "@/lib/domain/league-playoff";
import { matchCarrierGroup } from "@/lib/services/match-carrier";
import { boardChanged } from "@/lib/services/board-refresh";
import { needsTeams } from "@/lib/formats";
import { holesPlayed } from "@/lib/domain/handicap";
import { leagueMeetings, leaguePlayoffs, leagueSeason } from "@/lib/services/league";
import { settingsOf } from "@/lib/services/tournament";
import { tracksPerRound, type AttendanceMode } from "@/lib/domain/attendance";

/**
 * Organizer or assistant, on the active tournament.
 *
 * Every export in a "use server" file is a public HTTP endpoint, so each
 * action below calls this first — hiding a screen in the sidebar stops nobody
 * from posting to these directly. Same shape as `teams.ts`, which states the
 * rule at length.
 */
async function requireStaff(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") {
    throw new Error("Organizer access required");
  }
  return session.eventId;
}

/**
 * The clubs this caller captains, and STILL belongs to.
 *
 * A captain is appointed per flight (`Group.captainId` / `viceCaptainId`) and
 * is a player like any other — there is no `captain` role. So a captain-facing
 * action authorizes from the flight, not the active-event cookie: the caller is
 * whoever `session.email` resolves to, and they may act only on a flight they
 * captain AND are still a member of. That membership re-check is the same one
 * `availability.ts` documents at length — `movePlayerToGroup` and `regroup`
 * both leave `captainId` behind, so a captain moved out of a flight must not
 * keep authority over it.
 *
 * Returns a map of clubId → the event that club is in, so a caller-supplied
 * club or pair id is checked against a set derived from `session.email` rather
 * than trusted. `audit-idor` accepts exactly that: a `.has(clubId)` membership
 * test, or an id in a `where` that also carries the event this map yields.
 */
async function captainClubs(): Promise<Map<string, string>> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  const rows = await prisma.player.findMany({
    where: {
      email: { equals: session.email, mode: "insensitive" },
      status: "confirmed",
      OR: [{ captainOf: { some: {} } }, { viceCaptainOf: { some: {} } }],
    },
    select: {
      eventId: true,
      groupId: true,
      captainOf: { select: { id: true } },
      viceCaptainOf: { select: { id: true } },
    },
  });
  const clubs = new Map<string, string>();
  for (const r of rows) {
    // Still in the flight they captain — a captain moved out keeps neither the
    // panel nor the authority.
    for (const g of [...r.captainOf, ...r.viceCaptainOf]) {
      if (g.id === r.groupId) clubs.set(g.id, r.eventId);
    }
  }
  return clubs;
}

/**
 * Whether a club's event runs the weekly attendance question at all.
 *
 * Team selection is a league feature: an ordinary tournament has no rounds to
 * pick a side for week by week. `everyone` mode is the switch turned off, so a
 * captain action refuses there even if a stray flight carried a captain.
 */
async function eventTracksAttendance(eventId: string): Promise<boolean> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  return !!event && tracksPerRound(settingsOf(event).attendanceMode as AttendanceMode);
}

/**
 * NOMINATING A PAIR FOR A WEEK.
 *
 * A club team holds the roster; each week it puts up pairs, and a pair is an
 * ordinary `Team` on that week's round with `clubGroupId` pointing at the
 * flight that is the club. Nothing else about the app changes — the pair is scored as the
 * four-ball side it is.
 *
 * SELECTION IS NOT AVAILABILITY. `RoundAttendance` stays the player's answer to
 * "am I around"; this is the captain's answer to "are you playing, and with
 * whom". Writing one into the other would lose "available but not picked" and,
 * under the `captains` attendance mode, would reopen the very contradiction
 * that mode exists to prevent.
 */

export type LeagueResult = { ok: true } | { ok: false; error: string };

/**
 * The club is a FLIGHT — see `Team.clubGroupId`. A `Group` is already named,
 * belongs to the tournament rather than a round, holds its roster through
 * `Player.groupId`, and carries the optional captain the organizer appoints in
 * flights setup.
 */
async function clubInEvent(eventId: string, clubId: string) {
  return prisma.group.findFirst({
    where: { id: clubId, eventId, isCarrier: false },
    select: { id: true, name: true },
  });
}

/**
 * Put two players up as a pair for one round.
 *
 * Refuses rather than repairs. Every check here is a thing a captain can see
 * and fix on the screen they are already on, and a nomination that silently
 * corrected itself would be a lineup nobody chose.
 */
export async function nominatePair(
  stageId: string,
  clubId: string,
  playerIds: string[],
): Promise<LeagueResult> {
  const eventId = await requireStaff();
  return nominatePairInEvent(eventId, stageId, clubId, playerIds);
}

/**
 * The same nomination, for a CAPTAIN acting on their own club.
 *
 * `captainClubs` maps every flight this caller captains-and-belongs-to to its
 * event, so `clubId` is checked against a set derived from `session.email`
 * (never the active-event cookie) and the event is taken from that map. The
 * validation is then byte-identical to the organizer's — a captain is a
 * convenience layer over the same public endpoint, not a second set of rules.
 */
export async function captainNominatePair(
  stageId: string,
  clubId: string,
  playerIds: string[],
): Promise<LeagueResult> {
  const clubs = await captainClubs();
  const eventId = clubs.get(clubId);
  if (!eventId) return { ok: false, error: "You don't captain that team." };
  if (!(await eventTracksAttendance(eventId))) {
    return { ok: false, error: "Team selection isn't enabled for this tournament." };
  }
  return nominatePairInEvent(eventId, stageId, clubId, playerIds);
}

/**
 * The nomination itself, once the caller's authority over `eventId` is settled.
 *
 * Extracted so the organizer path and the captain path share one set of rules
 * — on the roster, not already out this week, both in this tournament — rather
 * than drifting into two. `eventId` arrives already tied to the caller (staff's
 * active event, or a club the caller captains), and every id below is narrowed
 * through it, so the rows this works from are always the caller's own.
 */
async function nominatePairInEvent(
  eventId: string,
  stageId: string,
  clubId: string,
  playerIds: string[],
): Promise<LeagueResult> {
  const club = await clubInEvent(eventId, clubId);
  if (!club) return { ok: false, error: "That club is not in this league." };

  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId },
    select: { id: true },
  });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };

  /**
   * NARROWED TO THIS TOURNAMENT BEFORE IT IS USED FOR ANYTHING.
   *
   * `playerIds` is whatever the caller sent — every export in a "use server"
   * file is a public HTTP endpoint — so it is looked up scoped to `eventId`
   * and everything downstream works from the ROWS THAT CAME BACK rather than
   * from the argument.
   *
   * The roster check below would catch a foreign id transitively, because a
   * club's roster is made of teams in this event. `audit-idor.test.ts` refuses
   * that and is right to: narrowing through two joins is a property of code
   * somewhere else, and the action that receives an id is the place that has
   * to tie it to the caller's scope.
   */
  const inEvent = await prisma.player.findMany({
    where: { eventId, id: { in: playerIds } },
    select: { id: true },
  });
  const clean = [...new Set(inEvent.map((p) => p.id))];
  if (clean.length !== 2) {
    return {
      ok: false,
      error:
        inEvent.length === playerIds.length
          ? "A pair is two players."
          : "Those players aren't in this tournament.",
    };
  }

  /**
   * ON THIS CLUB'S ROSTER, which for a flight is `Player.groupId`.
   *
   * Without it a captain could nominate a player from the club they are about
   * to play, which is a lineup no league would recognise — and the check has
   * to be against the CLUB rather than the event, because everybody in a
   * league is in the same event.
   *
   * Same rule `setFlightCaptain` already enforces for appointing one: "the
   * captain has to be a member of the flight".
   */
  const onRoster = await prisma.player.findMany({
    where: { id: { in: clean }, groupId: clubId },
    select: { id: true },
  });
  if (onRoster.length !== clean.length) {
    return { ok: false, error: `Both players must be in ${club.name}.` };
  }

  /**
   * NOT ALREADY OUT THIS WEEK. A player in two pairs on one night is somebody
   * playing two matches at once, and it is the mistake a captain makes at
   * speed on a Thursday afternoon.
   */
  const already = await prisma.teamMember.findFirst({
    where: {
      playerId: { in: clean },
      team: { eventId, stageId, clubGroupId: { not: null } },
    },
    select: { playerId: true },
  });
  if (already) {
    const name = await prisma.player.findUnique({
      where: { id: already.playerId },
      select: { name: true },
    });
    return {
      ok: false,
      error: `${name?.name ?? "That player"} is already in a pair this week.`,
    };
  }

  const players = await prisma.player.findMany({
    where: { id: { in: clean } },
    select: { id: true, name: true },
  });
  const byId = new Map(players.map((p) => [p.id, p.name]));
  const seed = await prisma.team.aggregate({
    where: { eventId, stageId, clubGroupId: clubId },
    _max: { seed: true },
  });

  const pair = await prisma.team.create({
    data: {
      eventId,
      stageId,
      clubGroupId: clubId,
      // Named for the players, which is what a captain and a starter both read.
      name: clean.map((id) => byId.get(id) ?? "?").join(" / "),
      seed: (seed._max.seed ?? 0) + 1,
    },
    select: { id: true },
  });

  for (const [i, playerId] of clean.entries()) {
    await prisma.teamMember.create({ data: { teamId: pair.id, playerId, position: i } });
  }

  revalidatePath("/teams");
  return { ok: true };
}

/**
 * Take a pair back down.
 *
 * Deletes the side, which takes its members with it by cascade. A pair that
 * has already played is not removed silently — its scorecards would go with
 * it, and a captain undoing Thursday on Friday should be told rather than
 * obeyed.
 */
export async function withdrawPair(pairId: string): Promise<LeagueResult> {
  const eventId = await requireStaff();
  return withdrawPairInEvent(eventId, pairId);
}

/**
 * The same withdrawal, for a CAPTAIN acting on their own club's pair.
 *
 * The pair is looked up scoped to the clubs this caller captains AND to their
 * events — both drawn from `session.email` via `captainClubs` — so a captain
 * can only take down a pair of a team they run. The event then comes from the
 * pair's own row, never the caller.
 */
export async function captainWithdrawPair(pairId: string): Promise<LeagueResult> {
  const clubs = await captainClubs();
  if (!clubs.size) return { ok: false, error: "You don't captain a team." };
  const pair = await prisma.team.findFirst({
    where: {
      id: pairId,
      clubGroupId: { in: [...clubs.keys()] },
      eventId: { in: [...new Set(clubs.values())] },
    },
    select: { id: true, eventId: true },
  });
  if (!pair) return { ok: false, error: "That pair is not one of your team's." };
  return withdrawPairInEvent(pair.eventId, pairId);
}

async function withdrawPairInEvent(eventId: string, pairId: string): Promise<LeagueResult> {
  const pair = await prisma.team.findFirst({
    where: { id: pairId, eventId, clubGroupId: { not: null } },
    select: { id: true, name: true },
  });
  if (!pair) return { ok: false, error: "That pair is not in this league." };

  const played = await prisma.teamScorecard.findFirst({
    where: { teamId: pairId },
    select: { id: true },
  });
  if (played) {
    return {
      ok: false,
      error: `${pair.name} has a card. Clear the scores before taking the pair down.`,
    };
  }

  await prisma.team.delete({ where: { id: pairId } });
  revalidatePath("/teams");
  return { ok: true };
}

/** The most pairs a meeting may declare. Past this it is a typo, not a league. */
const MAX_LEAGUE_PAIRS = 24;
/** The largest match bonus accepted. A bonus bigger than a whole match's holes is a typo. */
const MAX_MATCH_BONUS = 18;

/**
 * THE LEAGUE'S OWN RULES: how results become points, and how many pairs a
 * club puts up.
 *
 * Organizer only, as every other scoring setting is — an assistant runs the
 * night, the organizer decides what it is worth.
 *
 * NOT LOCKED, and deliberately. The table is derived from the cards on every
 * read, so changing the system re-scores every week already played rather
 * than corrupting anything; a league that realises in week three it meant
 * "holes plus a bonus" must be able to say so. Because it rewrites history on
 * the screen, the change is written to the audit log.
 *
 * An empty system switches the league OFF: the Teams screen then shows no
 * league at all, which is what every tournament with flights but no clubs
 * needs. The pairs and cards already written are left alone.
 *
 * Validated here rather than trusted: the form's select and number inputs are
 * a convenience, and this is a public endpoint.
 */
export async function setLeagueSettings(input: {
  points: unknown;
  matchBonus: unknown;
  pairs: unknown;
  playoffs: unknown;
}): Promise<LeagueResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin") throw new Error("Organizer access required");
  const eventId = session.eventId;

  const points =
    input.points === "" ? "" : isLeaguePointsSystem(input.points) ? input.points : null;
  if (points === null) {
    return { ok: false, error: "Pick one of the listed scoring systems." };
  }
  const bonus = input.matchBonus;
  if (typeof bonus !== "number" || !Number.isInteger(bonus) || bonus < 0 || bonus > MAX_MATCH_BONUS) {
    return { ok: false, error: `The match bonus is a whole number from 0 to ${MAX_MATCH_BONUS}.` };
  }
  const pairs = input.pairs;
  if (typeof pairs !== "number" || !Number.isInteger(pairs) || pairs < 0 || pairs > MAX_LEAGUE_PAIRS) {
    return { ok: false, error: `Pairs per club is a whole number from 0 to ${MAX_LEAGUE_PAIRS}.` };
  }

  const playoffs = input.playoffs;
  if (!isLeaguePlayoffSize(playoffs)) {
    return { ok: false, error: "Play-offs are for 2, 4 or 8 clubs, or none." };
  }

  const before = await prisma.event.findUnique({
    where: { id: eventId },
    select: { leaguePoints: true, leagueMatchBonus: true, leaguePairs: true, leaguePlayoffClubs: true },
  });
  if (!before) return { ok: false, error: "Tournament not found." };

  await prisma.event.update({
    where: { id: eventId },
    data: {
      leaguePoints: points,
      leagueMatchBonus: bonus,
      leaguePairs: pairs,
      leaguePlayoffClubs: playoffs,
    },
  });
  await logAudit(
    eventId,
    "league-settings",
    `League scoring ${before.leaguePoints || "off"} (bonus ${before.leagueMatchBonus}, pairs ${before.leaguePairs}, play-offs ${before.leaguePlayoffClubs})` +
      ` -> ${points || "off"} (bonus ${bonus}, pairs ${pairs}, play-offs ${playoffs})`,
  );
  revalidatePath("/teams");
  return { ok: true };
}

export type LeagueDrawResult =
  | {
      ok: true;
      /** Four-balls created. */
      matches: number;
      /** The club sitting out this week, when the league is odd. */
      byeClub: string | null;
      /** The play-off round this was, or null for a season week. */
      playoff: string | null;
      /** Pairs left without an opponent because the other club put up fewer. */
      unmatched: number;
    }
  | { ok: false; error: string; needsConfirm?: boolean; existing?: number };

/**
 * DRAW ONE LEAGUE WEEK: which clubs meet, and which pair plays which.
 *
 * The generic `generateTeamMatches` plays every side in a round against every
 * other, which on a league week is thousands of matches and a club's pairs
 * playing each other. See `league-draw.ts` for the two levels this does
 * instead.
 *
 * THE WEEK is this round's place among the tournament's team rounds, so the
 * rotation follows the season without anybody numbering it.
 *
 * NOT LOCKED BY LAUNCH, like nominating: a league is live all season and is
 * drawn every week. What it does refuse is replacing a week somebody has
 * already scored — same rule, same wording, as the generic draw.
 */
export async function drawLeagueWeek(stageId: string, replace = false): Promise<LeagueDrawResult> {
  const eventId = await requireStaff();

  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId },
    select: { id: true, position: true, format: true, holes: true },
  });
  if (!stage) return { ok: false, error: "Round not found." };
  if (!needsTeams(stage.format)) {
    return {
      ok: false,
      error: `${stage.format} is played by individuals — a league week needs a pairs format.`,
    };
  }

  const { season, playoffs } = await leagueSeason(eventId);

  const clubs = await prisma.group.findMany({
    where: { eventId, stageId: null, isCarrier: false },
    select: { id: true, name: true },
    orderBy: { position: "asc" },
  });
  if (clubs.length < 2) {
    return { ok: false, error: "A league needs at least two clubs. Add them as flights first." };
  }

  const pairs = await prisma.team.findMany({
    where: { eventId, stageId, clubGroupId: { not: null } },
    select: { id: true, clubGroupId: true },
    orderBy: [{ seed: "asc" }, { createdAt: "asc" }],
  });
  const pairsOf = (clubId: string) =>
    pairs.filter((p) => p.clubGroupId === clubId).map((p) => p.id);

  const playoffRound = playoffs.indexOf(stageId);
  let meetings: [string, string][];
  let bye: string | null = null;
  let roundName: string | null = null;

  if (playoffRound < 0) {
    ({ meetings, bye } = leagueWeekMeetings(
      clubs.map((c) => c.id),
      season.indexOf(stageId),
    ));
  } else {
    /**
     * A PLAY-OFF WEEK: the meetings come from the bracket, and the bracket
     * only knows them once everything before has a result. Drawing the
     * semi-finals off a season with a week still out would seed them off a
     * table that can still change.
     */
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { leaguePoints: true, leagueMatchBonus: true },
    });
    const system = isLeaguePointsSystem(event?.leaguePoints) ? event.leaguePoints : "match";
    const bonus = event?.leagueMatchBonus;

    const before = playoffRound === 0 ? season : [playoffs[playoffRound - 1]];
    for (const earlier of before) {
      const open = (await leagueMeetings(eventId, earlier, system, bonus)).filter((m) => !m.complete);
      if (open.length > 0) {
        return {
          ok: false,
          error: `${open[0].clubAName} v ${open[0].clubBName} is not finished yet. The play-offs are drawn once every meeting before them has a result.`,
        };
      }
    }

    const bracket = await leaguePlayoffs(eventId, system, bonus);
    if (!bracket) {
      return {
        ok: false,
        error: "The league has fewer clubs than play-off places. Change the play-offs in League settings.",
      };
    }
    /**
     * A LEVEL MEETING IN THE ROUND BEFORE STOPS THIS ONE, and says which —
     * the sides here depend on who came through it, and nobody has yet. The
     * organizer records the play-off hole and draws again.
     */
    const previous = playoffRound > 0 ? bracket.rounds[playoffRound - 1] : null;
    if (previous && previous.awaitingHole.length > 0) {
      const [a, b] = previous.awaitingHole[0];
      const nameOf = (id: string) => bracket.names[id] ?? "a club";
      return {
        ok: false,
        error: `${nameOf(a)} v ${nameOf(b)} finished level. Record who won the play-off hole, then draw this round.`,
      };
    }

    const round = bracket.rounds[playoffRound];
    if (!round || round.meetings.some((m) => m === null)) {
      return {
        ok: false,
        error: "The meetings for this play-off round are not known yet.",
      };
    }
    roundName = round.name;
    meetings = round.meetings.map((m): [string, string] => [m!.clubA, m!.clubB]);
  }

  const draws = meetings.map(([a, b]) => drawMeeting(pairsOf(a), pairsOf(b)));
  const total = draws.reduce((n, d) => n + d.matches.length, 0);
  if (total === 0) {
    return {
      ok: false,
      error: "None of the clubs meeting this week has a pair on both sides yet. Nominate pairs first.",
    };
  }

  const existing = await prisma.match.findMany({
    where: { eventId, stageId },
    select: { id: true },
  });
  if (existing.length > 0 && !replace) {
    return {
      ok: false,
      error: "This week is already drawn.",
      needsConfirm: true,
      existing: existing.length,
    };
  }
  if (existing.length > 0) {
    const scored = await prisma.teamScorecard.count({
      where: { stageId, NOT: { strokes: "[]" } },
    });
    if (scored > 0) {
      return { ok: false, error: "Scores have already been recorded for this round." };
    }
    await prisma.match.deleteMany({ where: { id: { in: existing.map((m) => m.id) } } });
  }

  const groupId = await matchCarrierGroup(
    eventId,
    stage.id,
    `${stage.format} — Round ${stage.position + 1}`,
  );
  const emptyHoles = JSON.stringify(new Array(holesPlayed(stage.holes)).fill(null));
  for (const [i, draw] of draws.entries()) {
    for (const [teamAId, teamBId] of draw.matches) {
      await prisma.match.create({
        data: {
          eventId,
          stageId,
          groupId,
          // One number per meeting, so a meeting's four-balls sort together.
          round: i + 1,
          playerAId: "",
          playerBId: "",
          teamAId,
          teamBId,
          holes: emptyHoles,
        },
      });
    }
  }

  revalidatePath("/", "layout");
  boardChanged(eventId);
  return {
    ok: true,
    matches: total,
    byeClub: clubs.find((c) => c.id === bye)?.name ?? null,
    playoff: roundName,
    unmatched: draws.reduce((n, d) => n + d.unmatched.length, 0),
  };
}

/**
 * RECORD WHO WON THE PLAY-OFF HOLE.
 *
 * A level play-off meeting is settled on the course, sudden death — Ajay's
 * decision of 2026-09-18 — and nobody scores a play-off hole into the app, so
 * somebody has to say who came through. Until they do, `meetingWinner` sends
 * nobody through and the next round cannot be drawn: the app no longer
 * invents a winner from the seeding.
 *
 * Staff, like every other league write, and changeable — a result typed in
 * wrongly on a Thursday night has to be correctable on Friday — with every
 * change written to the audit log.
 *
 * REFUSED WHERE THE MEETING IS NOT LEVEL. A play-off hole decides a tie;
 * recording one on a meeting somebody won outright would overturn a result
 * that was played for, and nothing on the screen would explain why the
 * bracket disagreed with the points.
 */
export async function setPlayoffHoleWinner(
  stageId: string,
  clubAId: string,
  clubBId: string,
  winnerId: string,
  /**
   * Overturning a meeting somebody WON, rather than settling a level one.
   *
   * Ajay, 2026-09-18: wanted, with caution. The caution is here — an override
   * needs saying so deliberately and needs a reason, and every screen prints
   * both beside the result — rather than in a rule that quietly allows it.
   */
  override?: { reason: string },
): Promise<LeagueResult> {
  const eventId = await requireStaff();

  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId },
    select: { id: true },
  });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };

  const clubs = await prisma.group.findMany({
    where: { id: { in: [clubAId, clubBId] }, eventId, isCarrier: false },
    select: { id: true, name: true },
  });
  if (clubs.length !== 2) return { ok: false, error: "Those clubs are not in this league." };

  /**
   * The winner, looked up scoped to this tournament rather than compared to
   * the two ids the caller sent. `audit-idor` asks for exactly this: every row
   * id an action receives is narrowed to the caller's scope by a query, not by
   * arithmetic on the arguments.
   */
  const winner = await prisma.group.findFirst({
    where: { id: winnerId, eventId, isCarrier: false },
    select: { id: true, name: true },
  });
  if (!winner || (winner.id !== clubAId && winner.id !== clubBId)) {
    return { ok: false, error: "The winner has to be one of the two clubs that played." };
  }

  /**
   * Read back through the same service the screen reads, so the check and the
   * display cannot disagree about which meetings are tied.
   */
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { leaguePoints: true, leagueMatchBonus: true },
  });
  const system = isLeaguePointsSystem(event?.leaguePoints) ? event.leaguePoints : "match";
  const meeting = (await leagueMeetings(eventId, stageId, system, event?.leagueMatchBonus)).find(
    (m) =>
      (m.clubAId === clubAId && m.clubBId === clubBId) ||
      (m.clubAId === clubBId && m.clubBId === clubAId),
  );
  if (!meeting) return { ok: false, error: "Those clubs did not meet in this round." };
  if (!meeting.complete) return { ok: false, error: "That meeting is still out on the course." };

  /**
   * A MEETING SOMEBODY WON IS ONLY OVERTURNED DELIBERATELY.
   *
   * The points already decided it, so this is the committee setting a played
   * result aside — a disqualification, an appeal, an ineligible side. It takes
   * the explicit flag AND a reason, and both are printed beside the result for
   * members as well as staff. Without the flag it is refused, so a mistyped
   * play-off hole can never reverse a match.
   */
  const level = meeting.pointsA === meeting.pointsB;
  const reason = (override?.reason ?? "").trim();
  if (!level && !override) {
    const won = meeting.pointsA > meeting.pointsB ? meeting.clubAName : meeting.clubBName;
    return {
      ok: false,
      error: `${won} won that meeting outright. Overturning a played result is a committee decision, and needs a reason.`,
    };
  }
  if (!level && reason.length < 3) {
    return { ok: false, error: "Say why the committee is overturning the result." };
  }
  const overrode = !level;

  const [clubLowId, clubHighId] = [clubAId, clubBId].sort();
  const session = await getSession();
  const decidedBy = session?.name ?? "";
  await prisma.leaguePlayoffHole.upsert({
    where: { stageId_clubLowId_clubHighId: { stageId, clubLowId, clubHighId } },
    update: { winnerId, overrode, note: reason, decidedBy, decidedAt: new Date() },
    create: { eventId, stageId, clubLowId, clubHighId, winnerId, overrode, note: reason, decidedBy },
  });

  const name = clubs.find((c) => c.id === winnerId)?.name ?? "That club";
  const other = clubs.find((c) => c.id !== winnerId)?.name ?? "the other club";
  await logAudit(
    eventId,
    "league-playoff-hole",
    overrode
      ? `${name} through over ${other} — committee overturned the result: ${reason}`
      : `${name} beat ${other} on the play-off hole`,
  );
  revalidatePath("/", "layout");
  boardChanged(eventId);
  return { ok: true };
}