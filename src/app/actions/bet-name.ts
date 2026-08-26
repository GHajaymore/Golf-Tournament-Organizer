"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requirePotAccess, AD_HOC_NAME_MAX } from "@/lib/services/game-access";

/**
 * Renaming a side bet.
 *
 * The name is not a label on a bet — it IS the bet's key. Every game hangs off
 * `(round, kind, name)`, the settle-up groups by it, and `potAudience` reads it
 * to decide who a pot may charge. So this is not a text edit; it re-points
 * money, and it is written that way.
 *
 * It exists because the alternative was worse. There is no rename today, so
 * fixing a typo means deleting and recreating — and both entry tables are
 * `onDelete: Cascade`, so that destroys the entrant rows INCLUDING `confirmed`:
 * the record of who actually handed over cash. Asking four people who has paid
 * and re-ticking them from memory is not a way to fix a spelling, in an app
 * whose whole job is to record money.
 *
 * Allowed after the round has settled, deliberately. The money re-derives from
 * the cards, so a rename moves no figure; refusing it would freeze a typo in
 * place exactly when everybody is looking at it. Every rename is audited.
 *
 * Records money. Never moves it.
 */

export interface RenameResult {
  ok: boolean;
  error?: string;
}

export async function renameBet(
  stageId: string,
  fromKeyInput: string,
  toKeyInput: string,
): Promise<RenameResult> {
  const from = (fromKeyInput ?? "").trim();
  const to = (toKeyInput ?? "").trim();

  /**
   * The FIELD's game has no name to change.
   *
   * An empty key is the tournament's own pot, and its identity is "the club's"
   * rather than anything somebody typed. Letting it be renamed would turn the
   * field's money into a named bet that `potAudience` then resolves against a
   * tee sheet — the club's pot quietly becoming one fourball's.
   */
  if (!from) return { ok: false, error: "The club's own pot doesn't have a name to change." };
  if (!to) return { ok: false, error: "Give it a name." };
  if (to.length > AD_HOC_NAME_MAX) {
    return { ok: false, error: `Keep the name under ${AD_HOC_NAME_MAX} characters` };
  }
  if (from === to) return { ok: true };

  /**
   * BOTH names are checked, and that is the point.
   *
   * The old one says this bet is yours to change. The new one says you are
   * allowed to be called that — without it, rename is a way to acquire an
   * identity you could not have created: point your bet at "Group 1" and
   * `potAudience` resolves its audience to that fourball, which in opt-out
   * mode enters them and charges them the stake.
   */
  const mine = await requirePotAccess(stageId, from);
  if (!mine.ok) return { ok: false, error: mine.error };

  const target = await requirePotAccess(stageId, to);
  if (!target.ok) return { ok: false, error: target.error };

  const eventId = mine.eventId;

  /**
   * AND THE NEW NAME MUST BE FREE — of every game, not just this kind.
   *
   * The unique keys would not always stop this: a skins pot moving onto a name
   * that only has a birdie pot violates nothing, and the two would silently
   * become one crew's money under one label. The name is the identity, so any
   * existing use of it is a merge.
   */
  const [potsThere, gamesThere] = await Promise.all([
    prisma.skinsPot.count({ where: { stageId, groupKey: to } }),
    prisma.sideGame.count({ where: { stageId, groupKey: to } }),
  ]);
  if (potsThere + gamesThere > 0) {
    return { ok: false, error: `There is already a game called ${to} on this round.` };
  }

  /**
   * EVERY game under the old name moves together.
   *
   * A crew running skins and a birdie pot as one bet settles as one bet. Moving
   * the row somebody happened to be looking at would split their money into two
   * labels and leave half of it under a name nobody recognises.
   */
  const [pots, games] = await Promise.all([
    prisma.skinsPot.findMany({ where: { stageId, groupKey: from }, select: { id: true } }),
    prisma.sideGame.findMany({ where: { stageId, groupKey: from }, select: { id: true } }),
  ]);
  if (pots.length + games.length === 0) {
    return { ok: false, error: "There's no game by that name on this round." };
  }

  // One transaction: a rename that moved the skins and not the birdie pot
  // would leave one crew's money under two names, which is the failure this
  // whole action exists to prevent.
  await prisma.$transaction([
    prisma.skinsPot.updateMany({ where: { stageId, groupKey: from }, data: { groupKey: to } }),
    prisma.sideGame.updateMany({ where: { stageId, groupKey: from }, data: { groupKey: to } }),
  ]);

  const session = await getSession();
  await prisma.auditLog.create({
    data: {
      eventId,
      matchId: null,
      actor: session?.name ?? "system",
      action: "bet.rename",
      detail: `${from} is now ${to} (${pots.length + games.length} game(s))`,
    },
  });

  revalidatePath("/", "layout");
  return { ok: true };
}
