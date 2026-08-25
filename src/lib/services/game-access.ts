import "server-only";
import { prisma } from "../db";
import { getSession } from "../auth";
import { parseTeeSheet } from "../domain/tee-sheet";

/**
 * Who may run WHICH game — the one reader for every player-money pot.
 *
 * It lives here rather than in an action file because BOTH the skins pot and
 * the derived games (birdies, low net, Nassau) ask exactly this question, and
 * a "use server" file cannot export a helper without publishing it as an HTTP
 * endpoint. Two copies of this rule would be two answers to "may this player
 * touch that fourball's money", and one rule with more than one reader is the
 * fault this codebase keeps paying for.
 *
 * Two different answers, because these are two different pots:
 *
 *  - The FIELD's game (`groupKey` empty) is the tournament's money and stays
 *    organizer-or-assistant, exactly as it always was. The organizer sets up
 *    the tournament's money; players do not.
 *  - A GROUP's game belongs to the players playing it. A casual $20 skins or a
 *    $5 birdie pot between four friends should not need the organizer, so any
 *    player in that group may set it up — AND ONLY THAT GROUP. This is the
 *    check that matters: without it, "players may create group games" would
 *    let any player in the field create or overwrite any other group's game,
 *    which is strictly worse than staff-only.
 *
 * Membership is read from the stage's published tee sheet, not from anything
 * the caller sent. A `"use server"` export is a public HTTP endpoint and will
 * be called with whatever the caller likes, including somebody else's group
 * name.
 */

/**
 * How long an ad-hoc bet's name may be.
 *
 * It is a label a player types and it becomes part of a unique key, so it is
 * bounded here rather than truncated: silently shortening two different names
 * to the same forty characters would merge two groups' money.
 */
export const AD_HOC_NAME_MAX = 40;

/** Refuse a round belonging to somebody else's tournament. */
async function stageInEvent(eventId: string, stageId: string): Promise<void> {
  const stage = await prisma.stage.findUnique({ where: { id: stageId }, select: { eventId: true } });
  if (!stage || stage.eventId !== eventId) throw new Error("Round not found");
}

export async function requirePotAccess(stageId: string, groupKey: string): Promise<string> {
  const session = await getSession();
  if (!session?.eventId) throw new Error("Not signed in");
  const eventId = session.eventId;
  await stageInEvent(eventId, stageId);

  const isStaff = session.viewRole === "admin" || session.viewRole === "assistant";
  if (isStaff) return eventId;

  const key = (groupKey ?? "").trim();
  if (!key) throw new Error("Only an organizer or assistant can run the field's pot");

  const email = (session.email ?? "").trim().toLowerCase();
  if (!email) throw new Error("Only an organizer or assistant can do that");

  const me = await prisma.player.findFirst({
    where: { eventId, email: { equals: email, mode: "insensitive" }, status: "confirmed" },
    select: { id: true },
  });
  if (!me) throw new Error("Only a player in that group can run its game");

  if (key.length > AD_HOC_NAME_MAX) {
    throw new Error(`Keep the name under ${AD_HOC_NAME_MAX} characters`);
  }

  /**
   * WHO IS ALREADY IN IT, across every game under this name on this round.
   *
   * Across ALL of them, not the first one found. A name can carry four skins
   * pots — front and back, gross and net — plus a birdie pot and a Nassau, and
   * deciding access from whichever row turned up first answered about a
   * different game than the one being written.
   *
   * Skins and side games are read TOGETHER on purpose. They are the same
   * people's money under the same name, so paying into the group's skins is
   * what earns the right to start that group's birdie pot. Asking only about
   * the kind being written would make a fourball's first birdie pot look
   * ad-hoc, and somebody else's look like their own.
   *
   * And checked FIRST, before the tee sheet, which is what stops a redraw
   * taking a game away from the people who paid into it. The key is a group
   * NAME, so republishing the sheet with different fourballs makes "Group 1"
   * mean four other players — under a membership-only rule the original four
   * would be locked out of their own money while four strangers inherited it.
   * Having a stake in a game is the one claim a redraw cannot revoke.
   */
  const [pots, games] = await Promise.all([
    prisma.skinsPot.findMany({
      where: { stageId, groupKey: key },
      select: { entrants: { select: { playerId: true } } },
    }),
    prisma.sideGame.findMany({
      where: { stageId, groupKey: key },
      select: { entrants: { select: { playerId: true } } },
    }),
  ]);
  const entrants = new Set(
    [...pots, ...games].flatMap((p) => p.entrants.map((e) => e.playerId)),
  );
  if (entrants.has(me.id)) return eventId;

  /**
   * A TEE-SHEET GROUP: the fourball currently playing together, and NOBODY
   * else — this branch never falls through to the ad-hoc one below.
   *
   * That fall-through was a real hole. A group's game that did not exist yet
   * had no entrants, so the "nobody is in it" branch let any player in the
   * field create it — and `potAudience` then resolved its audience to the
   * group named on the sheet. In opt-out mode that enters those players and
   * charges them the stake. A player in Group 2 could put Group 1 in a £50
   * birdie pot they had never heard of, which is the exact harm this rule
   * exists to prevent, reached through the door left open for a different
   * case.
   *
   * So a name the tee sheet vouches for is answered ONLY by membership of it.
   * Being unclaimed is not a way in when the name already means somebody.
   */
  const stage = await prisma.stage.findUnique({ where: { id: stageId }, select: { teeSheet: true } });
  const sheet = parseTeeSheet(stage?.teeSheet ?? "");
  const group = sheet?.groups.find((g) => g.name === key);
  if (group) {
    if (group.playerIds.includes(me.id)) return eventId;
    throw new Error("Only somebody in that group can run its game");
  }

  /**
   * A NAME NOBODY IS IN YET, and that names no group: anyone in the field may
   * start it.
   *
   * Six friends spread across three fourballs want a game between the six of
   * them — neither the club's pot nor any one group's. Before this it took an
   * organizer setting up a field pot and ticking six of forty names, so in
   * practice it was done on paper. The gap between creating a game and naming
   * its entrants is the one moment nobody is in it.
   *
   * Safe here in a way it was not above, because an ad-hoc name resolves its
   * audience to the whole field rather than to a group: there is no set of
   * players it can silently enter.
   */
  if (entrants.size === 0) return eventId;

  throw new Error("Only somebody in this game can change it");
}
