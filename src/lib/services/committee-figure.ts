import "server-only";
import { prisma } from "../db";
import { SINK_LIVE, needsCommitteeFigure, needsFigureSaid, needsStrokesFact } from "../domain/committee-figure";
import { roundLabel } from "../domain/round-label";
import { isPlayingRound } from "../stage-types";

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

export interface NeedsStrokesRound {
  stageId: string;
  /** "Round 1" — `roundLabel`, as every screen numbers it. */
  label: string;
  /** The round's day, `yyyy-mm-dd`, or "" when it has none yet. */
  day: string;
  /** In roster order (`seed`), as the round's own handicap list. */
  players: { id: string; name: string }[];
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
  const maybe = field.filter((p) => open.some((s) => s.eventId === p.eventId && needsCommitteeFigure(s, p, null)));
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
      const need = maybe.filter((p) => p.eventId === id && needsCommitteeFigure(s, p, rowOf.get(`${s.id}:${p.id}`) ?? null));
      if (need.length === 0) continue;
      rounds.push({
        stageId: s.id,
        label: roundLabel(all, s.id) || "A round",
        day: s.playedOn,
        players: need.map((p) => ({ id: p.id, name: p.name })),
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
  return needsFigureSaid({ count: fact.players, rounds: fact.rounds, canGive, sinkLive: SINK_LIVE });
}
