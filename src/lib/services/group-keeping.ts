import "server-only";
import { prisma } from "@/lib/db";
import { parseTeeSheet, type TeeSheet, type TeeSheetGroup } from "@/lib/domain/tee-sheet";
import { publishedFoursomes } from "@/lib/domain/group-entry";
import { roundScoring } from "@/lib/domain/round-scoring";
import { isMatch } from "@/lib/tournament-shape";
import {
  groupKeyFor,
  groupMembers,
  mayKeep,
  NO_GROUPS_YET,
  groupsArePublished,
  NOT_YOUR_GROUP,
  HAND_OVER_NOT_YOURS,
  HAND_OVER_OUTSIDE,
  type KeepingContext,
} from "@/lib/domain/group-keeping";
import { matchSidesOf } from "@/lib/services/attestation";
import { logAudit } from "@/lib/services/action-shared";

/**
 * THE SERVER'S HALF OF "ONE SCORER PER GROUP" (2026-11-04, sprint 2 part B).
 *
 * `domain/group-keeping.ts` decides; this loads what it decides on and writes
 * the one row (`ScoringKeeper`) that says who keeps a group's card. Every write
 * a player can make to a round's scores asks `keeperGate` first — the round-code
 * saves in `actions/play.ts` and the signed-in player's saves in
 * `actions/tournament.ts` alike — so a phone that is not the scorer is refused
 * whichever door it came through.
 *
 * Only on a round whose `scoreKeeping` is "group". On "each" (every round made
 * before this existed) the gate answers `applies: false` and the caller's own
 * rule — your own card, your own match — stands exactly as before.
 *
 * A CLAIM IS AN UPSERT on (stageId, groupKey), never a read-then-write: two
 * phones saving together leave one row, and the slower is told who has it.
 * The first phone to save a group's card becomes its scorer, which is what a
 * screen written before this rule (it sends no epoch and has no "I'll keep
 * score" button) needs to go on working.
 */

/**
 * THE ROUND'S OWN PUBLISHED TEE SHEET — never another round's (Golf Pro ruling,
 * 2026-11-05). A cup's four-ball session with no sheet of its own borrowed the
 * medal's, so its "group" was the medal's four and its title "Group 1", while
 * the match itself is the group the four-ball plays in. A round with no sheet
 * of its own has none: a match is then its own group (`groupKeyFor`).
 *
 * The one reader for who walked off together on a round: the keeper
 * (`keepingContextFor`, `groupTitleFor`) and the round-code screen's group list
 * (`playGroups` in actions/play.ts), so the list and the keeper cannot disagree.
 * Only a PUBLISHED sheet (`groupsArePublished`): a draft is the organizer's.
 */
export async function roundTeeSheet(eventId: string, stageId: string): Promise<TeeSheet | null> {
  const stage = await prisma.stage.findFirst({ where: { id: stageId, eventId }, select: { teeSheet: true, teeSheetPublished: true } });
  return stage && groupsArePublished(stage) ? parseTeeSheet(stage.teeSheet) : null;
}

/**
 * The OTHER rounds' published tee-sheet groups, in round order — read ONLY for
 * a tee TIME, never a grouping: the /play list borrows a time from a group
 * whose players are exactly a match's (`withBorrowedTeeTimes`). The keeper
 * never reads this.
 */
export async function otherRoundsTeeGroups(eventId: string, stageId: string): Promise<TeeSheetGroup[]> {
  const stages = await prisma.stage.findMany({
    where: { eventId, NOT: { id: stageId }, teeSheetPublished: true },
    orderBy: { position: "asc" },
    select: { teeSheet: true, teeSheetPublished: true },
  });
  return stages.filter(groupsArePublished).flatMap((s) => parseTeeSheet(s.teeSheet)?.groups ?? []);
}

/** Who walked off together, and this round's matches — what the group is read from. */
export async function keepingContextFor(eventId: string, stageId: string): Promise<{ ctx: KeepingContext; field: string[] }> {
  const [event, sheet, confirmed, matches] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { shape: true } }),
    roundTeeSheet(eventId, stageId),
    prisma.player.findMany({ where: { eventId, status: "confirmed" }, select: { id: true } }),
    prisma.match.findMany({
      where: { eventId, stageId },
      orderBy: [{ round: "asc" }, { id: "asc" }],
      select: { id: true, playerAId: true, playerBId: true, teamAId: true, teamBId: true, enteredById: true, attestedBy: true },
    }),
  ]);
  const field = confirmed.map((p) => p.id);
  // The round's OWN published sheet only (`roundTeeSheet`) — never another round's.
  const teeGroups = sheet ? publishedFoursomes(sheet, true, new Set(field)) : [];
  const sides = await Promise.all(matches.map((m) => matchSidesOf(m)));
  // Only a casual round makes its whole field one group when nothing was drawn
  // (`groupKeyFor`): groups come from the published draw.
  return { ctx: { teeGroups, matches: sides, casual: isMatch(event?.shape) }, field };
}

/**
 * A CLAIM THAT LOSES THE RACE IS RETRIED, NEVER THROWN (2026-11-05).
 *
 * Prisma's `upsert` on Postgres is a read, then an INSERT or an UPDATE — not
 * one statement. Two phones confirming the same group in the same instant both
 * read "nobody keeps it" and both INSERT; the unique key on (stageId, groupKey)
 * keeps ONE row, and the slower phone got a P2002 crash instead of "Ann is
 * keeping score for your group" (a round's database suite, run 42026558151).
 * Retried, the row exists, so the upsert takes its UPDATE branch and answers
 * with the winner — which is exactly the one-scorer rule. Anything else throws.
 */
async function claimRow<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await write();
    } catch (e) {
      const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
      if (code === "P2002" && attempt < 3) continue;
      throw e;
    }
  }
}

async function namesIn(eventId: string, ids: string[]): Promise<Map<string, string>> {
  const rows = await prisma.player.findMany({ where: { eventId, id: { in: ids } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function scoringOf(eventId: string, stageId: string) {
  const stage = await prisma.stage.findFirst({ where: { id: stageId, eventId }, select: { scoreKeeping: true, endCheck: true } });
  return stage ? roundScoring(stage) : null;
}

export type GateResult =
  | { applies: false }
  | { applies: true; ok: true; epoch: number; groupKey: string; actorId: string }
  /**
   * `keeperName` when the refusal is that the card is kept on another phone —
   * somebody else's, or this player's own on a phone that took it over — so
   * the screen can stop claiming progress and follow the group instead.
   */
  | { applies: true; ok: false; error: string; keeperName?: string };

/**
 * MAY THIS WRITE GO IN — asked before any player-side save on a round.
 *
 * `actorIds` are the Player rows the caller is (one for a round code; a
 * signed-in person may hold more than one). `targetIds` are the players the
 * write touches: the card's player, or everyone in the match. The write is
 * the GROUP's when they are in one group with the caller; the caller must
 * then be its scorer, holding the current epoch when they hold one.
 */
export async function keeperGate(input: {
  eventId: string;
  stageId: string;
  actorIds: readonly string[];
  targetIds: readonly string[];
  epoch: number | undefined;
}): Promise<GateResult> {
  const scoring = await scoringOf(input.eventId, input.stageId);
  if (!scoring || scoring.scoreKeeping !== "group") return { applies: false };

  const { ctx } = await keepingContextFor(input.eventId, input.stageId);
  const target = input.targetIds.find(Boolean);
  if (!target) return { applies: true, ok: false, error: NOT_YOUR_GROUP };
  const key = groupKeyFor(target, ctx);
  // No group (a tournament round before its draw is published): each player
  // keeps their own card, and the caller's own-card rule decides.
  if (key === null) return { applies: false };
  const actorId = input.actorIds.find((id) => groupKeyFor(id, ctx) === key);
  if (!actorId) return { applies: true, ok: false, error: NOT_YOUR_GROUP };

  // The claim: a row for this group, made by this phone if nobody keeps it yet.
  const keeper = await claimRow(() =>
    prisma.scoringKeeper.upsert({
      where: { stageId_groupKey: { stageId: input.stageId, groupKey: key } },
      create: { eventId: input.eventId, stageId: input.stageId, groupKey: key, playerId: actorId },
      update: {},
      select: { playerId: true, epoch: true, eventId: true },
    }),
  );
  // A row of another tournament under this round's id cannot exist (the
  // stage is this event's, checked above); asked anyway, as every write here.
  if (keeper.eventId !== input.eventId) return { applies: true, ok: false, error: NOT_YOUR_GROUP };
  const names = await namesIn(input.eventId, [keeper.playerId]);
  const decision = mayKeep({ actorId, keeper, epoch: input.epoch, nameOf: (id) => names.get(id) ?? "" });
  if (!decision.ok) return { applies: true, ok: false, error: decision.error, keeperName: names.get(keeper.playerId) ?? "" };
  return { applies: true, ok: true, epoch: decision.epoch, groupKey: key, actorId };
}

export type KeepResult =
  | { ok: true; epoch: number; keeperId: string; groupKey: string; members: string[] }
  | { ok: false; error: string; keeperId?: string; keeperName?: string };

/**
 * "I'LL KEEP SCORE" — claim the caller's group, or with `takeOver` take it
 * from whoever has it. A take-over moves the epoch on, so the phone that was
 * keeping it is refused from its next save; it is logged, by both names.
 */
export async function claimGroup(input: {
  eventId: string;
  stageId: string;
  actorId: string;
  actorName: string;
  takeOver: boolean;
}): Promise<KeepResult> {
  const scoring = await scoringOf(input.eventId, input.stageId);
  if (!scoring) return { ok: false, error: "Round not found." };
  if (scoring.scoreKeeping !== "group") {
    return { ok: false, error: "Each player keeps their own score on this round, so there's no group card to keep." };
  }
  const { ctx, field } = await keepingContextFor(input.eventId, input.stageId);
  if (!field.includes(input.actorId)) return { ok: false, error: NOT_YOUR_GROUP };
  const key = groupKeyFor(input.actorId, ctx);
  if (key === null) return { ok: false, error: NO_GROUPS_YET };
  const members = groupMembers(key, ctx, field);

  const where = { stageId_groupKey: { stageId: input.stageId, groupKey: key } };
  const create = { eventId: input.eventId, stageId: input.stageId, groupKey: key, playerId: input.actorId };
  // Read the holder first only to NAME them in the record and the refusal; the
  // write itself is one upsert, whatever was read.
  const before = await prisma.scoringKeeper.findFirst({
    where: { eventId: input.eventId, stageId: input.stageId, groupKey: key },
    select: { playerId: true },
  });
  if (!input.takeOver) {
    const row = await claimRow(() => prisma.scoringKeeper.upsert({ where, create, update: {}, select: { playerId: true, epoch: true } }));
    if (row.playerId !== input.actorId) {
      const names = await namesIn(input.eventId, [row.playerId]);
      const name = names.get(row.playerId) ?? "Someone else";
      return { ok: false, error: `${name} is keeping score for your group.`, keeperId: row.playerId, keeperName: name };
    }
    return { ok: true, epoch: row.epoch, keeperId: row.playerId, groupKey: key, members };
  }
  const row = await claimRow(() =>
    prisma.scoringKeeper.upsert({
      where,
      create,
      update: { playerId: input.actorId, epoch: { increment: 1 }, claimedAt: new Date() },
      select: { playerId: true, epoch: true },
    }),
  );
  if (before && before.playerId !== input.actorId) {
    const names = await namesIn(input.eventId, [before.playerId]);
    await logAudit(input.eventId, "keeper.takeover", `${input.actorName} took over keeping score from ${names.get(before.playerId) ?? "another player"}`, {
      actor: input.actorName,
    });
  }
  return { ok: true, epoch: row.epoch, keeperId: row.playerId, groupKey: key, members };
}

/** The scorer hands the card to somebody else in the group. Logged. */
export async function handOverKeeping(input: {
  eventId: string;
  stageId: string;
  fromId: string;
  fromName: string;
  toId: string;
}): Promise<KeepResult> {
  const scoring = await scoringOf(input.eventId, input.stageId);
  if (!scoring) return { ok: false, error: "Round not found." };
  if (scoring.scoreKeeping !== "group") {
    return { ok: false, error: "Each player keeps their own score on this round, so there's no group card to hand over." };
  }
  const { ctx, field } = await keepingContextFor(input.eventId, input.stageId);
  const key = groupKeyFor(input.fromId, ctx);
  if (key === null) return { ok: false, error: NO_GROUPS_YET };
  const members = groupMembers(key, ctx, field);
  if (input.toId === input.fromId || !members.includes(input.toId) || !field.includes(input.toId)) {
    return { ok: false, error: HAND_OVER_OUTSIDE };
  }
  // Conditional on the caller still holding it: a hand-over from a phone that
  // was taken over a minute ago moves nothing.
  const moved = await prisma.scoringKeeper.updateMany({
    where: { eventId: input.eventId, stageId: input.stageId, groupKey: key, playerId: input.fromId },
    data: { playerId: input.toId, epoch: { increment: 1 }, claimedAt: new Date() },
  });
  if (moved.count === 0) return { ok: false, error: HAND_OVER_NOT_YOURS };
  const row = await prisma.scoringKeeper.findFirstOrThrow({
    where: { eventId: input.eventId, stageId: input.stageId, groupKey: key },
    select: { playerId: true, epoch: true },
  });
  const names = await namesIn(input.eventId, [input.toId]);
  await logAudit(input.eventId, "keeper.handover", `${input.fromName} handed the card to ${names.get(input.toId) ?? "another player"}`, {
    actor: input.fromName,
  });
  return { ok: true, epoch: row.epoch, keeperId: row.playerId, groupKey: key, members };
}

/**
 * Who keeps this player's group on this round, for a screen to say so. Null on
 * a round kept "each", and on a round with no groups yet (a tournament round
 * before its draw is published) — where each player keeps their own card.
 */
export async function keeperFor(
  eventId: string,
  stageId: string,
  playerId: string,
): Promise<{ groupKey: string; members: string[]; keeper: { playerId: string; name: string; epoch: number } | null } | null> {
  const scoring = await scoringOf(eventId, stageId);
  if (!scoring || scoring.scoreKeeping !== "group") return null;
  const { ctx, field } = await keepingContextFor(eventId, stageId);
  const key = groupKeyFor(playerId, ctx);
  if (key === null) return null;
  const row = await prisma.scoringKeeper.findFirst({
    where: { eventId, stageId, groupKey: key },
    select: { playerId: true, epoch: true },
  });
  const names = row ? await namesIn(eventId, [row.playerId]) : new Map<string, string>();
  return {
    groupKey: key,
    members: groupMembers(key, ctx, field),
    keeper: row ? { playerId: row.playerId, name: names.get(row.playerId) ?? "", epoch: row.epoch } : null,
  };
}

/**
 * What a group is CALLED on the screen that says who keeps it: the published
 * tee sheet's own name for it ("Group 3"), else "your match" or "your group".
 * The same sheet `keepingContextFor` reads the group from, so the name and the
 * people cannot come from two different sheets.
 */
export async function groupTitleFor(eventId: string, stageId: string, groupKey: string): Promise<string> {
  if (groupKey.startsWith("match:")) return "Your match";
  if (!groupKey.startsWith("tee:")) return "Your group";
  const members = new Set(groupKey.slice(4).split(",").filter(Boolean));
  const groups = (await roundTeeSheet(eventId, stageId))?.groups ?? [];
  // The sheet's group holding exactly these people, once withdrawn names are
  // left out — the narrowing `publishedFoursomes` makes.
  const named = groups.find((g) => {
    const here = g.playerIds.filter((id) => members.has(id));
    return here.length === members.size && here.length > 0;
  });
  return named?.name?.trim() || "Your group";
}

/** How many DIFFERENT players have entered a score on this round — for refusing a late switch to one scorer. */
export async function playersWhoEntered(eventId: string, stageId: string): Promise<number> {
  const [matches, cards] = await Promise.all([
    prisma.match.findMany({ where: { eventId, stageId, NOT: { enteredById: "" } }, select: { enteredById: true } }),
    // Stroke cards record no author column; the cards' own players are who
    // entered them on a round kept "each" (a player keeps only their own, or a
    // partner's under the marker system — counted by card, which can only
    // over-count, the safe direction for a refusal).
    prisma.scorecard.findMany({ where: { eventId, stageId, NOT: { strokes: { in: ["", "[]"] } } }, select: { playerId: true } }),
  ]);
  const who = new Set<string>([...matches.map((m) => m.enteredById), ...cards.map((c) => c.playerId)]);
  return who.size;
}
