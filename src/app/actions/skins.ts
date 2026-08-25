"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { isSkinsScope } from "@/lib/domain/skins-pot";
import { parseTeeSheet } from "@/lib/domain/tee-sheet";
import { requirePotAccess } from "@/lib/services/game-access";

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

function refresh() {
  revalidatePath("/", "layout");
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
