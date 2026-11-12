import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { indexLabel } from "../domain/handicap-label";
import type { TeeSheet } from "../domain/tee-sheet";
import type { ReplaceCandidate, ReplaceWorld } from "../domain/tee-sheet-replace";
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
  const [confirmed, field, cut, sides] = await Promise.all([
    prisma.player.findMany({
      where: { eventId, status: "confirmed" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, handicap: true, handicapType: true, handicapSource: true, groupId: true },
    }),
    sheetFieldFor(eventId, stageId),
    strokeCutField(eventId, stageId),
    inSides ? sidesOfStage(eventId, stageId) : Promise.resolve([] as RoundSide[]),
  ]);
  const sideOf: Record<string, string> = {};
  for (const t of sides) for (const m of t.members) sideOf[m.playerId] = t.name;
  const flights: Record<string, string> = {};
  for (const p of confirmed) flights[p.id] = p.groupId ?? "";
  return {
    world: {
      sheet,
      field: [...field.ids],
      out: field.weekRows.filter((r) => r.explicit && r.status === "out").map((r) => r.playerId),
      sides: sideOf,
      cut: cut ? [...cut] : null,
      flights,
      sameFlight: sides.some((t) => !!t.clubGroupId),
    },
    candidates: confirmed.map((p) => ({ id: p.id, name: p.name, index: indexLabel(p) })),
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
export async function sidesHavePlay(eventId: string, stageId: string, teamIds: string[]): Promise<boolean> {
  if (teamIds.length === 0) return false;
  const [cards, matches] = await Promise.all([
    prisma.teamScorecard.findMany({ where: { eventId, stageId, teamId: { in: teamIds } }, select: { strokes: true } }),
    prisma.match.findMany({
      where: { eventId, stageId, OR: [{ teamAId: { in: teamIds } }, { teamBId: { in: teamIds } }] },
      select: { id: true, holes: true, forfeitedBy: true },
    }),
  ]);
  if (cards.some((c) => hasStroke(c.strokes))) return true;
  if (matches.some((m) => hasResult(m.holes) || m.forfeitedBy)) return true;
  if (matches.length === 0) return false;
  const cardsOfMatches = await prisma.matchScorecard.findMany({ where: { eventId, matchId: { in: matches.map((m) => m.id) } }, select: { strokes: true } });
  return cardsOfMatches.some((c) => hasStroke(c.strokes));
}

/**
 * THE ABSENTEE'S SIDE-GAME ENTRIES FOR THIS ROUND, VOIDED (never the money's record of who paid):
 *  - a contest or a side game: the entry is marked out (`excluded`, not owing, not a winner) — and in an
 *    opt-out one, where silence is "in and paid", an out row is written so they are not counted;
 *  - a skins pot, which has no out flag: the entry is removed, the way the app takes anybody out of one.
 * The substitute is not entered in anything: they enter fresh, so nobody inherits a stake.
 * Counts what was voided and how many of those stakes were already paid, for the audit line.
 */
export async function voidSideEntries(
  tx: Prisma.TransactionClient,
  eventId: string,
  stageId: string,
  playerId: string,
): Promise<{ contests: number; sideGames: number; skins: number; paid: number }> {
  let paid = 0;
  let contests = 0;
  let sideGames = 0;
  let skins = 0;

  for (const c of await tx.contest.findMany({ where: { eventId, stageId }, select: { id: true, entryMode: true, entrants: { where: { playerId }, select: { id: true, confirmed: true, excluded: true } } } })) {
    const row = c.entrants[0];
    if (row?.excluded) continue;
    if (!row && c.entryMode !== "opt-out") continue;
    await tx.contestEntry.upsert({
      where: { contestId_playerId: { contestId: c.id, playerId } },
      update: { excluded: true, confirmed: false, won: false },
      create: { contestId: c.id, playerId, excluded: true, confirmed: false },
    });
    contests++;
    if (row?.confirmed) paid++;
  }
  for (const g of await tx.sideGame.findMany({ where: { eventId, stageId }, select: { id: true, entryMode: true, entrants: { where: { playerId }, select: { id: true, confirmed: true, excluded: true } } } })) {
    const row = g.entrants[0];
    if (row?.excluded) continue;
    if (!row && g.entryMode !== "opt-out") continue;
    await tx.sideGameEntry.upsert({
      where: { sideGameId_playerId: { sideGameId: g.id, playerId } },
      update: { excluded: true, confirmed: false },
      create: { sideGameId: g.id, playerId, excluded: true, confirmed: false },
    });
    sideGames++;
    if (row?.confirmed) paid++;
  }
  for (const pot of await tx.skinsPot.findMany({ where: { eventId, stageId }, select: { id: true, entrants: { where: { playerId }, select: { id: true, confirmed: true } } } })) {
    const row = pot.entrants[0];
    if (!row) continue;
    await tx.skinsEntry.delete({ where: { id: row.id } });
    skins++;
    if (row.confirmed) paid++;
  }
  return { contests, sideGames, skins, paid };
}
