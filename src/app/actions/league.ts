"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/services/action-shared";
import { isLeaguePointsSystem } from "@/lib/domain/league-meeting";

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

  const before = await prisma.event.findUnique({
    where: { id: eventId },
    select: { leaguePoints: true, leagueMatchBonus: true, leaguePairs: true },
  });
  if (!before) return { ok: false, error: "Tournament not found." };

  await prisma.event.update({
    where: { id: eventId },
    data: { leaguePoints: points, leagueMatchBonus: bonus, leaguePairs: pairs },
  });
  await logAudit(
    eventId,
    "league-settings",
    `League scoring ${before.leaguePoints || "off"} (bonus ${before.leagueMatchBonus}, pairs ${before.leaguePairs})` +
      ` -> ${points || "off"} (bonus ${bonus}, pairs ${pairs})`,
  );
  revalidatePath("/teams");
  return { ok: true };
}
