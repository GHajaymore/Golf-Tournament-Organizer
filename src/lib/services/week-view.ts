import "server-only";
import { prisma } from "../db";
import { resolveCourse } from "../courses";
import { holeStrokesReceived, stablefordPointsForHole, allocationHoles } from "../domain";
import { aggregateStroke, emptyAgg, netOf } from "../domain/stroke-agg";
import { skinsPotFor, type SkinsPotView } from "./skins-pot";
import {
  loadEventState,
  playingStages,
  parseStrokeCards,
  chainRoundStandings,
  parseMatchTiebreakers,
} from "./tournament";
import { movementBetween, type WeekRow } from "../domain/week-movement";
import { isManualFormat } from "../formats";

/**
 * One week of a league, gathered in the order a member reads it.
 *
 * A league is not a tournament that happens to have several rounds. Nobody
 * asks "how am I doing across the season" first — they ask "what happened
 * last night", then "what did that do to me", then "did I win any money".
 * Those three answers currently live on three screens, and an organizer
 * standing in the bar reads them out from three tabs.
 *
 * So this assembles the week: the night's results, what it moved in the
 * standings, and the money. The movement column is the part the incumbents
 * don't show — a position is a fact, but a position CHANGE is the thing
 * everybody actually argues about.
 */

export interface WeekResult {
  playerId: string;
  name: string;
  gross: number;
  net: number;
  points: number;
  thru: number;
  /** Position on the night, ties sharing a place. */
  position: number;
}

export interface WeekView {
  weeks: Array<{ stageId: string; label: string; format: string; holes: number; played: boolean }>;
  stageId: string;
  label: string;
  format: string;
  holes: number;
  /** Ranked by the round's own basis: Stableford by points, otherwise by net. */
  results: WeekResult[];
  stableford: boolean;
  /** Standings after this week, with movement since the week before. */
  standings: WeekRow[];
  grossSkins: SkinsPotView | null;
  netSkins: SkinsPotView | null;
  /** True when no score has been entered for this week yet. */
  empty: boolean;
  /**
   * This week's round is scored by hand, so there is no ranking to show.
   *
   * The leaderboard has refused to rank these since the format was added; this
   * screen had to be taught the same thing, because it aggregates cards
   * directly and would otherwise have ranked a Flag day on net strokes.
   */
  manual: boolean;
}

/**
 * Rank with ties sharing a place.
 *
 * Two players round the same score and both finish second; the next finishes
 * fourth. Handing out 2nd and 3rd arbitrarily is the kind of small wrongness
 * that gets a club arguing at the bar and stops them trusting the app.
 */
function positionWithTies<T>(rows: T[], same: (a: T, b: T) => boolean): Array<T & { position: number }> {
  return rows.map((r, i) => {
    let pos = i + 1;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (!same(rows[j], r)) break;
      pos = j + 1;
    }
    return { ...r, position: pos };
  });
}

export async function weekViewFor(eventId: string, wantedStageId?: string): Promise<WeekView | null> {
  const state = await loadEventState(eventId);
  if (!state) return null;

  const weeks = playingStages(state.stages);
  const stage = weeks.find((s) => s.id === wantedStageId) ?? state.activeStage ?? weeks[0] ?? null;
  if (!stage) return null;

  const cards = await prisma.scorecard.findMany({ where: { eventId } });
  const course = await resolveCourse(state.event);
  const pars = course.pars;
  const holeDifficulty = course.strokeIndex ?? [];

  // The resolver loadEventState built, not a copy of it. Rebuilding the tee
  // maps here is exactly the drift handicap-wiring.test.ts exists to stop:
  // both screens would look right and quietly disagree about a net score.
  const handicapFor = state.strokeHandicapFor;

  // Checked before anything is aggregated. A hand-scored round has cards, and
  // adding them up would produce a ranking the club never played for.
  const manual = isManualFormat(stage.format);

  const thisWeek = manual ? [] : parseStrokeCards(cards.filter((c) => c.stageId === stage.id));
  const agg = aggregateStroke(thisWeek, {
    pars,
    holeDifficulty,
    handicapFor,
    holeStrokesReceived,
    stablefordPointsForHole,
    allocationHoles,
  });

  const stableford = stage.scoringBasis === "stableford";
  const scored = state.confirmed
    .map((p) => {
      const a = agg.get(p.id) ?? emptyAgg();
      return {
        playerId: p.id,
        name: p.name,
        gross: a.gross,
        net: netOf(a),
        points: a.points,
        thru: a.thru,
      };
    })
    // Somebody who did not play this week is not last — they are absent, and
    // a league where missing a Tuesday puts you bottom of the sheet is a
    // league nobody comes back to.
    .filter((r) => r.thru > 0)
    .sort((x, y) => (stableford ? y.points - x.points : x.net - y.net || x.gross - y.gross));

  const results = positionWithTies(scored, (a, b) =>
    stableford ? a.points === b.points : a.net === b.net && a.gross === b.gross,
  );

  // Standings after this week against standings after the one before, so the
  // movement column means "because of last night" and nothing else.
  const idx = weeks.findIndex((s) => s.id === stage.id);
  // A hand-scored week has no table of its own to show either: the standings
  // "after this week" would be the standings after the week before, presented
  // as though this one had been counted.
  const standings = manual
    ? []
    : await standingsWithMovement(state, weeks, idx, cards, {
        pars,
        holeDifficulty,
        handicapFor,
        stableford,
      });

  const [grossSkins, netSkins] = await Promise.all([
    skinsPotFor(eventId, stage.id, false),
    skinsPotFor(eventId, stage.id, true),
  ]);

  return {
    weeks: weeks.map((s, i) => ({
      stageId: s.id,
      label: `Week ${i + 1}`,
      format: s.format,
      holes: s.holes,
      played: cards.some((c) => c.stageId === s.id),
    })),
    stageId: stage.id,
    label: `Week ${idx + 1}`,
    format: stage.format,
    holes: stage.holes,
    results,
    stableford,
    standings,
    grossSkins,
    netSkins,
    // A manual week is not "empty" — it has a result, just not one this app
    // knows. The screen says which, and they read differently.
    empty: !manual && results.length === 0,
    manual,
  };
}

/**
 * Cumulative standings through a given week, and the same through the week
 * before it, reduced to a position and a change.
 *
 * Match-play leagues already have this chained for them; stroke leagues are
 * summed here from the same aggregator, cards filtered by which weeks count.
 */
async function standingsWithMovement(
  state: NonNullable<Awaited<ReturnType<typeof loadEventState>>>,
  weeks: Array<{ id: string }>,
  idx: number,
  cards: Array<{ playerId: string; stageId: string; strokes: string }>,
  opts: {
    pars: number[];
    holeDifficulty: number[];
    handicapFor: (playerId: string, stageId: string) => number;
    stableford: boolean;
  },
): Promise<WeekRow[]> {
  const nameOf = new Map(state.confirmed.map((p) => [p.id, p.name]));

  if (!state.isStroke) {
    // A match-play league carries points week to week; chainRoundStandings is
    // the same math the leaderboard uses, so the two cannot disagree.
    const chained = chainRoundStandings(
      state.rrStages,
      state.matches,
      state.domainPlayers,
      state.scoring,
      opts.holeDifficulty,
      parseMatchTiebreakers(state.event.matchTiebreakers),
    );
    const after = chained[idx] ?? [];
    const before = idx > 0 ? chained[idx - 1] ?? [] : [];
    return movementBetween(
      after.map((r) => ({ playerId: r.player.id, name: nameOf.get(r.player.id) ?? r.player.name, value: r.stats.totalPoints })),
      before.map((r) => ({ playerId: r.player.id, value: r.stats.totalPoints })),
      "desc",
    );
  }

  const through = (n: number) => {
    const ids = new Set(weeks.slice(0, n + 1).map((s) => s.id));
    const agg = aggregateStroke(parseStrokeCards(cards.filter((c) => ids.has(c.stageId))), {
      pars: opts.pars,
      holeDifficulty: opts.holeDifficulty,
      handicapFor: opts.handicapFor,
      holeStrokesReceived,
      stablefordPointsForHole,
      allocationHoles,
    });
    return state.confirmed
      .map((p) => {
        const a = agg.get(p.id) ?? emptyAgg();
        return { playerId: p.id, name: p.name, value: opts.stableford ? a.points : netOf(a), thru: a.thru };
      })
      .filter((r) => r.thru > 0);
  };

  // Stableford totals rank high-to-low; net strokes low-to-high.
  const dir = opts.stableford ? "desc" : "asc";
  return movementBetween(through(idx), idx > 0 ? through(idx - 1) : [], dir);
}
