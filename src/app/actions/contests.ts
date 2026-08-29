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

  /**
   * Replaces the CONFIRMED entrants, and leaves everybody else where they are.
   *
   * This used to delete every row for the contest and recreate the ids it was
   * given, which destroyed two kinds of row that were not its business:
   *
   *   - a player the organizer had explicitly taken OUT. Their row is the only
   *     record of that decision, and in an opt-out pot a player with no row is
   *     in and settled — so deleting it put them straight back in the pot and
   *     charged them the buy-in, from an unrelated tick on somebody else.
   *   - a player's outstanding ask. `ContestEntry.confirmed` defaults to TRUE,
   *     so an unconfirmed self-signup either vanished from the collect list
   *     with nothing to show it was made, or came back as a paid stake the
   *     organizer never collected.
   *
   * Both sibling actions were fixed for exactly this and say so at length —
   * `setSideGameEntrants` and `setSkinsEntrants`. Contests, which is where the
   * confirmed-defaults-true rule is actually documented, is the one reader
   * that never got it.
   *
   * An id explicitly passed in IS confirmed: an organizer ticking somebody in
   * is the confirmation.
   */
  await prisma.$transaction([
    prisma.contestEntry.deleteMany({
      where: { contestId, OR: [{ confirmed: true, excluded: false }, { playerId: { in: ids } }] },
    }),
    prisma.contestEntry.createMany({
      data: ids.map((playerId) => ({
        contestId,
        playerId,
        won: stillWinning.has(playerId),
        confirmed: true,
      })),
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
  //
  // `confirmed: false` says so explicitly. Omitting it took the column's
  // default, which is TRUE, so the row created to record a win also charged
  // that player the buy-in — the exact opposite of the sentence above it.
  for (const playerId of winners) {
    await prisma.contestEntry.upsert({
      where: { contestId_playerId: { contestId, playerId } },
      update: { won: true },
      create: { contestId, playerId, won: true, confirmed: false },
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

/**
 * A player putting their own name down, from the app.
 *
 * This is an INTENTION, not a stake. The money is cash on the first tee, so
 * the row is written unconfirmed and contributes nothing to anybody's balance
 * until the organizer says they have it — counting it earlier would tell three
 * other people they are owed money that does not exist, which is the failure
 * an expense ledger cannot survive.
 *
 * A player may only ever put down (or withdraw) THEMSELVES, matched on the
 * registration email the way every score guard does it. And they cannot
 * withdraw once the organizer has taken the cash: that is a conversation, not
 * a button.
 */
export async function requestContestEntry(contestId: string, join: boolean): Promise<ContestResult> {
  const session = await getSession();
  if (!session?.eventId) throw new Error("Not signed in");

  const contest = await prisma.contest.findFirst({
    where: { id: contestId, eventId: session.eventId },
    select: { id: true, name: true, entryMode: true },
  });
  if (!contest) return { ok: false, error: "That bet isn't in this tournament." };

  const me = await prisma.player.findFirst({
    where: { eventId: session.eventId, email: { equals: session.email, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!me) return { ok: false, error: "You aren't in this tournament's field." };

  const existing = await prisma.contestEntry.findUnique({
    where: { contestId_playerId: { contestId, playerId: me.id } },
  });

  /**
   * An opt-out pot starts with everybody in, so both taps mean the opposite
   * thing and neither of them is a row saying "asked to join".
   *
   * Writing one anyway is what this used to do, and `potMembership` reads an
   * unconfirmed row as "the organizer has not been paid" — which in opt-out
   * mode moves the player from `entrants` to `pending`. So tapping a button
   * labelled "I'm in" was the single act that took a player OUT of the pot,
   * shrank it by their buy-in, and disqualified them from winning it.
   *
   * Here "out" is an EXCLUSION, which is the column that exists for a decision
   * about playing, and "in" is the removal of one. `confirmed` stays a
   * decision about money and is left to the organizer.
   */
  if (contest.entryMode === "opt-out") {
    if (join) {
      // Already in — the only thing that can be keeping them out is an
      // exclusion, so clear it. Nothing else to write.
      if (existing?.excluded) {
        await prisma.contestEntry.delete({ where: { id: existing.id } });
        await logMoney(session.eventId, "contest.request", `${me.name} opted back into ${contest.name}`);
      }
      revalidatePath("/", "layout");
      return { ok: true };
    }
    if (existing?.confirmed && !existing.excluded) {
      return { ok: false, error: "The organizer has your money for this one — ask them to take you out." };
    }
    await prisma.contestEntry.upsert({
      where: { contestId_playerId: { contestId, playerId: me.id } },
      update: { excluded: true, confirmed: false },
      create: { contestId, playerId: me.id, excluded: true, confirmed: false },
    });
    await logMoney(session.eventId, "contest.request", `${me.name} opted out of ${contest.name}`);
    revalidatePath("/", "layout");
    return { ok: true };
  }

  if (!join) {
    if (existing?.confirmed) {
      return { ok: false, error: "The organizer has your money for this one — ask them to take you out." };
    }
    if (existing) await prisma.contestEntry.delete({ where: { id: existing.id } });
    revalidatePath("/", "layout");
    return { ok: true };
  }

  if (existing) return { ok: true };
  await prisma.contestEntry.create({
    data: { contestId, playerId: me.id, confirmed: false },
  });
  await logMoney(session.eventId, "contest.request", `${me.name} asked to join ${contest.name}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** The organizer says the cash is in. This is what puts a stake in the pot. */
export async function confirmContestEntry(
  contestId: string,
  playerId: string,
  paid: boolean,
): Promise<ContestResult> {
  const { eventId } = await requireStaff();
  const contest = await contestInEvent(eventId, contestId);

  const entry = await prisma.contestEntry.findUnique({
    where: { contestId_playerId: { contestId, playerId } },
  });
  if (!entry) return { ok: false, error: "They haven't put their name down." };

  await prisma.contestEntry.update({ where: { id: entry.id }, data: { confirmed: paid } });
  await logMoney(
    eventId,
    "contest.confirm",
    `${contest.name}: ${paid ? "took" : "un-took"} ${playerId}'s stake`,
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
