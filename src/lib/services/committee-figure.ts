import "server-only";
import { prisma } from "../db";
import { SINK_LIVE, needsCommitteeFigure, needsFigureSaid, needsStrokesFact, netSideGamePlayers, scoredAsScratch } from "../domain/committee-figure";
import { isPotEntryMode } from "../domain/pot-entry";
import { potAudience } from "../domain/pot-audience";
import { isNetBasis } from "../domain/match-entry";
import { roundLabel } from "../domain/round-label";
import { isPlayingRound } from "../stage-types";
import { roundHasReturnedCard } from "./round-handicap";

/**
 * WHO NEEDS STROKES FROM THE COMMITTEE, round by round — the one list every screen reads (the band on
 * Rounds & formats, the launch warning, What's next, the setup rail, the doors' notes). The rule is
 * `needsCommitteeFigure`; this only loads what it is asked of, so no screen works the list out again.
 *
 * Which rounds: the rounds the field plays (`isPlayingRound`) that are not closed. A closed round's
 * strokes are history; the rule never re-scores it.
 *
 * Who: the CONFIRMED field, which is who a round is priced for (`freezeRoundHandicaps`, the board).
 *
 * GROUPED, as `tournament-facts.ts` is: the secretary's home asks it for every running tournament of the
 * club at once, so every query is `eventId: { in: [...] }` and `playersNeedingFigure` is that list of
 * one.
 */

/**
 * WHO IS IN A NET SIDE GAME, round by round (review of #1144, C2) — what fills the rule's `netGame`. The
 * net games a round can hold are a net skins pot (`SkinsPot.net`, true by default) and low net (a
 * `SideGame` of kind "low-net"); both price through the board's chain. Membership is the one rule
 * (`netSideGamePlayers` → `potMembership`): a skins pot's rows (it is opt-in), a low-net game's mode and
 * audience (`potAudience`: the field, or one fourball). Only the confirmed field is offered a game.
 * Grouped, like `needsStrokesFor`: one query per table for every tournament asked.
 */
export async function netSideGamesFor(eventIds: readonly string[], stageIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const ids = [...new Set(eventIds)];
  const rounds = [...new Set(stageIds)];
  if (ids.length === 0 || rounds.length === 0) return out;
  const where = { eventId: { in: ids }, stageId: { in: rounds } };
  const [pots, games] = await Promise.all([
    prisma.skinsPot.findMany({ where: { ...where, net: true }, select: { stageId: true, eventId: true, entrants: { select: { playerId: true, confirmed: true } } } }),
    prisma.sideGame.findMany({
      where: { ...where, kind: "low-net" },
      select: { stageId: true, eventId: true, entryMode: true, groupKey: true, entrants: { select: { playerId: true, confirmed: true, excluded: true } } },
    }),
  ]);
  if (pots.length === 0 && games.length === 0) return out;
  const asked = [...new Set([...pots, ...games].map((g) => g.eventId))];
  const [field, sheets] = await Promise.all([
    prisma.player.findMany({ where: { eventId: { in: asked }, status: "confirmed" }, select: { id: true, eventId: true } }),
    prisma.stage.findMany({ where: { id: { in: [...new Set(games.map((g) => g.stageId))] } }, select: { id: true, teeSheet: true } }),
  ]);
  const fieldOf = (eventId: string) => field.filter((p) => p.eventId === eventId).map((p) => p.id);
  const sheetOf = new Map(sheets.map((s) => [s.id, s.teeSheet ?? ""]));
  for (const stageId of rounds) {
    const here = [
      ...pots
        .filter((p) => p.stageId === stageId)
        .map((p) => ({ net: true, mode: "opt-in" as const, audience: fieldOf(p.eventId), decisions: p.entrants.map((e) => ({ ...e, excluded: false })) })),
      ...games
        .filter((g) => g.stageId === stageId)
        .map((g) => ({
          net: true,
          mode: isPotEntryMode(g.entryMode) ? g.entryMode : ("opt-in" as const),
          audience: potAudience(g.groupKey, sheetOf.get(stageId) ?? "", fieldOf(g.eventId)),
          decisions: g.entrants,
        })),
    ];
    if (here.length === 0) continue;
    const inGame = netSideGamePlayers(here);
    if (inGame.size > 0) out.set(stageId, inGame);
  }
  return out;
}

export interface NeedsStrokesRound {
  stageId: string;
  /** "Round 1" — `roundLabel`, as every screen numbers it. */
  label: string;
  /**
   * The round is scored gross: everybody on it is asked because they play a net side game in it (C2), so
   * no screen may say "scored net" of it.
   */
  sideGame: boolean;
  /** The round's day, `yyyy-mm-dd`, or "" when it has none yet. */
  day: string;
  /** Who needs strokes (`needsCommitteeFigure`), in roster order (`seed`), as the round's own handicap list. */
  players: { id: string; name: string }[];
  /**
   * Who is scored as a scratch golfer in a round that has a card in — frozen there with nothing given
   * (`scoredAsScratch`), or a late entrant the next card will freeze: a correction, not a Give.
   */
  scratch: { id: string; name: string }[];
}

export async function needsStrokesFor(eventIds: readonly string[]): Promise<Map<string, NeedsStrokesRound[]>> {
  const ids = [...new Set(eventIds)];
  const out = new Map<string, NeedsStrokesRound[]>();
  if (ids.length === 0) return out;
  const inEvents = { eventId: { in: ids } };

  const [stages, field] = await Promise.all([
    prisma.stage.findMany({
      where: inEvents,
      orderBy: { position: "asc" },
      select: { id: true, eventId: true, type: true, position: true, scoringBasis: true, playedOn: true, closedAt: true },
    }),
    prisma.player.findMany({
      where: { ...inEvents, status: "confirmed" },
      orderBy: { seed: "asc" },
      select: { id: true, eventId: true, name: true, handicapSource: true },
    }),
  ]);

  // The rounds that can still ask, and — asked of the rule itself with no row yet — the players who
  // could need a figure in one of them. Only their rows are read: a frozen field is every player.
  const open = stages.filter((s) => isPlayingRound(s.type) && s.closedAt == null);
  // Who plays a net side game in each open round (C2): a gross round with a net pot counts their strokes.
  const netGames = await netSideGamesFor(ids, open.map((s) => s.id));
  const asked = (s: (typeof open)[number], p: { id: string }) => ({ scoringBasis: s.scoringBasis, netGame: netGames.get(s.id)?.has(p.id) ?? false });
  const maybe = field.filter((p) => open.some((s) => s.eventId === p.eventId && needsCommitteeFigure(asked(s, p), p, null)));
  if (maybe.length === 0) return out;

  const rows = await prisma.roundHandicap.findMany({
    where: { ...inEvents, playerId: { in: maybe.map((p) => p.id) }, stageId: { in: open.map((s) => s.id) } },
    select: { stageId: true, playerId: true, override: true, frozen: true },
  });
  const rowOf = new Map(rows.map((r) => [`${r.stageId}:${r.playerId}`, r]));

  for (const id of ids) {
    const all = stages.filter((s) => s.eventId === id);
    const rounds: NeedsStrokesRound[] = [];
    for (const s of open.filter((r) => r.eventId === id)) {
      const mine = maybe.filter((p) => p.eventId === id);
      const askedHere = mine.filter((p) => needsCommitteeFigure(asked(s, p), p, rowOf.get(`${s.id}:${p.id}`) ?? null));
      // A round with a card in is past Give (`setRoundHandicapOverride` refuses): a late entrant there is
      // a correction, as a player the first card froze is. Asked only of a round with somebody to name.
      const cardsIn = askedHere.length > 0 && (await roundHasReturnedCard(id, s.id));
      const need = cardsIn ? [] : askedHere;
      // Frozen at the scratch figure by the round's first card with nothing given: still named (review of
      // #1144), with the staff correction as the way on, so no list goes quiet over them.
      const scratch = [...(cardsIn ? askedHere : []), ...mine.filter((p) => scoredAsScratch(asked(s, p), p, rowOf.get(`${s.id}:${p.id}`) ?? null))];
      if (need.length === 0 && scratch.length === 0) continue;
      rounds.push({
        stageId: s.id,
        label: roundLabel(all, s.id) || "A round",
        sideGame: !isNetBasis(s.scoringBasis),
        day: s.playedOn,
        players: need.map((p) => ({ id: p.id, name: p.name })),
        scratch: scratch.map((p) => ({ id: p.id, name: p.name })),
      });
    }
    if (rounds.length > 0) out.set(id, rounds);
  }
  return out;
}

/** One tournament's list: every open net round in which somebody needs strokes, in play order. */
export async function playersNeedingFigure(eventId: string): Promise<NeedsStrokesRound[]> {
  return (await needsStrokesFor([eventId])).get(eventId) ?? [];
}

/**
 * THE NOTE A DOOR SHOWS (Entries — the roster pick, a late entry, a CSV import, an approval — and the
 * sides): the state, never a refusal. Null when nobody needs strokes. `canGive` is whether this viewer may
 * give them (organizer or assistant organizer, what `setRoundHandicapOverride` asks): with it the note
 * talks to "you" and links to the band; without it, it names the organizer and carries no link.
 */
export async function needsStrokesNoteFor(eventId: string, canGive: boolean): Promise<{ text: string; link: boolean } | null> {
  const fact = needsStrokesFact(await playersNeedingFigure(eventId));
  if (!fact) return null;
  return needsFigureSaid({ count: fact.players, rounds: fact.rounds, sideGameRounds: fact.sideGameRounds, canGive, sinkLive: SINK_LIVE });
}
