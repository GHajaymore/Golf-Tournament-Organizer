"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { isSkinsScope } from "@/lib/domain/skins-pot";
import { perPlayerPotRefusal } from "@/lib/domain/shared-ball";
import { parseTeeSheet } from "@/lib/domain/tee-sheet";
import { requirePotAccess } from "@/lib/services/game-access";
import { getSession } from "@/lib/auth";
import { potAudience } from "@/lib/domain/pot-audience";
import { STAKE_NOTE_MAX } from "@/lib/domain/quick-match";
import { MAX_EXPENSE_CENTS } from "@/lib/domain/expenses";
import { logAudit } from "@/lib/services/action-shared";

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
 * EVERY WRITE IS AUDITED, which this file did not do for the whole of its
 * life. Its sibling says the rule in one line — "Every write is audited.
 * Records money, never moves it." — and the expense actions say why: "Money
 * actions in this app did not log, and the 2026-08-12 audit called that out. A
 * number that changed with nobody's name against it is a number a group cannot
 * resolve an argument about."
 *
 * Skins is the same money under a different name, and the commonest bet in
 * club golf: a pot that ran every Saturday could be re-priced, emptied or
 * deleted with nothing recording who did it. Found by sweeping every server
 * action that writes a money row for the audit line beside it, 2026-09-13.
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
 * The pot, named the way a person would name it.
 *
 * "net front 9" rather than a row id, and the group when there is one — a
 * league night runs four of these and an audit line naming none of them is
 * only marginally better than no line at all.
 */
function potName(net: boolean, scope: string, groupKey: string): string {
  const holes = scope === "front" ? " front 9" : scope === "back" ? " back 9" : "";
  const who = groupKey ? `${groupKey} ` : "";
  return `${who}${net ? "net" : "gross"}${holes} skins`;
}

/**
 * This round's format, for the guard below. One line, but its own function:
 * the refusal is about golf and belongs next to the rule, not inlined into a
 * validation block where the next reader will not see it.
 */
async function formatOfStage(stageId: string): Promise<string> {
  const stage = await prisma.stage.findUnique({ where: { id: stageId }, select: { format: true } });
  return stage?.format ?? "";
}

/**
 * Set up (or change) the pot on a round.
 *
 * Creates it on first save, so an organizer never has to "start a pot" as a
 * separate step before setting a buy-in.
 */
export async function saveSkinsPot(
  stageId: string,
  input: {
    buyInCents: number;
    net: boolean;
    scope: string;
    groupKey?: string;
    /**
     * What the pot is being played for, when that is not money.
     *
     * Ignored the moment a buy-in is passed — see the note beside the write.
     * Optional, so every existing caller keeps writing what it wrote before.
     */
    stakeNote?: string;
  },
): Promise<SkinsResult> {
  const groupKey = (input.groupKey ?? "").trim();
  // Staff for the field's pot; a player in that fourball for the group's own.
  const access = await requirePotAccess(stageId, groupKey);
  if (!access.ok) return { ok: false, error: access.error };
  const eventId = access.eventId;

  const buyIn = Math.round(input.buyInCents);
  // Bounded top AND bottom, the same ceiling every other money action uses
  // (side-games.ts, contests.ts). requirePotAccess lets a PLAYER set their own
  // fourball's pot, so an unbounded buy-in here is an untrusted number reaching
  // the settle-up maths — buyIn × entrants flows straight into the ledger.
  if (!Number.isFinite(buyIn) || buyIn < 0 || buyIn > MAX_EXPENSE_CENTS) {
    return { ok: false, error: "Enter a buy-in per player, or zero to switch it off." };
  }
  /**
   * NOT ON A ROUND WHERE THE SIDE PLAYS ONE BALL.
   *
   * Skins are decided hole by hole between PLAYERS, and a foursomes has no
   * individual score to decide them with — `round-cards.ts` keeps foursomes
   * out of the per-player cards for exactly that reason, and is right to.
   *
   * What that left was a pot an organizer could take £5 a head for and which
   * could never settle: no per-player cards, so no standings, so "Nothing
   * settled yet" over eight complete cards, for ever. Measured on a seeded
   * foursomes on 2026-09-20.
   *
   * At the WRITE, because a `"use server"` export is a public endpoint and the
   * screen hiding the control stops nobody.
   */
  const refusal = perPlayerPotRefusal(await formatOfStage(stageId));
  if (refusal) return { ok: false, error: refusal };
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
  // Money and a "playing for a pint" note are two different agreements about
  // the same pot, so a buy-in replaces the note. Enforced at the write, for
  // the reason `saveSideGame` gives at length.
  const note = buyIn > 0 ? "" : (input.stakeNote ?? "").trim().slice(0, STAKE_NOTE_MAX);
  const data = { buyInCents: buyIn, stakeNote: note };
  await prisma.skinsPot.upsert({
    where: { stageId_net_scope_groupKey: { stageId, net: input.net, scope: input.scope, groupKey } },
    create: { eventId, stageId, net: input.net, scope: input.scope, groupKey, ...data },
    update: data,
  });
  await logAudit(
    eventId,
    "skins.pot",
    `${potName(input.net, input.scope, groupKey)} set to ${buyIn > 0 ? `${buyIn}c a head` : note || "no stake"}`,
  );
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
  const access = await requirePotAccess(stageId, key);
  if (!access.ok) return { ok: false, error: access.error };
  const eventId = access.eventId;
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
    } else if (!access.isStaff) {
      /**
       * AN AD-HOC NAME, and the caller is a player rather than the organizer.
       *
       * The comment above says an ad-hoc bet "is bounded instead by who may
       * write it at all" — and it was not bounded by anything. Inventing a
       * name is deliberately open to any player in the field, because six
       * friends across three fourballs is the case it exists for. So a player
       * could invent "Sunday Special" at £500 a head and then name EVERY
       * confirmed player in the tournament as an entrant. Forty stakes are
       * written, the settle-up charges all forty, and nobody agreed to any of
       * it. `requirePotAccess` claims in its own comment that an ad-hoc name
       * has "no set of players it can silently enter" — true of the opt-out
       * inference it was written about, and false of this setter beside it.
       *
       * A player may confirm a stake somebody ASKED for; they may not create
       * one on that person's behalf. So the names allowed here are the ones
       * who already have a row of their own under this name — put down by
       * `requestSkinsEntry`, which only ever writes the caller — plus the
       * caller themselves. Six friends each tap "I'm in" and one of them ticks
       * them off, which is exactly what the pending-and-confirm machinery is
       * for. An organizer is unaffected: staff may name anyone.
       */
      const asked = await prisma.skinsPot.findMany({
        where: { stageId, groupKey: key },
        select: { entrants: { select: { playerId: true } } },
      });
      const consented = new Set(asked.flatMap((p) => p.entrants.map((e) => e.playerId)));
      if (access.playerId) consented.add(access.playerId);
      const uninvited = ids.filter((id) => !consented.has(id));
      if (uninvited.length > 0) {
        return {
          ok: false,
          error:
            uninvited.length === 1
              ? "One of those players hasn't asked to join this bet. They can put their own name down, then you can tick them in."
              : `${uninvited.length} of those players haven't asked to join this bet. They can put their own names down, then you can tick them in.`,
        };
      }
    }
  }

  const pot = await prisma.skinsPot.upsert({
    where: { stageId_net_scope_groupKey: { stageId, net, scope, groupKey: key } },
    create: { eventId, stageId, net, scope, groupKey: key },
    update: {},
  });

  /**
   * Replaces the CONFIRMED entrants, and leaves people still waiting to pay
   * exactly where they are.
   *
   * The same shape `setSideGameEntrants` already had to be taught, for the
   * same reason and now that skins entries carry `confirmed` too. This used to
   * delete every row not in the list — so somebody nudging one chip silently
   * wiped every outstanding request to join, and the player's ask vanished
   * with nothing to show they had made it. It went the other way as well: an
   * id passed in overwrote a pending row as confirmed, which is right when a
   * human ticks somebody in and wrong when it happens as a side effect.
   *
   * An id explicitly passed in IS confirmed — ticking somebody in is the
   * confirmation. Anyone pending and not named keeps their unconfirmed row and
   * stays on the list of people to collect from.
   */
  await prisma.$transaction([
    prisma.skinsEntry.deleteMany({
      where: { potId: pot.id, OR: [{ confirmed: true }, { playerId: { in: ids } }] },
    }),
    prisma.skinsEntry.createMany({
      data: ids.map((playerId) => ({ potId: pot.id, playerId, confirmed: true })),
      skipDuplicates: true,
    }),
  ]);
  await logAudit(eventId, "skins.entrants", `${potName(net, scope, key)}: ${ids.length} in`);
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
  const access = await requirePotAccess(stageId, key);
  if (!access.ok) return { ok: false, error: access.error };
  const eventId = access.eventId;
  if (!isSkinsScope(scope)) {
    return { ok: false, error: "Choose the front nine, the back nine, or all eighteen." };
  }
  // Exactly the pot named, and nothing beside it.
  await prisma.skinsPot.deleteMany({ where: { stageId, eventId, net, scope, groupKey: key } });
  await logAudit(eventId, "skins.pot.remove", `Removed ${potName(net, scope, key)}`);
  refresh();
  return { ok: true };
}

/**
 * A player asking to get in on a skins pot, from their own phone.
 *
 * Skins was the only pot nobody could ask to join. Every other bet had an
 * `confirmed` flag, so a name could be put down as an INTENTION and turned
 * into a stake when the cash appeared; a skins entry was instantly real money,
 * which left no way to say "I want in" that did not also say "I have paid".
 * So the answer to "can I join your skins?" was to find somebody already in it
 * and ask them to tick you — on paper, in practice.
 *
 * Deliberately NOT gated by `requirePotAccess`. That rule answers "may you
 * change this bet", and the whole point here is somebody who cannot. What
 * gates it instead is the pot's AUDIENCE — the same `potAudience` the settle-up
 * uses — so a bet named after a fourball stays that fourball's, while an
 * ad-hoc bet is open to anyone in the field, which is what makes a game across
 * three groups possible without an organizer.
 *
 * It writes an unconfirmed row and nothing else. It cannot move money, cannot
 * enter anybody but the caller, and cannot take somebody out once their stake
 * is in — that would let a player pocket a losing bet by leaving it.
 */
export async function requestSkinsEntry(
  stageId: string,
  net: boolean,
  scope: string,
  groupKeyInput: string,
  join: boolean,
): Promise<SkinsResult> {
  const session = await getSession();
  if (!session?.eventId) return { ok: false, error: "Not signed in" };
  const eventId = session.eventId;
  const key = (groupKeyInput ?? "").trim();

  if (!isSkinsScope(scope)) {
    return { ok: false, error: "Choose the front nine, the back nine, or all eighteen." };
  }

  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId },
    select: { id: true, teeSheet: true },
  });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };

  const me = await prisma.player.findFirst({
    where: {
      eventId,
      email: { equals: (session.email ?? "").trim(), mode: "insensitive" },
      status: "confirmed",
    },
    select: { id: true },
  });
  if (!me) return { ok: false, error: "You aren't in this tournament's field." };

  const pot = await prisma.skinsPot.findUnique({
    where: { stageId_net_scope_groupKey: { stageId, net, scope, groupKey: key } },
    select: { id: true },
  });
  if (!pot) return { ok: false, error: "There's no pot like that on this round." };

  /**
   * WHO THIS POT IS EVEN OFFERED TO.
   *
   * The field for the club's pot and for an ad-hoc bet; that fourball for a
   * pot named after a tee-sheet group. Without this a player could put their
   * name down on any fourball's private game and appear on their collect list.
   */
  const field = await prisma.player.findMany({
    where: { eventId, status: "confirmed" },
    select: { id: true },
  });
  const audience = potAudience(key, stage.teeSheet ?? "", field.map((p) => p.id));
  if (!audience.includes(me.id)) {
    return { ok: false, error: "That game belongs to another group." };
  }

  const existing = await prisma.skinsEntry.findUnique({
    where: { potId_playerId: { potId: pot.id, playerId: me.id } },
    select: { id: true, confirmed: true },
  });

  if (!join) {
    // Once the stake is in, leaving is not the player's call — otherwise a
    // losing bet could be walked out of on the last green.
    if (existing?.confirmed) {
      return { ok: false, error: "Your money is in this one — ask somebody in it to take you out." };
    }
    if (existing) await prisma.skinsEntry.delete({ where: { id: existing.id } });
    await logAudit(eventId, "skins.request", `Took their name out of ${potName(net, scope, key)}`);
    refresh();
    return { ok: true };
  }

  if (existing) return { ok: true };
  // upsert, not create: a double-tap on flaky course wifi fires two requests
  // that both pass the existence check above, and a second create then throws
  // P2002 out of the action as a 500. The unique (potId, playerId) makes the
  // second an idempotent no-op instead.
  await prisma.skinsEntry.upsert({
    where: { potId_playerId: { potId: pot.id, playerId: me.id } },
    update: {},
    create: { potId: pot.id, playerId: me.id, confirmed: false },
  });
  await logAudit(eventId, "skins.request", `Asked to join ${potName(net, scope, key)}`);
  refresh();
  return { ok: true };
}

/**
 * Somebody in the bet says the cash is in. This is what makes it a stake.
 *
 * `requirePotAccess`, so it is the people whose money it is who decide — staff
 * for the club's pot, the group for a group's, and whoever is in an ad-hoc bet
 * for that. A request that anybody in the field could confirm would make the
 * unconfirmed row pointless.
 */
export async function confirmSkinsEntry(
  stageId: string,
  net: boolean,
  scope: string,
  groupKeyInput: string,
  playerId: string,
  paid: boolean,
): Promise<SkinsResult> {
  const key = (groupKeyInput ?? "").trim();
  const access = await requirePotAccess(stageId, key);
  if (!access.ok) return { ok: false, error: access.error };

  if (!isSkinsScope(scope)) {
    return { ok: false, error: "Choose the front nine, the back nine, or all eighteen." };
  }

  const pot = await prisma.skinsPot.findUnique({
    where: { stageId_net_scope_groupKey: { stageId, net, scope, groupKey: key } },
    select: { id: true, eventId: true },
  });
  if (!pot || pot.eventId !== access.eventId) {
    return { ok: false, error: "There's no pot like that on this round." };
  }

  /**
   * The entry, with the tournament named in the query itself.
   *
   * `playerId` arrives over HTTP. Reading it by composite key alone would be
   * safe here — the pot is already proven to be this event's, so a foreign id
   * finds nothing — but safe *because of something proven three statements
   * ago* is exactly the shape that stops being true when somebody edits the
   * lines in between. The scope is written where the id is used.
   */
  const entry = await prisma.skinsEntry.findFirst({
    where: { playerId, pot: { id: pot.id, eventId: access.eventId } },
    select: { id: true },
  });
  if (!entry) return { ok: false, error: "They haven't put their name down." };

  await prisma.skinsEntry.update({ where: { id: entry.id }, data: { confirmed: paid } });
  /**
   * The line that matters most in this file. This is somebody recording that
   * cash did or did not change hands, and it decides whether that player is in
   * the pot when it settles — so "who said they had paid" is precisely the
   * question a group comes back to.
   */
  await logAudit(
    access.eventId,
    "skins.confirm",
    `${paid ? "Took" : "Un-took"} a stake in ${potName(net, scope, key)} from player ${playerId}`,
  );
  refresh();
  return { ok: true };
}
