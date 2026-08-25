"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isDerivedKind, DERIVED_LABEL } from "@/lib/domain/derived-games";
import { MAX_EXPENSE_CENTS } from "@/lib/domain/expenses";
import { requirePotAccess } from "@/lib/services/game-access";
import { potAudience } from "@/lib/domain/pot-audience";

/**
 * The side bets the cards settle: low gross, low net, birdies, eagles, Nassau.
 *
 * Note what is missing on purpose — there is no "set the winner" action. These
 * are DERIVED, so a winner comes from the scores and nothing else; an action
 * that let one be typed would let a stored result contradict the cards it was
 * supposed to come from. All anyone decides is that the bet exists, what it
 * costs, and who is in.
 *
 * WHO decides is `requirePotAccess`, the same reader the skins pot uses. The
 * organizer runs the tournament's money; a fourball runs its own. Two players
 * agreeing a bet on the first tee should not have to find the organizer, and
 * until this shared the skins rule they did — a group could run its own skins
 * and not its own birdie pot, which was the same money under two rules.
 *
 * Every write is audited. Records money, never moves it.
 */

export interface SideGameResult {
  ok: boolean;
  error?: string;
  id?: string;
}

/** The signed-in caller's display name, for the audit trail. */
async function actorName(): Promise<string> {
  const session = await getSession();
  return session?.name || session?.email || "";
}

/**
 * One game, and the proof that this caller may write it.
 *
 * The row is fetched by id ALONE, because the question `requirePotAccess`
 * answers needs the game's own stage and group key — facts from the database,
 * not a claim from the caller, who over HTTP will send whatever they like.
 * Scoping the query to a claimed event first would ask the wrong question.
 *
 * The ownership check is INSIDE this function rather than left to each caller.
 * Three actions need it, and a check you must remember to write after every
 * lookup is a check that will eventually be missed — the difference between
 * this and a plain `gameById` is that forgetting is no longer possible.
 *
 * A refusal comes back as a RESULT, not a throw. "That fourball is not yours"
 * is an ordinary thing to tell a player, and the screens already know how to
 * show `{ ok: false, error }`; thrown, it reached the browser as a crash.
 *
 * A game that does not exist and a game that is somebody else's give the same
 * message on purpose. Telling a stranger that a game exists but is not theirs
 * is itself a disclosure.
 */
type GameAccess =
  | { ok: true; game: { id: string; kind: string; stageId: string; groupKey: string }; eventId: string }
  | { ok: false; error: string };

const NOT_YOURS = "That side game isn't in this tournament.";

async function requireGameAccess(sideGameId: string): Promise<GameAccess> {
  const game = await prisma.sideGame.findUnique({
    where: { id: sideGameId },
    select: { id: true, kind: true, eventId: true, stageId: true, groupKey: true },
  });
  if (!game) return { ok: false, error: NOT_YOURS };

  // The refusal is carried out rather than thrown, so a player told "that
  // fourball is not yours" gets a sentence instead of a crashed screen.
  const access = await requirePotAccess(game.stageId, game.groupKey);
  if (!access.ok) return { ok: false, error: access.error };
  if (game.eventId !== access.eventId) return { ok: false, error: NOT_YOURS };

  return { ok: true, game, eventId: access.eventId };
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

  // Staff for the field's game; the group itself for a group's. A group's own
  // game is settled now — `gameNets` resolves each game's AUDIENCE from the
  // round's tee sheet, so an opt-out birdie pot belonging to a fourball enters
  // those four rather than the whole field. This was refused outright until
  // that was true, which is why the refusal is gone rather than relaxed.
  const access = await requirePotAccess(stageId, groupKey);
  if (!access.ok) return { ok: false, error: access.error };
  const eventId = access.eventId;
  const name = await actorName();

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
    // groupKey in the CREATE too. Omitted, a fourball's game was written as
    // the field's — or collided with the field's existing row on the unique
    // key and threw. The where clause knew about the group and the create
    // did not, which is the shape that always writes to the wrong row.
    create: { eventId, stageId, kind, groupKey, buyInCents: cents, createdBy: name },
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
  const found = await requireGameAccess(sideGameId);
  if (!found.ok) return { ok: false, error: found.error };
  const { game, eventId } = found;

  const rows = await prisma.player.findMany({
    where: { eventId, id: { in: [...new Set(playerIds.filter(Boolean))] } },
    select: { id: true },
  });

  /**
   * AND ONLY PEOPLE THE GAME IS ACTUALLY OFFERED TO.
   *
   * Being in the field is not enough for a group's game. `potAudience` is the
   * same reader the settle-up uses to decide who a group's pot may charge, so
   * the two cannot disagree about who is in it — and without this, one player
   * in a fourball could stake three strangers in a bet they never heard of,
   * which is money appearing in somebody else's settle-up.
   *
   * For the field's game and for an ad-hoc name it returns the whole field, so
   * this narrows nothing there. It is refused rather than silently dropped: a
   * picker that quietly loses two of the six names you ticked is worse than
   * one that says so.
   */
  const stage = await prisma.stage.findUnique({
    where: { id: game.stageId },
    select: { teeSheet: true },
  });
  const field = await prisma.player.findMany({
    where: { eventId, status: "confirmed" },
    select: { id: true },
  });
  const allowed = new Set(
    potAudience(game.groupKey, stage?.teeSheet ?? "", field.map((p) => p.id)),
  );
  if (rows.some((r) => !allowed.has(r.id))) {
    return { ok: false, error: "Somebody you picked isn't in this game's group." };
  }

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

/**
 * Somebody says the cash is in. This is what puts a stake in the pot.
 *
 * The organizer for the field's game; anyone in the group for a group's,
 * because a fourball settling a £5 birdie pot between themselves has no
 * organizer standing over it and should not need one.
 */
export async function confirmSideGameEntry(
  sideGameId: string,
  playerId: string,
  paid: boolean,
): Promise<SideGameResult> {
  const found = await requireGameAccess(sideGameId);
  if (!found.ok) return { ok: false, error: found.error };
  const { game, eventId } = found;

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
  const found = await requireGameAccess(sideGameId);
  if (!found.ok) return { ok: false, error: found.error };
  const { game, eventId } = found;

  await prisma.sideGame.delete({ where: { id: game.id } });
  await logMoney(eventId, "sidegame.remove", `Removed ${game.kind}`);
  revalidatePath("/", "layout");
  return { ok: true };
}
