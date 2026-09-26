import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "../db";
import { organizationAllows } from "./entitlements";
import { COURSE_REF, soleVenueCourse } from "./course-resolution";
import { roundNameFor } from "../domain/round-label";
import { loadEventState, standingRows, cutLineNote, settingsOf } from "./tournament";
import { teamMatchBoard } from "./teams";
import { boardKindForRound, isKnockoutRound } from "../stage-types";
import { drawnDraws } from "../domain/my-tie";
import { bracketResults } from "./bracket-results";
import type { BracketView } from "../domain/bracket";
import { isLeaguePointsSystem, type LeaguePointsSystem } from "../domain/league-meeting";
import { resolveAttendance, tracksPerRound, type AttendanceMode } from "../domain/attendance";
import type { StandingRow } from "@/components/LeaderboardTable";
import { teamStandings } from "./teams";
import { weekBasis, isStablefordRound, type WeekBasis } from "../domain/week-basis";
import { skinsBoard, nassauBoard, modifiedStablefordBoard } from "./points-standings";
import { brandForEvent, themeForEvent } from "./organization";
import { themeCss, playerColorScheme } from "../themes";
import { holesPlayed } from "../domain/handicap";
import { storedMatchIsOver } from "../domain/match";

/**
 * Everything the public board shows, computed once and shared by the crowd.
 *
 * The board is the only page in this app a crowd looks at simultaneously — a
 * club's players, their families, and whoever has the link — and since it
 * started refreshing itself every thirty seconds, each of those people is a
 * standing request every thirty seconds for five hours.
 *
 * Measured before this existed: **20.7 database queries per request**, every
 * one of them computing an answer identical to the one already computed for
 * the viewer beside them. Three hundred spectators polling one event is over
 * two hundred queries a second, all to produce the same table.
 *
 * That is the textbook case for a cache and not for a bigger database: demand
 * is high, the underlying data is not. A fourball completes a hole about every
 * twelve minutes. Nothing here needs to be recomputed per viewer.
 *
 * WHAT IS DELIBERATELY NOT CACHED is the token. The share token is a
 * CREDENTIAL, and whether this tournament is published is a permission — so
 * the page checks both on every request, uncached, and only then asks for the
 * board. A club that unpublishes its leaderboard is not asking to be
 * unpublished within a minute; it is asking now. One query is the right price
 * for that, and it is the query this file must never absorb.
 */

/** The tag every writer touches to say the standings moved. */
export function boardTag(eventId: string): string {
  return `board:${eventId}`;
}

export interface LiveBoardView {
  name: string;
  dates: string;
  venue: string;
  /** The team format, for the team board heading. */
  teamFormat: string;
  rows: ReturnType<typeof standingRows>;
  teamRows: Awaited<ReturnType<typeof teamStandings>>;
  /** Sides ranked on their MATCHES, for a head-to-head team round. Empty
   *  otherwise — the board branches on `kind`, not on this being non-empty. */
  teamMatchRows: Awaited<ReturnType<typeof teamMatchBoard>>;
  /** How match points are counted here: the club's, or the standard. */
  pointsSystem: LeaguePointsSystem;
  skins: Awaited<ReturnType<typeof skinsBoard>> | null;
  nassau: Awaited<ReturnType<typeof nassauBoard>> | null;
  modStableford: Awaited<ReturnType<typeof modifiedStablefordBoard>> | null;
  skinsNet: boolean;
  kind: string;
  teamRound: boolean;
  isStroke: boolean;
  isStableford: boolean;
  /** What a TEAM round here is decided on — see `week-basis.ts`. `isStableford`
   *  above answers a narrower question and a gross team round needs the third
   *  value, not the absence of the first. */
  teamBasis: WeekBasis;
  holeCount: number;
  /** One sentence explaining where the cut line falls, or "" for none. */
  cutNote: string;
  /**
   * What the score column MEASURES: "strokes", "Stableford points", "match
   * points".
   *
   * The player's own Board tab has said so all along and the public link did
   * not, which is backwards — a spectator following a share link is the reader
   * least able to infer from the shape of the digits whether 10.5 is a score,
   * a points total or a handicap. Same component, same prop, passed on one of
   * its two call sites.
   */
  unit: string;
  manualFormat: boolean;
  /**
   * The knockout draw, where the tournament has one and somebody is in it —
   * the same list and names `/me/board` shows. Empty otherwise. The club's
   * share link is the page a knockout's members and families actually follow,
   * and it printed the qualifying table and nothing about who was still in.
   */
  draws: { label: string; view: BracketView }[];
  bracketResults: Record<string, string>;
  /** The knockout IS the first round: the draw replaces the table. */
  straightKnockout: boolean;
  allIn: boolean;
  roundLabel: string;
  brand: Awaited<ReturnType<typeof brandForEvent>>;
  themeStyleSheet: string;
  colorScheme: string;
}

/**
 * Whether a fixture on this round is OVER — decided, not merely begun.
 *
 * `matchSettled` used to be what `allIn` asked, and it is satisfied by a match
 * with ONE HOLE on it. So the chip on `/live` read "Final" while every pairing
 * was still on the 2nd tee, to a club's spectators — the widest audience
 * anything in this app has. The card branch beside it demands `thru >=
 * holeCount` from every player who is in, so the two halves of one question
 * were held to completely different standards.
 *
 * `matchIsOver` is the strict reading and the distinction is already written
 * down on both functions. Its own doc block records the PREVIOUS instance of
 * this exact confusion, in `roundMoneyFor`, which is why the wording there is
 * so emphatic. A closeout counts, so 5&4 is over with four holes unplayed, and
 * the empty card — `resolveMatch([])` is complete, because nothing is left to
 * play — is guarded explicitly, which is what stops a drawn round nobody has
 * touched announcing Final before the first tee shot.
 *
 * `matchSettled` stays right where it is used for PROGRESS: "which round is
 * the tournament on" wants the loose reading, and this is a claim about a
 * result.
 */
const roundMatchIsOver = storedMatchIsOver;

/**
 * Mark the rows a weekly league says are not playing this round.
 *
 * Returns the rows UNCHANGED for every tournament, which is what keeps this
 * invisible to the ninety per cent of events that have no weekly question:
 * `tracksPerRound` is false, no query runs, and `absent` stays undefined on
 * every row so that any reader which does not know about it is right.
 *
 * Resolved through `resolveAttendance` rather than read off the stored rows,
 * because "out" is mostly the ABSENCE of a row — under opt-in and captains a
 * player is out by saying nothing — and a reader that only knew about explicit
 * rows would mark nobody in exactly the leagues where this matters most.
 */
async function withAttendance(
  eventId: string,
  state: { event: { attendanceMode?: string }; confirmed: { id: string }[] },
  stageId: string,
  rows: StandingRow[],
): Promise<StandingRow[]> {
  const mode = settingsOf(state.event as Parameters<typeof settingsOf>[0]).attendanceMode as AttendanceMode;
  if (!tracksPerRound(mode) || !stageId) return rows;

  const explicit = await prisma.roundAttendance.findMany({ where: { eventId, stageId } });
  const resolved = resolveAttendance(
    mode,
    state.confirmed.map((p) => p.id),
    explicit.map((e) => ({ playerId: e.playerId, status: e.status, decidedBy: e.decidedBy })),
  );
  const out = new Set(resolved.rows.filter((r) => r.status === "out").map((r) => r.playerId));
  return rows.map((r) => ({ ...r, absent: out.has(r.id) }));
}

async function gather(eventId: string): Promise<LiveBoardView | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: COURSE_REF });
  if (!event) return null;

  /**
   * THE TIER, BEFORE ANY OF IT IS BUILT.
   *
   * `docs/pricing-proposal.md` puts the public link on the paid tiers and the
   * code gave it to everybody, with nowhere to even express the rule. On for
   * every plan today — the ladder is undecided — so this changes nothing now
   * and makes the change a boolean later.
   *
   * NULL, which this page already means something by: `/live/[token]` answers
   * 404 identically for a wrong token and for a board the organizer has
   * unpublished, so that switching a link off never confirms the tournament
   * exists. A tier that does not include the public board lands in exactly
   * that answer, and says nothing to a stranger about why.
   *
   * INSIDE the cached gather, deliberately. It costs one query rather than one
   * per spectator — the whole point of the cache, measured at 20.7 queries per
   * request before it existed — and the cost is that a plan change takes up to
   * sixty seconds to reach the board, which is the same window every score on
   * it already has.
   */
  if (!(await organizationAllows(event.organizationId, "publicBoard"))) return null;

  const state = await loadEventState(eventId);
  if (!state) return null;

  const activeStage = state.boardStage;
  /**
   * WHERE THE ROUND ON THIS BOARD IS ACTUALLY PLAYED.
   *
   * The line under the heading is `roundLabel · dates · venue`, so the venue
   * reads as a fact about the ROUND named beside it — and it was the event's
   * own course every time. Read off the seeded club on 2026-09-20:
   *
   *   Evening nine at Ardmore · 2026-09-17 · Braid Hollow — Championship Course
   *
   * Ardmore in the round's name and Braid Hollow as the venue, in one line, on
   * the board a club puts on a screen in the clubhouse. The same defect the
   * "Rounds & formats" screen had (#507) on the one surface where a stranger
   * cannot ask anybody.
   *
   * Only asked when the round names a course of its own, so a one-venue
   * tournament costs nothing and reads exactly as before. Scoped to courses
   * attached to THIS event, the same guard the scoring paths use: a `courseId`
   * is an id, and an id from somewhere else must not resolve.
   */
  const roundVenue = activeStage?.courseId
    ? await prisma.course.findFirst({
        where: { id: activeStage.courseId, events: { some: { eventId } } },
        select: { name: true, city: true },
      })
    : null;
  /**
   * THE ROUND, not only the format — the same reading the console board makes.
   * A team format on a Round Robin was landing on the team STROKE board here
   * too, so the share link a club sends its members threw away every match
   * result in the round. Both boards ask `boardKindForRound` now, so they
   * cannot answer this differently again.
   */
  const kind = boardKindForRound(activeStage?.format, activeStage?.type);
  const teamRound = kind === "team" && !!activeStage;
  const holeCount = holesPlayed(activeStage?.holes);
  /**
   * THE CARD THIS ROUND IS PLAYED ON — the round's own course, then the
   * event's, narrowed to the nine actually played and re-ranked.
   *
   * It resolved the EVENT's course and narrowed that, which is the venue line
   * above answered a second time and answered differently: the board named
   * Ardmore in its heading and scored Ardmore's nine against Braid Hollow's
   * front nine. Par 32 against par 36, so every side on the public board read
   * four better than it was, in the right order — see CLAUDE.md on an error
   * that shifts every row by the same amount.
   *
   * `strokeCourseFor` is the resolver the individual stroke board on this same
   * screen has always used, which is why the two halves of one board disagreed.
   */
  const liveCourse = state.strokeCourseFor(activeStage?.id ?? "");

  const teamRows = teamRound
    ? await teamStandings(
        eventId,
        activeStage!.id,
        activeStage!.format,
        liveCourse.pars,
        liveCourse.holeDifficulty,
        activeStage!.scoringBasis,
        activeStage!.handicapAllowance,
        activeStage!.allowanceWeights,
        activeStage!.countBest,
      )
    : [];

  /** A round robin of team matches, ranked on the matches. */
  const teamMatchRows =
    kind === "team-match" && activeStage
      ? await teamMatchBoard(
          eventId,
          activeStage.id,
          activeStage.format,
          activeStage.handicapAllowance,
          holeCount,
          activeStage.allowanceWeights,
        )
      : [];

  // The club's answer where they have given one, the standard otherwise.
  const pointsSystem: LeaguePointsSystem = isLeaguePointsSystem(state.event.leaguePoints)
    ? state.event.leaguePoints
    : "match";

  const skinsNet = activeStage ? activeStage.scoringBasis !== "gross" : true;
  const skins =
    kind === "skins" && activeStage
      ? await skinsBoard(eventId, activeStage.id, holeCount, skinsNet, liveCourse.holeDifficulty)
      : null;
  const nassau = kind === "nassau" && activeStage ? await nassauBoard(eventId, activeStage.id) : null;
  const modStableford =
    kind === "modified-stableford" && activeStage
      ? await modifiedStablefordBoard(
          eventId,
          activeStage.id,
          liveCourse.pars,
          liveCourse.holeDifficulty,
        )
      : null;

  /**
   * The board's rows, marked with who a weekly league says is not coming.
   *
   * `standingRows` is pure over `EventState` and stays that way — attendance
   * is a query, and pushing it in there would put a database read behind every
   * caller of a function the exporter, the dashboard and the reports all use.
   * Decorated here instead, on the one surface that needs it.
   *
   * The rows themselves are NOT filtered. "The leaderboard shows the whole
   * field, not just who has scored" is a rule with a test of its own, and a
   * member who opted out of Tuesday is still in the league — dropping their
   * row would be the board disagreeing with the season table beside it.
   */
  const rows = await withAttendance(eventId, state, activeStage?.id ?? "", standingRows(state));
  const brand = await brandForEvent(eventId);
  const theme = await themeForEvent(eventId);

  /**
   * How far the field has actually got — two readings, because the question
   * differs by round type. A round of returned cards is in when the cards are
   * in; a round of MATCHES is over when its matches are settled, and a match
   * won 5&4 returns fourteen holes and is finished. Counting holes there would
   * leave the board reading "Live" for a round that ended hours ago.
   */
  const roundMatches = activeStage ? state.matches.filter((m) => m.stageId === activeStage.id) : [];

  /**
   * AND THE COMMITTEE'S OWN WORD, which outranks both readings.
   *
   * A club that marks a tournament Completed has said the result is final —
   * the console shows "Completed", locks the configuration, and starts the
   * retention clock on it. The public board went on saying LIVE, because it
   * only ever asked whether every card was in, and a card can legitimately
   * stop short: a withdrawal, a match won 5&4, somebody who walked in at the
   * turn.
   *
   * So the one screen the club actually SENDS to members contradicted the
   * committee that sent it. Two readers of one fact, and the authoritative one
   * was not being asked.
   */
  const declaredFinal = event.status === "completed";
  /**
   * AND NOBODY IS STILL TO TEE OFF.
   *
   * The card reading was `started.every(...)` — every player who has BEGUN has
   * finished — and that is true of a morning tee time at one o'clock while the
   * afternoon groups are in the car park. Measured on 2026-09-10 on a charity
   * day: four complete cards, two players with none, and the board carrying a
   * grey FINAL chip directly above two rows it had itself rendered as "not
   * started". The screen contradicted itself, to the audience least able to
   * know otherwise.
   *
   * `thru === 0` is NOT the "short card" the paragraph above is about. A
   * withdrawal at the turn, a match won 5&4, somebody who walked in — those
   * return SOME holes, and they are why the rule cannot ask for a full card
   * from everybody. A player with nothing at all has either not begun or is
   * not coming, and the board cannot tell which. "Live" is the honest reading
   * of a board that has no result for somebody, and it is the safe one: a
   * finished day still labelled Live is stale, while a live day labelled Final
   * announces a winner over players who are on the 4th.
   *
   * The committee's word still outranks it, which is what resolves a no-show:
   * marking the tournament Completed is the act that says the result stands,
   * and it already locks configuration and starts the retention clock.
   */
  /**
   * AND SOMEBODY WHO IS NOT COMING IS NOT SOMEBODY STILL TO TEE OFF.
   *
   * The rule above is right and, on a weekly league, unsatisfiable. It asks
   * that every confirmed player has begun; six members who opted out of
   * Tuesday never will, so a league night's public board read LIVE for the
   * rest of the season. The committee's word could not resolve it either — a
   * league is not marked Completed until the season ends, months later.
   *
   * What changed is not the rule, it is what the app knows. "A player with
   * nothing at all has either not begun or is not coming, and the board cannot
   * tell which" was true when it was written and is not any more: a league
   * records the answer, and `absent` carries it onto the row.
   *
   * So the field this asks about is the players who are IN. Everything the
   * paragraph above protects still holds — a short card still counts, a player
   * who is in and has nothing still holds the board Live, and a tournament
   * (where `absent` is undefined on every row) is judged exactly as before.
   */
  const expected = rows.filter((r) => !r.absent);
  const expectedStarted = expected.filter((r) => r.thru > 0);
  const allIn =
    declaredFinal ||
    (roundMatches.length > 0
      ? roundMatches.every(roundMatchIsOver)
      : expected.length > 0 &&
        expectedStarted.length === expected.length &&
        expectedStarted.every((r) => r.thru >= holeCount));

  const knockoutAt = state.stages.findIndex((s) => isKnockoutRound(s.type));
  const draws = knockoutAt >= 0 ? drawnDraws(state.brackets) : [];

  return {
    name: event.name,
    dates: event.dates,
    teamFormat: activeStage?.format ?? "",
    venue: roundVenue
      ? [roundVenue.name, roundVenue.city].filter(Boolean).join(", ")
      : event.course
        ? [event.course, event.city].filter(Boolean).join(", ")
        : /* A tournament holding its home course as a venue only — see
             `soleVenueCourse`, which the card this board scores on already
             reads. Named here too, or the line printed no venue at all. */
          [soleVenueCourse(event)?.name, soleVenueCourse(event)?.city].filter(Boolean).join(", "),
    rows,
    teamRows,
    teamMatchRows,
    pointsSystem,
    skins,
    nassau,
    modStableford,
    skinsNet,
    kind,
    teamRound,
    isStroke: state.boardIsStroke,
    isStableford: isStablefordRound(activeStage?.scoringBasis, activeStage?.format),
    teamBasis: weekBasis(activeStage?.scoringBasis, activeStage?.format),
    holeCount,
    // Cached WITH the rows, deliberately: it describes this exact standing,
    // and a note cached apart from the board it explains would eventually be
    // describing a different one.
    cutNote: cutLineNote(state) ?? "",
    // The same expression `(player)/me/board` uses, so the two boards built
    // from one component cannot label the same column differently.
    unit: state.boardIsStroke ? state.strokeUnitLabel : "match points",
    manualFormat: kind === "manual",
    draws,
    bracketResults: draws.length > 0 ? await bracketResults(event.id) : {},
    straightKnockout: knockoutAt === 0 && !!activeStage && isKnockoutRound(activeStage.type),
    allIn,
    /* The organizer's own name for the round where they gave one, then the
       console heading's words (`roundNameFor`). This fell back to the TYPE
       alone, so a club's Scramble went out to its members as "Stroke Play
       Round · 18 Oct 2026". */
    roundLabel:
      activeStage?.description?.trim() ||
      (activeStage ? roundNameFor(state.playRounds, activeStage) : ""),
    brand,
    themeStyleSheet: themeCss(theme, "#player-theme"),
    colorScheme: playerColorScheme(theme),
  };
}

/**
 * The board, from cache when somebody has already asked for it.
 *
 * Keyed on the event, so two clubs playing at once never share an entry, and
 * tagged so a score write can retire it the moment the standings move —
 * `revalidateTag(boardTag(eventId))`.
 *
 * `revalidate` is a BACKSTOP, not the mechanism. Tag invalidation is what
 * makes a birdie appear; this is what bounds the damage if some future write
 * path forgets to fire the tag. Sixty seconds is chosen to be survivable
 * rather than ideal: a board that is a minute behind is a nuisance, and one
 * that is permanently wrong because somebody forgot a line is a product that
 * cannot be trusted.
 */
export function liveBoard(eventId: string): Promise<LiveBoardView | null> {
  return unstable_cache(() => gather(eventId), ["live-board", eventId], {
    tags: [boardTag(eventId)],
    revalidate: 60,
  })();
}
