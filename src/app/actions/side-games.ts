"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isDerivedKind, DERIVED_LABEL } from "@/lib/domain/derived-games";
import { MAX_EXPENSE_CENTS } from "@/lib/domain/expenses";

/**
 * The side bets the cards settle: low gross, low net, birdies, eagles, Nassau.
 *
 * Note what is missing on purpose — there is no "set the winner" action. These
 * are DERIVED, so a winner comes from the scores and nothing else; an action
 * that let one be typed would let a stored result contradict the cards it was
 * supposed to come from. All an organizer decides is that the bet exists, what
 * it costs, and who is in.
 *
 * Staff only, like the skins pot: this is money between players and who is in
 * the pot is a committee fact. Every write is audited. Records money, never
 * moves it.
 */

export interface SideGameResult {
  ok: boolean;
  error?: string;
  id?: string;
}

async function requireStaff(): Promise<{ eventId: string; name: string }> {
  const session = await getSession();
  if (!session?.eventId) throw new Error("Not signed in");
  if (session.viewRole !== "admin" && session.viewRole !== "assistant") {
    throw new Error("Only an organizer or assistant can do that");
  }
  return { eventId: session.eventId, name: session.name || session.email };
}

async function logMoney(eventId: string, action: string, detail: string) {
  const session = await getSession();
  await prisma.auditLog.create({
    data: { eventId, matchId: null, actor: session?.name ?? "system", action, detail },
  });
}

const money = (cents: number) => `${(cents / 100).toFixed(2)}`;

/** A Nassau is a match bet rather than a pot, and is not in DERIVED_KINDS. */
const KINDS = ["low-gross", "low-net", "birdies", "eagles", "nassau"];

/**
 * Start (or re-price) one derived bet on a round.
 *
 * Upserts on (stageId, kind) because a round has at most one birdie pot — two
 * would be two prices for the same bet, and the cards cannot tell them apart.
 */
export async function saveSideGame(
  stageId: string,
  kind: string,
  buyInCents: number,
): Promise<SideGameResult> {
  const { eventId, name } = await requireStaff();

  if (!KINDS.includes(kind)) return { ok: false, error: "Unknown side game." };

  const stage = await prisma.stage.findFirst({ where: { id: stageId, eventId }, select: { id: true } });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };

  const cents = Math.round(Number(buyInCents));
  if (!Number.isFinite(cents) || cents < 0 || cents > MAX_EXPENSE_CENTS) {
    return { ok: false, error: "Enter a stake, or zero to switch it off." };
  }

  const game = await prisma.sideGame.upsert({
    where: { stageId_kind: { stageId, kind } },
    update: { buyInCents: cents },
    create: { eventId, stageId, kind, buyInCents: cents, createdBy: name },
  });

  await logMoney(
    eventId,
    "sidegame.save",
    `${isDerivedKind(kind) ? DERIVED_LABEL[kind] : "Nassau"} at ${money(cents)}`,
  );
  revalidatePath("/", "layout");
  return { ok: true, id: game.id };
}

/**
 * Who is in the pot.
 *
 * Re-queried against this event's field rather than trusted, the way
 * setSkinsEntrants does it: an id the client invented would otherwise stake a
 * stranger and move everybody else's number to pay them.
 */
export async function setSideGameEntrants(
  sideGameId: string,
  playerIds: string[],
): Promise<SideGameResult> {
  const { eventId } = await requireStaff();

  const game = await prisma.sideGame.findFirst({
    where: { id: sideGameId, eventId },
    select: { id: true, kind: true },
  });
  if (!game) return { ok: false, error: "That side game isn't in this tournament." };

  const rows = await prisma.player.findMany({
    where: { eventId, id: { in: [...new Set(playerIds.filter(Boolean))] } },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.sideGameEntry.deleteMany({ where: { sideGameId } }),
    prisma.sideGameEntry.createMany({
      data: rows.map((r) => ({ sideGameId, playerId: r.id })),
    }),
  ]);

  await logMoney(eventId, "sidegame.entrants", `${game.kind}: ${rows.length} in`);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeSideGame(sideGameId: string): Promise<SideGameResult> {
  const { eventId } = await requireStaff();
  const game = await prisma.sideGame.findFirst({
    where: { id: sideGameId, eventId },
    select: { id: true, kind: true },
  });
  if (!game) return { ok: false, error: "That side game isn't in this tournament." };

  await prisma.sideGame.delete({ where: { id: game.id } });
  await logMoney(eventId, "sidegame.remove", `Removed ${game.kind}`);
  revalidatePath("/", "layout");
  return { ok: true };
}
