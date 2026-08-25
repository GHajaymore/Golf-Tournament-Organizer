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
 * Upserts on (stageId, kind, groupKey) — one birdie pot per group per round.
 * Two at the same key would be two prices for one bet and the cards could not
 * tell them apart; two at DIFFERENT keys are two fourballs each running their
 * own, which is the ordinary case and used to overwrite.
 */
export async function saveSideGame(
  stageId: string,
  kind: string,
  buyInCents: number,
  /** The field's game, or one fourball's. Empty is the field's. */
  groupKeyInput: string = "",
): Promise<SideGameResult> {
  const groupKey = (groupKeyInput ?? "").trim();
  const { eventId, name } = await requireStaff();

  if (!KINDS.includes(kind)) return { ok: false, error: "Unknown side game." };

  const stage = await prisma.stage.findFirst({ where: { id: stageId, eventId }, select: { id: true } });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };

  const cents = Math.round(Number(buyInCents));
  if (!Number.isFinite(cents) || cents < 0 || cents > MAX_EXPENSE_CENTS) {
    return { ok: false, error: "Enter a stake, or zero to switch it off." };
  }

  const game = await prisma.sideGame.upsert({
    where: { stageId_kind_groupKey: { stageId, kind, groupKey } },
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

  /**
   * Replaces the CONFIRMED entrants, and leaves people who are still waiting
   * to pay exactly where they are.
   *
   * This used to delete every row and recreate the given ids, and
   * SideGameEntry.confirmed defaults to true — so an organizer nudging one
   * chip silently marked every outstanding self-signup as paid, and their
   * stakes went into the pot without the cash. It also worked the other way:
   * a pending request vanished the moment anyone touched the list, so the
   * player's ask was lost with nothing to show they had made it.
   *
   * An id explicitly passed in IS confirmed — an organizer ticking somebody in
   * is the confirmation, the same rule ContestEntry documents. Anyone pending
   * and not named keeps their unconfirmed row and stays on the collect list.
   */
  const ids = rows.map((r) => r.id);
  await prisma.$transaction([
    prisma.sideGameEntry.deleteMany({
      where: { sideGameId, OR: [{ confirmed: true }, { playerId: { in: ids } }] },
    }),
    prisma.sideGameEntry.createMany({
      data: ids.map((id) => ({ sideGameId, playerId: id, confirmed: true })),
    }),
  ]);

  await logMoney(eventId, "sidegame.entrants", `${game.kind}: ${rows.length} in`);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * A player putting their own name down for a derived pot, from the app.
 *
 * Same rule as a contest, and the same reason: this is an INTENTION, not a
 * stake. The pot is cash, and until the organizer says they have it the entry
 * counts for nothing — it must neither charge the player nor let them win a
 * pot they are not in.
 *
 * Only ever themselves, matched on the registration email, and not once the
 * money is in.
 */
export async function requestSideGameEntry(
  sideGameId: string,
  join: boolean,
): Promise<SideGameResult> {
  const session = await getSession();
  if (!session?.eventId) throw new Error("Not signed in");

  const game = await prisma.sideGame.findFirst({
    where: { id: sideGameId, eventId: session.eventId },
    select: { id: true, kind: true },
  });
  if (!game) return { ok: false, error: "That side game isn't in this tournament." };
  if (game.kind === "nassau") {
    // Nassau is a bet between the two players in a match, not a pot to join.
    return { ok: false, error: "The Nassau applies to your match — there's nothing to join." };
  }

  const me = await prisma.player.findFirst({
    where: { eventId: session.eventId, email: { equals: session.email, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!me) return { ok: false, error: "You aren't in this tournament's field." };

  const existing = await prisma.sideGameEntry.findUnique({
    where: { sideGameId_playerId: { sideGameId, playerId: me.id } },
  });

  if (!join) {
    if (existing?.confirmed) {
      return { ok: false, error: "The organizer has your money for this one — ask them to take you out." };
    }
    if (existing) await prisma.sideGameEntry.delete({ where: { id: existing.id } });
    revalidatePath("/", "layout");
    return { ok: true };
  }

  if (existing) return { ok: true };
  await prisma.sideGameEntry.create({
    data: { sideGameId, playerId: me.id, confirmed: false },
  });
  await logMoney(session.eventId, "sidegame.request", `${me.name} asked to join ${game.kind}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** The organizer says the cash is in. This is what puts a stake in the pot. */
export async function confirmSideGameEntry(
  sideGameId: string,
  playerId: string,
  paid: boolean,
): Promise<SideGameResult> {
  const { eventId } = await requireStaff();

  const game = await prisma.sideGame.findFirst({
    where: { id: sideGameId, eventId },
    select: { id: true, kind: true },
  });
  if (!game) return { ok: false, error: "That side game isn't in this tournament." };

  const entry = await prisma.sideGameEntry.findUnique({
    where: { sideGameId_playerId: { sideGameId, playerId } },
  });
  if (!entry) return { ok: false, error: "They haven't put their name down." };

  await prisma.sideGameEntry.update({ where: { id: entry.id }, data: { confirmed: paid } });
  await logMoney(eventId, "sidegame.confirm", `${game.kind}: ${paid ? "took" : "un-took"} a stake`);
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
