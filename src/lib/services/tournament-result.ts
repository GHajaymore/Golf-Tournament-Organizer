import "server-only";
import { prisma } from "../db";
import type { EventState } from "./tournament";
import { parseStrokeCards, playingStages } from "./tournament";
import { tournamentResult, type OutingLine, type RoundOutcome } from "../domain/tournament-result";
import { roundLabel } from "../domain/round-label";
import { isManualFormat, needsTeams } from "../formats";
import { roundUnit } from "../domain/round-unit";
import { isHeadToHead } from "../stage-types";
import { resolveMatch } from "../domain/match";
import { aggregateStroke } from "../domain/stroke-agg";
import { holeStrokesReceived, stablefordPointsForHole, allocationHoles } from "../domain";
import { holesPlayed } from "../domain/handicap";
import { cardForStage, courseForRound } from "./course-resolution";
import { teamStandings } from "./teams";
import { resolveCourse } from "../courses";

/**
 * WHAT HAPPENED, ROUND BY ROUND — the day's result for any kind of play.
 *
 * The domain half (`domain/tournament-result.ts`) knows how to word a result;
 * this is the half that finds one. Every round is asked in ITS OWN terms: a
 * medal by its cards, a match by its holes, a round scored by hand by what the
 * committee posted. Nothing here adds them together — see the note on
 * `tournamentResult` for why a combined ranking would be an invented result.
 *
 * ROUND BY ROUND RATHER THAN EVENT-WIDE, which is the whole difficulty. The
 * event's `strokeStandings` sums every stroke round together, so on a day with
 * two of them it cannot say who won either. This aggregates each round's own
 * cards against that round's own course card and hole count.
 */

export async function resultLinesFor(state: EventState): Promise<OutingLine[]> {
  const stages = playingStages(state.stages);
  if (stages.length === 0) return [];

  const [cardRows, courses] = await Promise.all([
    prisma.scorecard.findMany({
      where: { eventId: state.event.id },
      select: { playerId: true, stageId: true, strokes: true, status: true },
    }),
    prisma.course.findMany({
      where: { events: { some: { eventId: state.event.id } } },
      select: { id: true, name: true, city: true, pars: true, yards: true, strokeIndex: true },
    }),
  ]);

  const nameOf = new Map(state.players.map((p) => [p.id, p.name]));

  /**
   * EACH ROUND'S OWN CARD, KEYED BY ROUND — and read by round id below rather
   * than closed over, which `audit-guards` insists on for every scoring path.
   * The guard is right about the shape even where the call is per stage: a
   * `courseFor` that ignores its argument is the exact form of the bug that
   * scored a two-course tournament's second round against the first round's
   * par and stroke index.
   */
  const cardByStage = new Map(
    stages.map((stage) => {
      const venue =
        courseForRound(courses.find((c) => c.id === (stage.courseId ?? "")) ?? null, state.event) ??
        resolveCourse(state.event);
      const card = cardForStage(venue, stage);
      return [stage.id, { pars: card.pars, holeDifficulty: card.strokeIndex }] as const;
    }),
  );
  const courseFor = (stageId: string) =>
    cardByStage.get(stageId) ?? { pars: [], holeDifficulty: [] };
  /**
   * A TEAM ROUND'S CARDS ARE NOT IN `Scorecard`.
   *
   * A side files `TeamScorecard` — one row per side for a shared ball, one per
   * player for a four-ball — so reading the individual table for a team round
   * finds nothing and reports a finished foursomes as "Not settled yet". Seen
   * on the seeded club's four-ball: two rounds played, both reported as
   * outstanding, which is worse than saying nothing at all.
   *
   * `teamStandings` is the reader the organizer's own team board uses, so the
   * side named here is the side named there.
   */
  const teamRows = new Map<string, Awaited<ReturnType<typeof teamStandings>>>();
  for (const stage of stages.filter((s) => needsTeams(s.format))) {
    const card = cardByStage.get(stage.id) ?? { pars: [], holeDifficulty: [] };
    teamRows.set(
      stage.id,
      await teamStandings(
        state.event.id,
        stage.id,
        stage.format,
        card.pars,
        card.holeDifficulty,
        stage.scoringBasis ?? "net",
        stage.handicapAllowance,
        stage.allowanceWeights,
        stage.countBest,
      ),
    );
  }

  const outcomes: RoundOutcome[] = stages.map((stage) => {
    const label = roundLabel(state.stages, stage.id) || stage.description || stage.type;

    /**
     * A FORMAT THE APP DOES NOT SCORE IS NOT A HOLE IN THE RESULT. The
     * committee decides it, and what they posted is the result — the same rule
     * `standingRows` applies by returning [] rather than guessing. Nothing is
     * stored for that yet, so the line says where the answer lives.
     */
    if (isManualFormat(stage.format)) {
      return { kind: "manual", label, note: "" };
    }

    if (isHeadToHead(stage.type)) {
      const played = state.matches
        .filter((m) => m.stageId === stage.id)
        .map((m) => {
          let holes: ("A" | "B" | "H" | null)[] = [];
          try {
            holes = JSON.parse(m.holes);
          } catch {
            holes = [];
          }
          return { match: m, result: resolveMatch(holes) };
        })
        .filter((m) => m.result.complete);
      if (played.length === 0) return { kind: "pending", label };
      /**
       * ONE MATCH IS A MATCH; SEVERAL ARE A ROUND OF THEM. A single match
       * reads as a margin ("3&2"), which is the only way golf states one. A
       * round robin's dozen cannot be one sentence, so it is reported by who
       * won most — and `wins` is the unit, so nobody reads it as a score.
       */
      if (played.length === 1) {
        const { match, result } = played[0];
        const a = nameOf.get(match.playerAId ?? "") ?? "Side A";
        const b = nameOf.get(match.playerBId ?? "") ?? "Side B";
        if (result.winner === "H" || !result.winner) {
          return { kind: "match", label, winner: a, loser: b, margin: "halved" };
        }
        const margin = marginOf(result.lead, result.remaining);
        return result.winner === "A"
          ? { kind: "match", label, winner: a, loser: b, margin }
          : { kind: "match", label, winner: b, loser: a, margin };
      }
      const wins = new Map<string, number>();
      for (const { match, result } of played) {
        const id = result.winner === "A" ? match.playerAId : result.winner === "B" ? match.playerBId : null;
        if (id) wins.set(id, (wins.get(id) ?? 0) + 1);
      }
      const most = Math.max(0, ...wins.values());
      if (most === 0) return { kind: "pending", label, note: "Every match halved" };
      const winners = [...wins.entries()]
        .filter(([, n]) => n === most)
        .map(([id]) => ({ name: nameOf.get(id) ?? "—", score: String(most) }));
      return { kind: "stroke", label, winners, unit: most === 1 ? "win" : "wins" };
    }

    /**
     * A ROUND PLAYED BY SIDES, reported as the side that won it — from the
     * same reader the organizer's team board uses.
     */
    if (needsTeams(stage.format)) {
      const unit = roundUnit(stage);
      const played = (teamRows.get(stage.id) ?? []).filter((t) => t.played > 0);
      if (played.length === 0) return { kind: "pending", label };
      const value = (t: (typeof played)[number]) =>
        unit.higherWins ? t.points : unit.label === "gross" ? t.gross : t.net;
      const best = unit.higherWins
        ? Math.max(...played.map(value))
        : Math.min(...played.map(value));
      return {
        kind: "team",
        label,
        winners: played
          .filter((t) => value(t) === best)
          .map((t) => ({ name: t.name, score: `${best} ${unit.label}` })),
      };
    }

    /**
     * A ROUND SCORED BY CARDS, aggregated over ITS OWN course and hole count.
     * A two-course day scored round two against round one's par and stroke
     * index for a year — see `courseForRound`, which exists for exactly that.
     */
    const holes = holesPlayed(stage.holes);
    const cards = parseStrokeCards(
      cardRows.filter((c) => c.stageId === stage.id && c.status !== "disputed"),
    );
    if (cards.length === 0) return { kind: "pending", label };

    const agg = aggregateStroke(cards, {
      courseFor,
      handicapFor: (playerId) => state.strokeHandicapFor(playerId, stage.id),
      holeStrokesReceived,
      stablefordPointsForHole: (strokes, par, hs) => stablefordPointsForHole(strokes, par, hs),
      allocationHoles,
    });

    const unit = roundUnit(stage);
    const basis = (stage.scoringBasis ?? "net").toLowerCase();
    const scored = [...agg.entries()]
      // Only a complete card can win a round: ranking a fourteen-hole card
      // against an eighteen-hole one presents two numbers as comparable when
      // they are not (Rule 3.2b, and `isRanked` says the same).
      .filter(([, row]) => row.thru >= holes)
      .map(([playerId, row]) => ({
        playerId,
        value: unit.higherWins
          ? row.points
          : basis === "gross"
            ? row.gross
            : row.gross - handicapOf(state, playerId, stage.id),
      }));
    if (scored.length === 0) return { kind: "pending", label };

    // Points: most wins. Strokes: fewest. The unit decides, so a Stableford
    // round filed as "net" cannot be won by the lowest score.
    const best = unit.higherWins
      ? Math.max(...scored.map((s) => s.value))
      : Math.min(...scored.map((s) => s.value));
    const winners = scored
      .filter((s) => s.value === best)
      .map((s) => ({ name: nameOf.get(s.playerId) ?? "—", score: String(best) }));

    // A round played by sides is reported as sides won it — the card above is
    // still one player's, so the name is theirs; the kind is what stops a
    // screen ranking a team round as an individual one.
    return needsTeams(stage.format)
      ? { kind: "team", label, winners }
      : { kind: "stroke", label, winners, unit: unit.label };
  });

  return tournamentResult(outcomes);
}

/** The handicap this player played that round off, as the state resolved it. */
function handicapOf(state: EventState, playerId: string, stageId: string): number {
  return state.strokeHandicapFor(playerId, stageId);
}

/**
 * "3&2", "1 up", "2 holes" — how golf states a margin.
 *
 * A match closed out reads as the lead and the holes that were never played;
 * one that went the distance is stated in holes.
 */
function marginOf(lead: number, remaining: number): string {
  const up = Math.abs(lead);
  if (remaining > 0) return `${up}&${remaining}`;
  return up === 1 ? "1 up" : `${up} up`;
}
