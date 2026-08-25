"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isSkinsScope } from "@/lib/domain/skins-pot";
import { parseTeeSheet } from "@/lib/domain/tee-sheet";

/**
 * The skins pot on a league round.
 *
 * Every export in a "use server" file is a public HTTP endpoint, so each
 * action calls `requirePotAccess` first, which proves the round belongs to the
 * caller's tournament AND that they may write this particular pot. Hiding a
 * screen stops nobody from posting here.
 *
 * There is no plain staff check left: the field's pot and a fourball's own are
 * two different permissions, and one function answering both is what keeps a
 * caller from being asked the wrong question.
 *
 * These actions record money. They never move it.
 */

export interface SkinsResult {
  ok: boolean;
  error?: string;
}

/**
 * How long an ad-hoc bet's name may be.
 *
 * It is a label a player types and it becomes part of a unique key, so it is
 * bounded here rather than truncated: silently shortening two different names
 * to the same forty characters would merge two groups' money.
 */
const AD_HOC_NAME_MAX = 40;

/** Refuse a round belonging to somebody else's tournament. */
async function stageInEvent(eventId: string, stageId: string): Promise<void> {
  const stage = await prisma.stage.findUnique({ where: { id: stageId }, select: { eventId: true } });
  if (!stage || stage.eventId !== eventId) throw new Error("Round not found");
}

function refresh() {
  revalidatePath("/", "layout");
}

/**
 * Who may run WHICH pot.
 *
 * Two different answers, because these are two different pots:
 *
 *  - The FIELD's pot (`groupKey` empty) is the tournament's money and stays
 *    organizer-or-assistant, exactly as it always was.
 *  - A GROUP's pot belongs to the fourball playing it. A casual $20 skins
 *    between four players should not need the organizer, so any player in
 *    that group may set it up — AND ONLY THAT GROUP. This is the check that
 *    matters: without it, "players may create group pots" would let any
 *    player in the field create or overwrite any other group's game, which is
 *    strictly worse than staff-only.
 *
 * Membership is read from the stage's published tee sheet, not from anything
 * the caller sent. A `"use server"` export is a public HTTP endpoint and will
 * be called with whatever the caller likes, including somebody else's group
 * name.
 */
async function requirePotAccess(stageId: string, groupKey: string): Promise<string> {
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
   * WHO IS ALREADY IN IT, across every pot under this name on this round.
   *
   * Across ALL of them, not the first one found. A name can carry four pots —
   * front and back, gross and net — and deciding access from whichever row
   * turned up first answered about a different game than the one being
   * written.
   *
   * And checked FIRST, before the tee sheet, which is what stops a redraw
   * taking a game away from the people who paid into it. The key is a group
   * NAME, so republishing the sheet with different fourballs makes "Group 1"
   * mean four other players — under a membership-only rule the original four
   * would be locked out of their own money while four strangers inherited it.
   * Having a stake in a pot is the one claim a redraw cannot revoke.
   */
  const pots = await prisma.skinsPot.findMany({
    where: { stageId, groupKey: key },
    select: { entrants: { select: { playerId: true } } },
  });
  const entrants = new Set(pots.flatMap((p) => p.entrants.map((e) => e.playerId)));
  if (entrants.has(me.id)) return eventId;

  // A TEE-SHEET GROUP: the fourball currently playing together may run the
  // game that carries their name.
  const stage = await prisma.stage.findUnique({ where: { id: stageId }, select: { teeSheet: true } });
  const sheet = parseTeeSheet(stage?.teeSheet ?? "");
  const group = sheet?.groups.find((g) => g.name === key);
  if (group?.playerIds.includes(me.id)) return eventId;

  /**
   * A NAME NOBODY IS IN YET: anyone in the field may start it.
   *
   * Six friends spread across three fourballs want a game between the six of
   * them — neither the club's pot nor any one group's. Before this it took an
   * organizer setting up a field pot and ticking six of forty names, so in
   * practice it was done on paper. The gap between creating a pot and naming
   * its entrants is the one moment nobody is in it.
   */
  if (entrants.size === 0) return eventId;

  throw new Error("Only somebody in this game can change it");
}

/**
 * Set up (or change) the pot on a round.
 *
 * Creates it on first save, so an organizer never has to "start a pot" as a
 * separate step before setting a buy-in.
 */
export async function saveSkinsPot(
  stageId: string,
  input: { buyInCents: number; net: boolean; scope: string; groupKey?: string },
): Promise<SkinsResult> {
  const groupKey = (input.groupKey ?? "").trim();
  // Staff for the field's pot; a player in that fourball for the group's own.
  const eventId = await requirePotAccess(stageId, groupKey);

  const buyIn = Math.round(input.buyInCents);
  if (!Number.isFinite(buyIn) || buyIn < 0) {
    return { ok: false, error: "A buy-in cannot be negative." };
  }
  if (!isSkinsScope(input.scope)) {
    return { ok: false, error: "Choose the front nine, the back nine, or all eighteen." };
  }

  // Keyed on the round, the scoring, THE SCOPE and THE GROUP. A league night
  // runs four games — front and back, each gross and net — and without the
  // scope in the key, saving the back-nine pot upserted the front-nine one:
  // the same row, so the front game's entrants and their money silently became
  // the back game's and the front game vanished.
  //
  // `groupKey` is here for exactly the same reason one level up: two fourballs
  // each running their own net front-nine skins are two pots, and without it
  // the second one saved would overwrite the first — the same silent loss of
  // somebody's money, one scope wider.
  const data = { buyInCents: buyIn };
  await prisma.skinsPot.upsert({
    where: { stageId_net_scope_groupKey: { stageId, net: input.net, scope: input.scope, groupKey } },
    create: { eventId, stageId, net: input.net, scope: input.scope, groupKey, ...data },
    update: data,
  });
  refresh();
  return { ok: true };
}

/**
 * Who paid in.
 *
 * Entered by club staff rather than inferred from who is playing: attendance
 * answers "are you here this week", this answers "did you put money in", and
 * plenty of players do the first without the second. Entering someone who
 * never paid produces a settlement sheet that is wrong in the way that loses
 * a club's trust.
 *
 * Replaces the whole list rather than adding one at a time, because the screen
 * is a set of tick-boxes confirmed in one go.
 */
export async function setSkinsEntrants(
  stageId: string,
  /** Which pot: the gross game or the net one. A club may run both. */
  net: boolean,
  /**
   * And over which holes. Required, not defaulted: a pot cannot be identified
   * without saying WHICH game, and defaulting to "full" here would attach a
   * league's front-nine entrants to a whole-round pot that nobody played.
   */
  scope: string,
  playerIds: string[],
  /** Which pot again: the field's, or one fourball's. Empty is the field's. */
  groupKey: string = "",
): Promise<SkinsResult> {
  const key = (groupKey ?? "").trim();
  const eventId = await requirePotAccess(stageId, key);
  if (!isSkinsScope(scope)) {
    return { ok: false, error: "Choose the front nine, the back nine, or all eighteen." };
  }

  // Only confirmed players of THIS tournament, deduplicated. Anything else in
  // the list is dropped rather than trusted — the ids arrive over HTTP, and a
  // foreign one would otherwise enter somebody else's player into this pot.
  //
  // `playerIds` is narrowed here in the query itself rather than through a
  // local, so the scope check is visible at the point of use.
  const valid = await prisma.player.findMany({
    where: { id: { in: [...new Set(playerIds)] }, eventId, status: "confirmed" },
    select: { id: true },
  });
  let ids = valid.map((p) => p.id);

  /**
   * And for a FOURBALL's pot, only that fourball.
   *
   * Being in the tournament is not consent to be staked in somebody else's
   * game. Without this, a player in Group 1 could enter every name in the
   * field into Group 1's pot: the others owe a buy-in they never agreed to,
   * and it lands in their settle-up looking exactly like a debt they did.
   *
   * Only when the key names a group on the sheet. An ad-hoc bet is
   * deliberately not a group — six friends across three fourballs is the case
   * it exists for — and is bounded instead by who may write it at all.
   */
  if (key) {
    const stage = await prisma.stage.findUnique({ where: { id: stageId }, select: { teeSheet: true } });
    const group = parseTeeSheet(stage?.teeSheet ?? "")?.groups.find((g) => g.name === key);
    if (group) {
      const inGroup = new Set(group.playerIds);
      const dropped = ids.filter((id) => !inGroup.has(id));
      ids = ids.filter((id) => inGroup.has(id));
      if (dropped.length > 0) {
        return {
          ok: false,
          error: `${dropped.length} of those players aren't in ${key}. A group's pot is for the group playing it.`,
        };
      }
    }
  }

  const pot = await prisma.skinsPot.upsert({
    where: { stageId_net_scope_groupKey: { stageId, net, scope, groupKey: key } },
    create: { eventId, stageId, net, scope, groupKey: key },
    update: {},
  });

  await prisma.$transaction([
    prisma.skinsEntry.deleteMany({ where: { potId: pot.id, playerId: { notIn: ids.length ? ids : ["-"] } } }),
    prisma.skinsEntry.createMany({
      data: ids.map((playerId) => ({ potId: pot.id, playerId })),
      skipDuplicates: true,
    }),
  ]);
  refresh();
  return { ok: true };
}

/**
 * Remove the pot entirely.
 *
 * Not the same as emptying it: a round with no pot never had a game, while a
 * pot with nobody in it is a game nobody joined. Entries go with it.
 */
export async function removeSkinsPot(
  stageId: string,
  net: boolean,
  /**
   * WHICH pot. Required for the same reason `setSkinsEntrants` requires it.
   *
   * This deleted on `{ stageId, eventId, net }` alone, so removing the net
   * front-nine pot also deleted the net back-nine and net full-round pots and
   * every entry in them. The scope went into the unique key when the front and
   * back pots were found to be overwriting each other; the DELETE was missed,
   * and a delete is the one operation where missing it cannot be noticed
   * afterwards.
   */
  scope: string,
  /** The field's pot, or one fourball's. Empty is the field's. */
  groupKey: string = "",
): Promise<SkinsResult> {
  const key = (groupKey ?? "").trim();
  const eventId = await requirePotAccess(stageId, key);
  if (!isSkinsScope(scope)) {
    return { ok: false, error: "Choose the front nine, the back nine, or all eighteen." };
  }
  // Exactly the pot named, and nothing beside it.
  await prisma.skinsPot.deleteMany({ where: { stageId, eventId, net, scope, groupKey: key } });
  refresh();
  return { ok: true };
}
