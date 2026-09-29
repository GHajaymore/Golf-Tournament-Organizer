import { prisma } from "@/lib/db";
import { loadEventState, parseMatchTiebreakers } from "@/lib/services/tournament";
import { resolveCourse } from "@/lib/courses";
import { decidedOutcome } from "@/lib/domain/standings";
import { resolveMatch } from "@/lib/domain/match";
import type { HoleResult } from "@/lib/domain/types";
import { bracketDraws } from "@/lib/domain/my-tie";
import { roundLabel } from "@/lib/domain/round-label";
import { isKnockoutRound, roundIsStroke } from "@/lib/stage-types";
import { recordAgainst, type Meeting, type OpponentRecord } from "@/lib/domain/head-to-head";

/**
 * The record between the two players in a tie, from THIS player's side — for
 * "you've met before" on a player's own card. Both must be club members; a
 * guest has no history to show. Null when they have never met in a match.
 */
export async function recordBetween(
  organizationId: string,
  myPlayerId: string,
  theirPlayerId: string,
): Promise<OpponentRecord | null> {
  const rows = await prisma.player.findMany({
    where: { id: { in: [myPlayerId, theirPlayerId] }, event: { organizationId } },
    select: { id: true, memberId: true },
  });
  const me = rows.find((r) => r.id === myPlayerId)?.memberId;
  const them = rows.find((r) => r.id === theirPlayerId)?.memberId;
  if (!me || !them || me === them) return null;
  return recordAgainst(me, await meetingsFor(organizationId, me)).find((r) => r.opponentId === them) ?? null;
}

/**
 * Every decided INDIVIDUAL meeting a member has played in this organization's
 * tournaments, with both players as MEMBER ids.
 *
 * Only tournaments that can hold one are loaded: the member's own entries in
 * events that have an individual match row naming them, or any knockout
 * result. Each is then read through its own `EventState` — the forfeit, the
 * all-square countback configured for THAT tournament, and the knockout's
 * seats — so a meeting counts here exactly as it counted on that table.
 *
 * Casual quick matches (`shape: "match"`) are left out, as every other
 * cross-event reader leaves them out: a knock-about is not a club result.
 */
export async function meetingsFor(organizationId: string, memberId: string): Promise<Meeting[]> {
  const mine = await prisma.player.findMany({
    where: { memberId, event: { organizationId, shape: { not: "match" } } },
    select: { id: true, eventId: true },
  });
  if (mine.length === 0) return [];
  const myIds = mine.map((p) => p.id);
  const myEvents = [...new Set(mine.map((p) => p.eventId))];

  const [withMatch, withBracket] = await Promise.all([
    prisma.match.findMany({
      where: { eventId: { in: myEvents }, teamAId: "", OR: [{ playerAId: { in: myIds } }, { playerBId: { in: myIds } }] },
      select: { eventId: true },
      distinct: ["eventId"],
    }),
    prisma.bracketWinner.findMany({
      where: { eventId: { in: myEvents } },
      select: { eventId: true },
      distinct: ["eventId"],
    }),
  ]);
  const candidates = [...new Set([...withMatch, ...withBracket].map((r) => r.eventId))];

  const out: Meeting[] = [];
  for (const eventId of candidates) {
    const state = await loadEventState(eventId);
    if (!state) continue;
    const memberOf = new Map(state.players.map((p) => [p.id, p.memberId ?? ""]));
    const stageById = new Map(state.stages.map((s) => [s.id, s]));
    const tiebreak = {
      sequence: parseMatchTiebreakers(state.event.matchTiebreakers),
      strokeIndex: resolveCourse(state.event).strokeIndex,
    };
    const eventDate = (s?: { playedOn: string }) => s?.playedOn || "";

    for (const m of state.matches) {
      if (!m.playerAId || !m.playerBId || m.teamAId) continue;
      const stage = stageById.get(m.stageId);
      if (!stage || roundIsStroke(stage.type, stage.format)) continue;
      const a = memberOf.get(m.playerAId) ?? "";
      const b = memberOf.get(m.playerBId) ?? "";
      if (!a || !b || (a !== memberId && b !== memberId)) continue;
      let holes: HoleResult[] = [];
      try {
        holes = JSON.parse(m.holes) as HoleResult[];
      } catch {
        continue;
      }
      const outcome = decidedOutcome(
        { id: m.id, stageId: m.stageId, groupId: m.groupId, round: m.round, playerAId: m.playerAId, playerBId: m.playerBId, holes, forfeitedBy: m.forfeitedBy ?? "" },
        tiebreak,
      );
      if (outcome === null) continue;
      out.push({
        eventId,
        eventName: state.event.name,
        where: roundLabel(state.stages, m.stageId),
        date: eventDate(stage),
        a,
        b,
        winner: outcome === "H" ? null : outcome === "A" ? a : b,
        margin: m.forfeitedBy ? "conceded" : resolveMatch(holes).resultText,
      });
    }

    const margins = new Map(
      (await prisma.bracketWinner.findMany({ where: { eventId }, select: { key: true, result: true } })).map((w) => [w.key, w.result]),
    );
    const bracketStage = state.stages.find((s) => isKnockoutRound(s.type));
    for (const draw of bracketDraws(state.brackets)) {
      for (const round of draw.view.rounds) {
        for (const t of round.matches) {
          // A bye is not a meeting: both seats must have been filled.
          if (!t.a.playerId || !t.b.playerId || !t.winnerId) continue;
          const a = memberOf.get(t.a.playerId) ?? "";
          const b = memberOf.get(t.b.playerId) ?? "";
          if (!a || !b || (a !== memberId && b !== memberId)) continue;
          // A knockout tie is never halved: a winner in neither seat is a
          // result this cannot read, and is dropped rather than called a halve.
          if (t.winnerId !== t.a.playerId && t.winnerId !== t.b.playerId) continue;
          out.push({
            eventId,
            eventName: state.event.name,
            where: [draw.label, round.label].filter(Boolean).join(" · "),
            date: eventDate(bracketStage),
            a,
            b,
            winner: t.winnerId === t.a.playerId ? a : b,
            margin: margins.get(t.key) ?? "",
          });
        }
      }
    }
  }
  return out;
}
