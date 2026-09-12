import "server-only";
import { prisma } from "../db";
import { resolveCourse } from "../courses";
import { holeStrokesReceived, stablefordPointsForHole, modifiedStablefordForHole, allocationHoles } from "../domain";
import { aggregateStroke, emptyAgg, netOf } from "../domain/stroke-agg";
import { skinsPotFor, type SkinsPotView } from "./skins-pot";
import { isSkinsScope, skinsGameLabel, type SkinsScope } from "../domain/skins-pot";
import { roundIsStroke } from "../stage-types";
import {
  loadEventState,
  playingStages,
  parseStrokeCards,
  chainRoundStandings,
  parseMatchTiebreakers,
  matchSettled,
  settingsOf,
} from "./tournament";
import { movementBetween, type WeekRow } from "../domain/week-movement";
import { resolveAttendance, tracksPerRound, type AttendanceMode } from "../domain/attendance";
import { isManualFormat, stablefordTableFor } from "../formats";
import {
  weekBasis,
  compareOnBasis,
  levelOnBasis,
  valueOnBasis,
  directionOnBasis,
  type WeekBasis,
} from "../domain/week-basis";
import { cleanIsoDate, shortDate } from "../domain/round-dates";

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

/** One skins game on one round: which game it is, and how it finished. */
export interface SkinsGame {
  net: boolean;
  scope: SkinsScope;
  /** Named once, in `skinsGameLabel`, so every screen calls it the same. */
  label: string;
  view: SkinsPotView;
}

export interface WeekView {
  weeks: Array<{ stageId: string; label: string; date: string; format: string; holes: number; played: boolean }>;
  stageId: string;
  label: string;
  /** "Tue 19 May", or "" when the round has no fixed day. */
  date: string;
  format: string;
  holes: number;
  /** Ranked by the round's own basis: Stableford by points, otherwise by net. */
  results: WeekResult[];
  /**
   * What the night is decided on — see `week-basis.ts`.
   *
   * This was a boolean, `stableford`, and everything that was not Stableford
   * was ranked and labelled as NET. A round set to gross was therefore ranked
   * by net on the one screen a league reads every week, while the ordinary
   * leaderboard ranked the same round by gross.
   */
  basis: WeekBasis;
  /** Standings after this week, with movement since the week before. */
  standings: WeekRow[];
  /**
   * The skins games this round actually ran, in the order they are read.
   *
   * A list rather than a gross/net pair, because a league night runs four —
   * front and back, each gross and net. The old pair asked for two whole-round
   * pots; the other two held real money and appeared on no screen.
   */
  skins: SkinsGame[];
  /** True when no score has been entered for this week yet. */
  empty: boolean;
  /**
   * Who was expected, and how many of them have handed a card in.
   *
   * Null outside a weekly league — a tournament has no "in for this round" and
   * the whole field is expected every time.
   *
   * The sheet drops anybody who did not play, deliberately: "somebody who did
   * not play this week is not last, they are absent". Correct for the RANKING
   * and silent about the question an organizer actually has at nine o'clock,
   * which is whether the night is finished. Sixteen rows on a week eighteen
   * were in for is two cards outstanding and somebody to ring; sixteen rows on
   * a week sixteen were in for is done. The sheet looked identical either way.
   */
  attendance: { expected: number; returned: number; out: number } | null;
  /**
   * Whether the night's gross/net results table has rows.
   *
   * A played MATCH week has none — its result is match points, which the
   * season table carries — so this is not the same question as `empty`.
   */
  hasScoreTable: boolean;
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
  // Event level on purpose, and the only thing still resolved that way here:
  // this orders MATCH tiebreaks across a whole season's chain, not one round's
  // card. Anything that scores a card goes through `state.strokeCourseFor`.
  const holeDifficulty = course.strokeIndex ?? [];

  // The resolvers loadEventState built, not copies of them. Rebuilding either
  // here is exactly the drift handicap-wiring.test.ts exists to stop: both
  // screens would look right and quietly disagree about a net score.
  //
  // The handicap has been read from the state since that comment was written.
  // The COURSE was rebuilt from `resolveCourse(event)` directly underneath it
  // for just as long, under the heading "one week is one round at one venue,
  // so every card here shares a course" — true of the venue, and silent about
  // the NINE. A league playing the back nine got a handicap for nine holes and
  // a card for eighteen, so a player owed 9 strokes drew 5.
  const handicapFor = state.strokeHandicapFor;
  const courseFor = state.strokeCourseFor;

  // Checked before anything is aggregated. A hand-scored round has cards, and
  // adding them up would produce a ranking the club never played for.
  const manual = isManualFormat(stage.format);

  const thisWeek = manual ? [] : parseStrokeCards(cards.filter((c) => c.stageId === stage.id));
  const agg = aggregateStroke(thisWeek, {
    courseFor,
    handicapFor,
    holeStrokesReceived,
    // Modified Stableford is a different table, and this week's board ranks on
    // whatever these points are — so scoring them on the standard one puts a
    // league night in a different order from the round's own leaderboard.
    stablefordPointsForHole: stablefordTableFor(
      () => stage.format,
      stablefordPointsForHole,
      modifiedStablefordForHole,
    ),
    allocationHoles,
  });

  /**
   * WHETHER A NIGHT HAS BEEN PLAYED, ASKED THE WAY THAT NIGHT IS SCORED.
   *
   * `results` below is built from CARDS, and a match-play week keeps its
   * results on the matches — so on a weekly match-play league every player's
   * `thru` is nought, `results` is empty, and the screen declared the night
   * unplayed. Demo Cup showed "No scores are in for week 1 yet" over
   * forty-seven completed matches.
   *
   * That blanked the whole screen, including the season table underneath it,
   * which HAS a match branch (`chainRoundStandings`) and had the points all
   * along. The one section that could answer the question was hidden by the
   * one that could not.
   *
   * The same fault as `PlayerLeaderboard` reading `thru > 0` for a match
   * board, fixed earlier in this file's history and never carried across.
   *
   * `matchSettled` is one hole or a forfeit — deliberately loose. This decides
   * whether to SHOW a screen, not whether to release money, and the round card
   * uses the same looseness for "which round are we on".
   */
  /**
   * THE WEEK'S OWN TYPE, not the tournament's format.
   *
   * `WEEKLY_ROUND_TYPES` is Round Robin AND Stroke Play Round, so a league's
   * weeks can genuinely be of both kinds — and this asked `state.isStroke`,
   * which is one value for the whole season. A match-play league that plays
   * one medal week therefore looked for MATCHES on it and found none, however
   * many cards were in.
   *
   * Seen on the Demo Cup on 2026-09-12: week 2 is a Stroke Play Round with
   * seven cards returned, and the strip wore the "no scores yet" dot.
   */
  const played = roundIsStroke(stage.type, stage.format)
    ? cards.some((c) => c.stageId === stage.id)
    : state.matches.some((m) => m.stageId === stage.id && matchSettled(m));

  const basis = weekBasis(stage.scoringBasis);
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
    .sort((x, y) => compareOnBasis(basis, x, y));

  const results = positionWithTies(scored, (a, b) => levelOnBasis(basis, a, b));

  /**
   * Who was expected, and how many have handed a card in.
   *
   * `scored` above drops anybody who did not play, which is right for the
   * ranking and silent about whether the night is FINISHED. Counted here,
   * against the week's own field rather than the season roster, so the number
   * is "cards still to come" and not "members who were never coming".
   *
   * `thru > 0` for returned, matching the filter the table itself uses — a
   * card with nothing on it is not a card in, and counting it would tell an
   * organizer the night was done while a scorer was still walking up 18.
   */
  const attendanceMode = settingsOf(state.event).attendanceMode as AttendanceMode;
  let attendance: WeekView["attendance"] = null;
  if (tracksPerRound(attendanceMode)) {
    const explicit = await prisma.roundAttendance.findMany({
      where: { eventId, stageId: stage.id },
    });
    const resolved = resolveAttendance(
      attendanceMode,
      state.confirmed.map((p) => p.id),
      explicit.map((e) => ({ playerId: e.playerId, status: e.status, decidedBy: e.decidedBy })),
    );
    const inIds = new Set(resolved.rows.filter((r) => r.status === "in").map((r) => r.playerId));
    attendance = {
      expected: resolved.in,
      returned: scored.filter((r) => inIds.has(r.playerId)).length,
      out: resolved.out,
    };
  }

  // Standings after this week against standings after the one before, so the
  // movement column means "because of last night" and nothing else.
  const idx = weeks.findIndex((s) => s.id === stage.id);
  // A hand-scored week has no table of its own to show either: the standings
  // "after this week" would be the standings after the week before, presented
  // as though this one had been counted.
  const standings = manual
    ? []
    : await standingsWithMovement(state, weeks, idx, cards, {
        holeDifficulty,
        handicapFor,
        basis,
      });

  /**
   * Every skins game this round actually ran, not a fixed gross-and-net pair.
   *
   * A league night runs four — front and back, each gross and net — and this
   * used to ask for exactly two, over the whole round. The other two existed,
   * held money, and appeared on no screen.
   *
   * Enumerated from the rows rather than assumed, so a medal with one pot
   * shows one and a league with four shows four, with no setting deciding it.
   */
  const potRows = await prisma.skinsPot.findMany({
    // The club's own pots. A fourball's private game is theirs and lives on
    // Group games; without this filter the week sheet rendered the FIELD's
    // pot once per group pot on the round — the same card twice — and showed
    // no group pot at all.
    where: { stageId: stage.id, groupKey: "" },
    select: { net: true, scope: true },
    orderBy: [{ scope: "asc" }, { net: "asc" }],
  });
  const skins = (
    await Promise.all(
      potRows.map(async (p) => {
        const scope = isSkinsScope(p.scope) ? p.scope : "full";
        const view = await skinsPotFor(eventId, stage.id, p.net, scope, "");
        return view
          ? { net: p.net, scope, label: skinsGameLabel(p.net, scope, stage.holes), view }
          : null;
      }),
    )
  ).filter((g): g is NonNullable<typeof g> => g !== null);

  return {
    weeks: weeks.map((s, i) => ({
      stageId: s.id,
      label: `Week ${i + 1}`,
      // The date a member recognises the night by. A league is "Tuesday the
      // 19th" long before it is "week 4".
      date: shortDate(cleanIsoDate(s.playedOn)),
      format: s.format,
      holes: s.holes,
      // Asked the way THAT WEEK is scored, same as `played` above — and the
      // emphasis is the correction. This already said "the way that week is
      // scored" and then asked `state.isStroke`, which is the way the SEASON
      // is scored: one value for every week in it. A league with a medal week
      // among its match nights wore the "no scores yet" dot on that week for
      // ever, because it went looking for matches on it.
      played: roundIsStroke(s.type, s.format)
        ? cards.some((c) => c.stageId === s.id)
        : state.matches.some((m) => m.stageId === s.id && matchSettled(m)),
    })),
    stageId: stage.id,
    label: `Week ${idx + 1}`,
    date: shortDate(cleanIsoDate(stage.playedOn)),
    format: stage.format,
    holes: stage.holes,
    results,
    basis,
    standings,
    skins,
    // A manual week is not "empty" — it has a result, just not one this app
    // knows. The screen says which, and they read differently.
    empty: !manual && !played,
    /**
     * Whether the night's own RESULTS table has anything to put in it.
     *
     * Separate from `empty` on purpose. That table is gross and net, which a
     * match night does not have — its result is the points already in the
     * table below. So a played match week is not empty AND has no scores
     * table, and the screen needs to tell those apart rather than blanking.
     */
    hasScoreTable: results.length > 0,
    manual,
    attendance,
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
  // `format` too, because summing several weeks means each of them chooses
  // its own Stableford table.
  weeks: Array<{ id: string; format: string }>,
  idx: number,
  cards: Array<{ playerId: string; stageId: string; strokes: string }>,
  opts: {
    // No `pars`: the stroke card comes from `state.strokeCourseFor`, per round.
    // This one is the match-play tiebreak order, which is an event-level chain.
    holeDifficulty: number[];
    handicapFor: (playerId: string, stageId: string) => number;
    basis: WeekBasis;
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
    /**
     * TWO LISTS, AND THEY ARE NOT THE SAME LIST.
     *
     * `chained` is parallel to `state.rrStages` — Round Robins only — and `idx`
     * counts WEEKS, which is `WEEKLY_ROUND_TYPES`: Round Robin AND Stroke Play
     * Round. They line up only in a league whose every week is a round robin,
     * and silently slip by one the moment a medal night appears before a match
     * night.
     *
     * Measured on 2026-09-12 on a two-week league, medal first:
     *
     *   week 1 (the MEDAL)  -> standings 2.5/0   <- week 2's match points
     *   week 2 (the MATCH)  -> standings (none)  <- its own, missing
     *
     * A league's season table shown against the wrong night, and absent from
     * the right one. Same family as `ranking-then-renumbering`: an answer that
     * knows which row it belongs to, handed to a reader that re-derives it from
     * a position.
     *
     * Counted by STAGE now. A medal week earns no match points, so it shows the
     * season as it stands going INTO that night — which is the honest answer
     * and the one a member reading the sheet wants — and a week before any
     * round robin at all shows nothing, because nothing has been won yet.
     */
    const rrThroughHere = state.rrStages.filter((s) => {
      const at = weeks.findIndex((w) => w.id === s.id);
      return at >= 0 && at <= idx;
    }).length;
    const after = rrThroughHere > 0 ? chained[rrThroughHere - 1] ?? [] : [];
    const before = rrThroughHere > 1 ? chained[rrThroughHere - 2] ?? [] : [];
    /**
     * THE RANK COMES WITH THE ROW, not from the points column.
     *
     * The comment above is right that this is the leaderboard's math — and
     * then only `totalPoints` was handed on, so the place was worked out
     * again downstream from that one number and the tiebreak was thrown
     * away. Demo Cup, 2026-09-11: four players level on 10.5 were 3/4/5/6 on
     * the leaderboard and 3/3/3/3 here, in that order, on the same night.
     *
     * `rankPlayers` shares a place when nothing separates two players and
     * splits them when the club's chain does. Carrying its answer is the only
     * way the two screens can keep the promise this function already made.
     *
     * Both weeks, because movement is the difference between two positions
     * and one of them derived a different way would invent an arrow.
     */
    return movementBetween(
      after.map((r) => ({
        playerId: r.player.id,
        name: nameOf.get(r.player.id) ?? r.player.name,
        value: r.stats.totalPoints,
        rank: r.rank,
      })),
      before.map((r) => ({ playerId: r.player.id, value: r.stats.totalPoints, rank: r.rank })),
      "desc",
    );
  }

  const through = (n: number) => {
    const ids = new Set(weeks.slice(0, n + 1).map((s) => s.id));
    const agg = aggregateStroke(parseStrokeCards(cards.filter((c) => ids.has(c.stageId))), {
      // Per stage, and here it matters twice over: this totals SEVERAL weeks,
      // so one card for all of them is wrong the moment a season plays two
      // venues or mixes a nine among the eighteens.
      courseFor: state.strokeCourseFor,
      handicapFor: opts.handicapFor,
      holeStrokesReceived,
      // Per week, because this totals several of them and a league can run a
      // modified round among ordinary ones.
      stablefordPointsForHole: stablefordTableFor(
        (stageId) => weeks.find((w) => w.id === stageId)?.format,
        stablefordPointsForHole,
        modifiedStablefordForHole,
      ),
      allocationHoles,
    });
    return state.confirmed
      .map((p) => {
        const a = agg.get(p.id) ?? emptyAgg();
        return {
          playerId: p.id,
          name: p.name,
          // The season total is on the same figure the night was decided on,
          // or the table under the sheet ranks the league on something the
          // round was never set to.
          value: valueOnBasis(opts.basis, { gross: a.gross, net: netOf(a), points: a.points }),
          thru: a.thru,
        };
      })
      .filter((r) => r.thru > 0);
  };

  // Stableford totals rank high-to-low; strokes low-to-high.
  const dir = directionOnBasis(opts.basis);
  return movementBetween(through(idx), idx > 0 ? through(idx - 1) : [], dir);
}
