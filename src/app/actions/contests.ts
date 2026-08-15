"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isContestKind, CONTEST_LABEL } from "@/lib/domain/contests";
import { MAX_EXPENSE_CENTS } from "@/lib/domain/expenses";

/**
 * Side bets: closest to the pin, long drive, and whatever the first tee
 * invented.
 *
 * Organizer-run, like the skins pot and for the same reason: this is money
 * between players, and who won the long drive is a committee fact rather than
 * a self-report. Every export here is a public HTTP endpoint, so each one
 * proves the caller is staff and that every id belongs to their tournament.
 *
 * Every write is audited. These actions record money; they never move it.
 */

export interface ContestResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const NAME_MAX = 60;

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

/** The contest, proved to be in the caller's tournament. */
async function contestInEvent(eventId: string, contestId: string) {
  const contest = await prisma.contest.findFirst({
    where: { id: contestId, eventId },
    include: { entrants: true },
  });
  if (!contest) throw new Error("That contest isn't in this tournament");
  return contest;
}

/** The subset of the given ids that are really in this event's field. */
async function fieldIds(eventId: string, playerIds: string[]): Promise<string[]> {
  const rows = await prisma.player.findMany({
    where: { eventId, id: { in: [...new Set(playerIds.filter(Boolean))] } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function addContest(input: {
  kind: string;
  name: string;
  buyInCents: number;
  stageId?: string;
  hole?: number;
}): Promise<ContestResult> {
  const { eventId, name: by } = await requireStaff();

  const kind = isContestKind(input.kind) ? input.kind : "other";
  const name = (input.name ?? "").trim().slice(0, NAME_MAX) || CONTEST_LABEL[kind];

  const buyInCents = Math.round(Number(input.buyInCents));
  // A stake is never negative: a contest you get PAID to enter is not a
  // contest, and it would put money into the ledger from nowhere.
  if (!Number.isFinite(buyInCents) || buyInCents < 0 || buyInCents > MAX_EXPENSE_CENTS) {
    return { ok: false, error: "Enter a stake per player, or zero for a free contest." };
  }

  const stageId = (input.stageId ?? "").trim();
  if (stageId) {
    const stage = await prisma.stage.findFirst({ where: { id: stageId, eventId }, select: { id: true } });
    if (!stage) return { ok: false, error: "That round isn't in this tournament." };
  }

  const hole = Math.round(Number(input.hole ?? 0));
  const contest = await prisma.contest.create({
    data: {
      eventId,
      stageId,
      kind,
      name,
      hole: Number.isFinite(hole) && hole > 0 && hole <= 18 ? hole : 0,
      buyInCents,
      createdBy: by,
    },
  });

  await logMoney(eventId, "contest.add", `${name} at ${money(buyInCents)} a player`);
  revalidatePath("/", "layout");
  return { ok: true, id: contest.id };
}

/**
 * Who is in.
 *
 * Replaced wholesale rather than merged, and re-queried against the field so
 * an id the client invented cannot enter a stranger into a pot. Winners that
 * are no longer entrants are dropped with them — a contest cannot be won by
 * somebody who is not in it once the organizer has taken them out.
 */
export async function setContestEntrants(contestId: string, playerIds: string[]): Promise<ContestResult> {
  const { eventId } = await requireStaff();
  const contest = await contestInEvent(eventId, contestId);

  const ids = await fieldIds(eventId, playerIds);
  const stillWinning = new Set(
    contest.entrants.filter((e) => e.won).map((e) => e.playerId).filter((id) => ids.includes(id)),
  );

  await prisma.$transaction([
    prisma.contestEntry.deleteMany({ where: { contestId } }),
    prisma.contestEntry.createMany({
      data: ids.map((playerId) => ({ contestId, playerId, won: stillWinning.has(playerId) })),
    }),
  ]);

  await logMoney(eventId, "contest.entrants", `${contest.name}: ${ids.length} in`);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Who won it.
 *
 * More than one is a tie, and the pot splits between them to the cent. An
 * empty list puts the contest back to undecided, which pays and charges
 * nobody — the state a pot sits in while it is still being played for.
 */
export async function setContestWinners(contestId: string, winnerIds: string[]): Promise<ContestResult> {
  const { eventId } = await requireStaff();
  const contest = await contestInEvent(eventId, contestId);

  const winners = new Set(await fieldIds(eventId, winnerIds));

  await prisma.$transaction([
    prisma.contestEntry.updateMany({ where: { contestId }, data: { won: false } }),
    ...(winners.size
      ? [
          prisma.contestEntry.updateMany({
            where: { contestId, playerId: { in: [...winners] } },
            data: { won: true },
          }),
        ]
      : []),
  ]);

  // A winner who never staked is legal — see domain/contests — but they need
  // an entry row to be recorded on, so one is created without a stake.
  for (const playerId of winners) {
    await prisma.contestEntry.upsert({
      where: { contestId_playerId: { contestId, playerId } },
      update: { won: true },
      create: { contestId, playerId, won: true },
    });
  }

  await logMoney(
    eventId,
    "contest.winners",
    winners.size ? `${contest.name}: ${winners.size} winner(s)` : `${contest.name}: reopened`,
  );
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeContest(contestId: string): Promise<ContestResult> {
  const { eventId } = await requireStaff();
  const contest = await contestInEvent(eventId, contestId);

  // Entries cascade with the contest.
  await prisma.contest.delete({ where: { id: contest.id } });
  await logMoney(eventId, "contest.remove", `Removed ${contest.name}`);
  revalidatePath("/", "layout");
  return { ok: true };
}
