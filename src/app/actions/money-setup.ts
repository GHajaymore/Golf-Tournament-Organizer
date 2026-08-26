"use server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { currencyForEvent } from "@/lib/services/organization";
import { minorUnitsFrom, money } from "@/lib/domain/money-format";
import { revalidatePath } from "next/cache";
import { isMoneyMode } from "@/lib/domain/money-mode";
import { isPotEntryMode } from "@/lib/domain/pot-entry";
import { isValidAmount, MAX_EXPENSE_CENTS } from "@/lib/domain/expenses";
import { isIsoDate } from "@/lib/deadline";

/**
 * Choosing how a tournament handles money, and running the kitty.
 *
 * Same rules as the expense actions next door, for the same reason — these
 * write about money:
 *
 *  - every id is narrowed to `session.eventId` in the same where clause it is
 *    used in, so a caller-supplied id can only ever match a row in this
 *    tournament;
 *  - organizers only, because the mode decides what an entire screen shows and
 *    the kitty is the club's own book rather than a shared ledger;
 *  - every write is audited. A money figure that changed with nobody's name
 *    against it is one a committee cannot settle an argument about.
 */

export interface MoneyResult {
  ok: boolean;
  error?: string;
}

async function requireOrganizer(): Promise<{ eventId: string; name: string } | null> {
  const session = await getSession();
  if (!session?.eventId) return null;
  if (session.role !== "admin" && session.role !== "assistant") return null;
  return { eventId: session.eventId, name: session.name };
}

function refresh() {
  revalidatePath("/", "layout");
}

/** Log a money change, the way the expense actions do. */
async function logMoney(eventId: string, actor: string, action: string, detail: string) {
  await prisma.auditLog.create({
    data: { eventId, matchId: null, actor: actor || "system", action, detail },
  });
}

/**
 * What THIS tournament does with money.
 *
 * An empty string is a real value here and means "follow the club" — which is
 * how a tournament goes back to the default after being set, rather than being
 * stuck with whatever was chosen once.
 */
export async function setEventMoneyMode(mode: string): Promise<MoneyResult> {
  const who = await requireOrganizer();
  if (!who) return { ok: false, error: "An organizer sets how money is handled." };
  const clean = (mode ?? "").trim();
  if (clean !== "" && !isMoneyMode(clean)) return { ok: false, error: "Unknown money setting." };

  await prisma.event.update({ where: { id: who.eventId }, data: { moneyMode: clean } });
  await logMoney(who.eventId, who.name, "money.mode", `${who.name} set this tournament to ${clean || "follow the club"}`);
  refresh();
  return { ok: true };
}

/** The club's default, for every tournament that has not chosen its own. */
export async function setOrgMoneyMode(mode: string): Promise<MoneyResult> {
  const who = await requireOrganizer();
  if (!who) return { ok: false, error: "An organizer sets how money is handled." };
  const clean = (mode ?? "").trim();
  if (clean !== "" && !isMoneyMode(clean)) return { ok: false, error: "Unknown money setting." };

  // Reached through the event, the same way the roster is: an organizer may
  // set the default of the club that owns the tournament they are running.
  const event = await prisma.event.findUnique({
    where: { id: who.eventId },
    select: { organizationId: true },
  });
  if (!event) return { ok: false, error: "Tournament not found." };

  await prisma.organization.update({ where: { id: event.organizationId }, data: { moneyMode: clean } });
  await logMoney(who.eventId, who.name, "money.mode.club", `${who.name} set the club default to ${clean || "follow the kind"}`);
  refresh();
  return { ok: true };
}

/**
 * Whether a pot is opt-in or opt-out.
 *
 * Two ids, one action, because the two pot types differ only in which table
 * they live in and an organizer thinks of them as one thing.
 */
export async function setPotEntryMode(
  potType: "contest" | "sideGame",
  potId: string,
  mode: string,
): Promise<MoneyResult> {
  const who = await requireOrganizer();
  if (!who) return { ok: false, error: "An organizer sets who is in a pot." };
  if (!isPotEntryMode(mode)) return { ok: false, error: "Unknown entry setting." };

  if (potType === "contest") {
    const r = await prisma.contest.updateMany({
      where: { id: potId, eventId: who.eventId },
      data: { entryMode: mode },
    });
    if (r.count === 0) return { ok: false, error: "That contest isn't in this tournament." };
  } else {
    const r = await prisma.sideGame.updateMany({
      where: { id: potId, eventId: who.eventId },
      data: { entryMode: mode },
    });
    if (r.count === 0) return { ok: false, error: "That side game isn't in this tournament." };
  }

  await logMoney(who.eventId, who.name, "pot.entry-mode", `${who.name} set a pot to ${mode}`);
  refresh();
  return { ok: true };
}

/**
 * Take somebody out of an opt-out pot, or put them back.
 *
 * The row is created when they are excluded and deleted when they are put
 * back, so an opt-out pot with nobody excluded carries no rows at all —
 * which is what makes "everyone is in" true without forty rows saying so.
 */
export async function setPotExcluded(
  potType: "contest" | "sideGame",
  potId: string,
  playerId: string,
  excluded: boolean,
): Promise<MoneyResult> {
  const who = await requireOrganizer();
  if (!who) return { ok: false, error: "An organizer sets who is in a pot." };

  // The player must be in THIS tournament's field, and the pot in this
  // tournament — neither id is trusted from the browser.
  const player = await prisma.player.findFirst({
    where: { id: playerId, eventId: who.eventId },
    select: { id: true, name: true },
  });
  if (!player) return { ok: false, error: "That player isn't in this tournament." };

  if (potType === "contest") {
    const pot = await prisma.contest.findFirst({
      where: { id: potId, eventId: who.eventId },
      select: { id: true },
    });
    if (!pot) return { ok: false, error: "That contest isn't in this tournament." };
    if (excluded) {
      await prisma.contestEntry.upsert({
        where: { contestId_playerId: { contestId: pot.id, playerId } },
        create: { contestId: pot.id, playerId, excluded: true, confirmed: false },
        update: { excluded: true },
      });
    } else {
      await prisma.contestEntry.deleteMany({ where: { contestId: pot.id, playerId, excluded: true } });
    }
  } else {
    const pot = await prisma.sideGame.findFirst({
      where: { id: potId, eventId: who.eventId },
      select: { id: true },
    });
    if (!pot) return { ok: false, error: "That side game isn't in this tournament." };
    if (excluded) {
      await prisma.sideGameEntry.upsert({
        where: { sideGameId_playerId: { sideGameId: pot.id, playerId } },
        create: { sideGameId: pot.id, playerId, excluded: true, confirmed: false },
        update: { excluded: true },
      });
    } else {
      await prisma.sideGameEntry.deleteMany({ where: { sideGameId: pot.id, playerId, excluded: true } });
    }
  }

  await logMoney(
    who.eventId,
    who.name,
    "pot.excluded",
    `${who.name} ${excluded ? "took" : "put"} ${player.name} ${excluded ? "out of" : "back in"} a pot`,
  );
  refresh();
  return { ok: true };
}

export interface FundInput {
  direction: string;
  description: string;
  amount: string;
  category?: string;
  occurredOn?: string;
  stageId?: string;
}

/** Add a line to the tournament's kitty — a fee collected, or a cost paid. */
export async function addFundLine(input: FundInput): Promise<MoneyResult> {
  const who = await requireOrganizer();
  if (!who) return { ok: false, error: "An organizer keeps the kitty." };

  const direction = input.direction === "in" ? "in" : input.direction === "out" ? "out" : "";
  if (!direction) return { ok: false, error: "Say whether that is money in or money out." };

  const description = (input.description ?? "").trim().slice(0, 200);
  if (!description) return { ok: false, error: "What was it for?" };

  // The same reading and the same ceiling as an expense, so the two money
  // features cannot disagree about what a valid amount is — AND the same
  // reader, in the club's own currency.
  //
  // This multiplied by a hundred, which is only right where a hundred minor
  // units make one. A Tokyo club entering a ¥5,000 entry fee stored ¥500,000
  // and the kitty was out by a hundredfold from the first line. `money()` was
  // taught about currency and this was not; a parser and a formatter that
  // disagree is the same one-rule-two-readers fault, in the half that writes.
  const currency = await currencyForEvent(who.eventId);
  const amountCents = minorUnitsFrom((input.amount ?? "").toString(), currency);
  if (!isValidAmount(amountCents)) {
    return { ok: false, error: `Enter an amount up to ${money(MAX_EXPENSE_CENTS, currency)}.` };
  }
  if (amountCents <= 0) return { ok: false, error: "An amount of zero isn’t a line." };

  const occurredOn = (input.occurredOn ?? "").trim();
  if (occurredOn && !isIsoDate(occurredOn)) return { ok: false, error: "That date doesn't look right." };

  // A round id is optional and, when given, must be one of this tournament's.
  const stageId = (input.stageId ?? "").trim();
  if (stageId) {
    const stage = await prisma.stage.findFirst({
      where: { id: stageId, eventId: who.eventId },
      select: { id: true },
    });
    if (!stage) return { ok: false, error: "That round isn't in this tournament." };
  }

  await prisma.tournamentFund.create({
    data: {
      eventId: who.eventId,
      stageId,
      direction,
      description,
      amountCents,
      category: (input.category ?? "").trim().slice(0, 40),
      occurredOn,
      createdBy: who.name,
    },
  });
  await logMoney(
    who.eventId,
    who.name,
    "fund.add",
    `${who.name} recorded ${direction === "in" ? "money in" : "money out"}: ${description}`,
  );
  refresh();
  return { ok: true };
}

export async function removeFundLine(lineId: string): Promise<MoneyResult> {
  const who = await requireOrganizer();
  if (!who) return { ok: false, error: "An organizer keeps the kitty." };

  const r = await prisma.tournamentFund.deleteMany({ where: { id: lineId, eventId: who.eventId } });
  if (r.count === 0) return { ok: false, error: "That line isn't in this tournament." };

  await logMoney(who.eventId, who.name, "fund.remove", `${who.name} removed a kitty line`);
  refresh();
  return { ok: true };
}
