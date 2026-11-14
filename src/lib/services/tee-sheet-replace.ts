import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { indexLabel } from "../domain/handicap-label";
import { acceptsHandicapChange } from "../domain/round-handicap";
import type { TeeSheet } from "../domain/tee-sheet";
import type { ReplaceCandidate, ReplaceWorld } from "../domain/tee-sheet-replace";
import { roundHasReturnedCard } from "./round-handicap";
import { sheetFieldFor } from "./sheet-field";
import { strokeCutField } from "./stroke-cut";

/**
 * THE FACTS A REPLACEMENT IS CHOSEN AND REFUSED ON, read once for the screen
 * (which draws the choices) and for `replaceInTeeSheet` (which refuses), so the
 * two cannot read the round differently. The rules are `domain/tee-sheet-replace.ts`.
 */

export interface RoundSide {
  id: string;
  name: string;
  /** Null: the side plays EVERY round of the tournament, so it is not this week's to change. */
  stageId: string | null;
  /** Set in an interclub league: the club this pair plays for. */
  clubGroupId: string | null;
  members: Array<{ playerId: string; position: number }>;
}

/**
 * The sides of ONE round, as `teamsForStage` reads them: the round's own, and only where it has none
 * the tournament-wide ones. Empty for a round with no sides.
 */
export async function sidesOfStage(eventId: string, stageId: string): Promise<RoundSide[]> {
  const teams = await prisma.team.findMany({
    where: { eventId, OR: [{ stageId }, { stageId: null }] },
    orderBy: [{ seed: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, stageId: true, clubGroupId: true, members: { orderBy: { position: "asc" }, select: { playerId: true, position: true } } },
  });
  const scoped = teams.filter((t) => t.stageId === stageId);
  return scoped.length > 0 ? scoped : teams.filter((t) => t.stageId === null);
}

export async function replaceWorldFor(
  eventId: string,
  stageId: string,
  sheet: TeeSheet,
  inSides: boolean,
): Promise<{ world: ReplaceWorld; candidates: ReplaceCandidate[]; sides: RoundSide[] }> {
  const [confirmed, field, cut, sides, stage, overrides, returned] = await Promise.all([
    prisma.player.findMany({
      where: { eventId, status: "confirmed" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, handicap: true, handicapType: true, handicapSource: true, groupId: true },
    }),
    sheetFieldFor(eventId, stageId),
    strokeCutField(eventId, stageId),
    inSides ? sidesOfStage(eventId, stageId) : Promise.resolve([] as RoundSide[]),
    prisma.stage.findFirst({ where: { id: stageId, eventId }, select: { scoringBasis: true } }),
    // THE COMMITTEE'S STROKES FOR THIS ROUND — what `resolveRoundHandicap` takes before the roster — so a member
    // with no index who has been given some may step into a round scored net, and the record says the figure.
    prisma.roundHandicap.findMany({ where: { eventId, stageId, override: { not: null } }, select: { playerId: true, override: true } }),
    roundHasReturnedCard(eventId, stageId),
  ]);
  const sideOf: Record<string, string> = {};
  for (const t of sides) for (const m of t.members) sideOf[m.playerId] = t.name;
  const flights: Record<string, string> = {};
  for (const p of confirmed) flights[p.id] = p.groupId ?? "";
  const figures: Record<string, number> = {};
  for (const r of overrides) if (r.override !== null) figures[r.playerId] = r.override;
  return {
    world: {
      sheet,
      field: [...field.ids],
      out: field.weekRows.filter((r) => r.explicit && r.status === "out").map((r) => r.playerId),
      sides: sideOf,
      cut: cut ? [...cut] : null,
      flights,
      sameFlight: sides.some((t) => !!t.clubGroupId),
      // No round read means nothing to price, which the rule reads as gross.
      scoringBasis: stage?.scoringBasis ?? "gross",
      figures,
      handicapsFixed: !acceptsHandicapChange(returned),
    },
    candidates: confirmed.map((p) => ({ id: p.id, name: p.name, index: indexLabel(p), handicapSource: p.handicapSource ?? null })),
    sides,
  };
}

/** Whether a stored strokes blob holds a score. */
function hasStroke(json: string): boolean {
  try {
    const a = JSON.parse(json) as unknown;
    return Array.isArray(a) && a.some((v) => typeof v === "number" && v > 0);
  } catch {
    return false;
  }
}

/** Whether a match's holes hold a result ("A" | "B" | "H"). */
function hasResult(json: string): boolean {
  try {
    const a = JSON.parse(json) as unknown;
    return Array.isArray(a) && a.some((v) => typeof v === "string" && v.trim() !== "");
  } catch {
    return false;
  }
}

/**
 * HAS ANY OF THESE SIDES PLAYED A STROKE? A side's card is not a player's `Scorecard`, so the slot lock
 * (which reads those) cannot see a one-ball side's score or a match's holes; this reads those places.
 */
export async function sidesHavePlay(eventId: string, stageId: string, teamIds: string[], db: Prisma.TransactionClient = prisma): Promise<boolean> {
  if (teamIds.length === 0) return false;
  const [cards, matches] = await Promise.all([
    db.teamScorecard.findMany({ where: { eventId, stageId, teamId: { in: teamIds } }, select: { strokes: true } }),
    db.match.findMany({
      where: { eventId, stageId, OR: [{ teamAId: { in: teamIds } }, { teamBId: { in: teamIds } }] },
      select: { id: true, holes: true, forfeitedBy: true },
    }),
  ]);
  if (cards.some((c) => hasStroke(c.strokes))) return true;
  if (matches.some((m) => hasResult(m.holes) || m.forfeitedBy)) return true;
  if (matches.length === 0) return false;
  const cardsOfMatches = await db.matchScorecard.findMany({ where: { eventId, matchId: { in: matches.map((m) => m.id) } }, select: { strokes: true } });
  return cardsOfMatches.some((c) => hasStroke(c.strokes));
}

/**
 * THE ABSENTEE'S SIDE-GAME ENTRIES FOR THIS ROUND, MARKED OUT — and never the record of who PAID
 * (Hard rule 7: the app records money, it never loses the record of it):
 * A REPLACED PLAYER IS TREATED EXACTLY AS A WITHDRAWAL IS (Finance Director, 11 Nov): a stake that was
 * PAID stays in its pot as paid-but-gone (`potMembership`), so the pot total does not shrink and the record
 * of who paid is never lost (Hard rule 7). Nothing is written for it, as `withdrawEntry` writes nothing for
 * it (and where the absentee had played a card, `keepDefaultStakes` has already written their default stake
 * down as taken). The only thing written here is for a stake NOT paid, which is voided so nobody is chased
 * for money for a round they are not playing:
 *  - a contest or a side game: an entry with `confirmed: false` is marked `excluded`; a paid one is LEFT
 *    (`kept` counts them for the audit line); no row at all writes nothing (opt-in: not in; opt-out: out of
 *    the round's field, as a withdrawn player is);
 *  - a skins pot has no out flag, so its entry is LEFT as it is; the amount and whether it was paid are
 *    returned for the audit line, for the committee to settle by hand.
 * The substitute is not entered in anything: they enter fresh, so nobody inherits a stake.
 */
export interface VoidedEntries {
  /** Contests the absentee had asked into but NOT paid, marked out. */
  contests: number;
  /** Side games the absentee had asked into but NOT paid, marked out. */
  sideGames: number;
  /** Paid contest and side-game stakes left in their pots as paid-but-gone. */
  kept: number;
  /** Skins pots the absentee holds a stake in, left on the record: the stake in cents and whether it was paid. */
  skins: Array<{ cents: number; paid: boolean }>;
}

export async function voidSideEntries(
  tx: Prisma.TransactionClient,
  eventId: string,
  stageId: string,
  playerId: string,
): Promise<VoidedEntries> {
  let contests = 0;
  let sideGames = 0;
  let kept = 0;
  const skins: VoidedEntries["skins"] = [];

  for (const c of await tx.contest.findMany({ where: { eventId, stageId }, select: { id: true, entrants: { where: { playerId }, select: { confirmed: true, excluded: true } } } })) {
    const row = c.entrants[0];
    if (!row || row.excluded) continue;
    if (row.confirmed) {
      kept++;
      continue;
    }
    await tx.contestEntry.update({ where: { contestId_playerId: { contestId: c.id, playerId } }, data: { excluded: true } });
    contests++;
  }
  for (const g of await tx.sideGame.findMany({ where: { eventId, stageId }, select: { id: true, entrants: { where: { playerId }, select: { confirmed: true, excluded: true } } } })) {
    const row = g.entrants[0];
    if (!row || row.excluded) continue;
    if (row.confirmed) {
      kept++;
      continue;
    }
    await tx.sideGameEntry.update({ where: { sideGameId_playerId: { sideGameId: g.id, playerId } }, data: { excluded: true } });
    sideGames++;
  }
  for (const pot of await tx.skinsPot.findMany({ where: { eventId, stageId }, select: { buyInCents: true, entrants: { where: { playerId }, select: { confirmed: true } } } })) {
    const row = pot.entrants[0];
    if (row) skins.push({ cents: pot.buyInCents, paid: row.confirmed });
  }
  return { contests, sideGames, kept, skins };
}
