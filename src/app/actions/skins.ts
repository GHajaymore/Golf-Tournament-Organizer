"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isSkinsScope } from "@/lib/domain/skins-pot";

/**
 * The skins pot on a league round.
 *
 * Every export in a "use server" file is a public HTTP endpoint, so each
 * action calls requireStaff first and then proves the round belongs to the
 * caller's tournament. Hiding a screen stops nobody from posting here.
 *
 * These actions record money. They never move it.
 */

export interface SkinsResult {
  ok: boolean;
  error?: string;
}

/** Organizer or assistant, on the active tournament. */
async function requireStaff(): Promise<string> {
  const session = await getSession();
  if (!session?.eventId) throw new Error("Not signed in");
  if (session.viewRole !== "admin" && session.viewRole !== "assistant") {
    throw new Error("Only an organizer or assistant can do that");
  }
  return session.eventId;
}

/** Refuse a round belonging to somebody else's tournament. */
async function stageInEvent(eventId: string, stageId: string): Promise<void> {
  const stage = await prisma.stage.findUnique({ where: { id: stageId }, select: { eventId: true } });
  if (!stage || stage.eventId !== eventId) throw new Error("Round not found");
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
  input: { buyInCents: number; net: boolean; scope: string },
): Promise<SkinsResult> {
  const eventId = await requireStaff();
  await stageInEvent(eventId, stageId);

  const buyIn = Math.round(input.buyInCents);
  if (!Number.isFinite(buyIn) || buyIn < 0) {
    return { ok: false, error: "A buy-in cannot be negative." };
  }
  if (!isSkinsScope(input.scope)) {
    return { ok: false, error: "Choose the front nine, the back nine, or all eighteen." };
  }

  // Keyed on the round AND the scoring, because a club can run a gross pot
  // and a net one on the same night — two games, two lots of money.
  const data = { buyInCents: buyIn, scope: input.scope };
  await prisma.skinsPot.upsert({
    where: { stageId_net: { stageId, net: input.net } },
    create: { eventId, stageId, net: input.net, ...data },
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
  playerIds: string[],
): Promise<SkinsResult> {
  const eventId = await requireStaff();
  await stageInEvent(eventId, stageId);

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
  const ids = valid.map((p) => p.id);

  const pot = await prisma.skinsPot.upsert({
    where: { stageId_net: { stageId, net } },
    create: { eventId, stageId, net },
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
export async function removeSkinsPot(stageId: string, net: boolean): Promise<SkinsResult> {
  const eventId = await requireStaff();
  await stageInEvent(eventId, stageId);
  // Only the pot named — a club running both keeps the other one.
  await prisma.skinsPot.deleteMany({ where: { stageId, eventId, net } });
  refresh();
  return { ok: true };
}
