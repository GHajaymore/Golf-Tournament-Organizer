import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "../db";
import { COURSE_REF, cardForStage } from "./course-resolution";
import { loadEventState, matchSettled, standingRows } from "./tournament";
import { boardKind } from "../formats";
import { teamStandings } from "./teams";
import { skinsBoard, nassauBoard, modifiedStablefordBoard } from "./points-standings";
import { resolveCourse } from "../courses";
import { brandForEvent, themeForEvent } from "./organization";
import { themeCss, playerColorScheme } from "../themes";

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
  skins: Awaited<ReturnType<typeof skinsBoard>> | null;
  nassau: Awaited<ReturnType<typeof nassauBoard>> | null;
  modStableford: Awaited<ReturnType<typeof modifiedStablefordBoard>> | null;
  skinsNet: boolean;
  kind: string;
  teamRound: boolean;
  isStroke: boolean;
  isStableford: boolean;
  holeCount: number;
  manualFormat: boolean;
  allIn: boolean;
  roundLabel: string;
  brand: Awaited<ReturnType<typeof brandForEvent>>;
  themeStyleSheet: string;
  colorScheme: string;
}

async function gather(eventId: string): Promise<LiveBoardView | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: COURSE_REF });
  if (!event) return null;

  const state = await loadEventState(eventId);
  if (!state) return null;

  const activeStage = state.activeStage ?? state.stages[0] ?? null;
  const kind = boardKind(activeStage?.format);
  const teamRound = kind === "team" && !!activeStage;
  const holeCount = activeStage?.holes === 9 ? 9 : 18;
  // Narrowed to the nine actually played and re-ranked, so the public board
  // allocates the same strokes the console does.
  const liveCourse = cardForStage(resolveCourse(event), activeStage);

  const teamRows = teamRound
    ? await teamStandings(
        eventId,
        activeStage!.id,
        activeStage!.format,
        liveCourse.pars,
        liveCourse.strokeIndex,
        activeStage!.scoringBasis,
        activeStage!.handicapAllowance,
        activeStage!.allowanceWeights,
        activeStage!.countBest,
      )
    : [];

  const skinsNet = activeStage ? activeStage.scoringBasis !== "gross" : true;
  const skins =
    kind === "skins" && activeStage
      ? await skinsBoard(eventId, activeStage.id, holeCount, skinsNet, liveCourse.strokeIndex)
      : null;
  const nassau = kind === "nassau" && activeStage ? await nassauBoard(eventId, activeStage.id) : null;
  const modStableford =
    kind === "modified-stableford" && activeStage
      ? await modifiedStablefordBoard(
          eventId,
          activeStage.id,
          liveCourse.pars,
          liveCourse.strokeIndex,
        )
      : null;

  const rows = standingRows(state);
  const brand = await brandForEvent(eventId);
  const theme = await themeForEvent(eventId);

  /**
   * How far the field has actually got — two readings, because the question
   * differs by round type. A round of returned cards is in when the cards are
   * in; a round of MATCHES is over when its matches are settled, and a match
   * won 5&4 returns fourteen holes and is finished. Counting holes there would
   * leave the board reading "Live" for a round that ended hours ago.
   */
  const started = rows.filter((r) => r.thru > 0);
  const roundMatches = activeStage ? state.matches.filter((m) => m.stageId === activeStage.id) : [];
  const allIn =
    roundMatches.length > 0
      ? roundMatches.every((m) => matchSettled(m))
      : started.length > 0 && started.every((r) => r.thru >= holeCount);

  return {
    name: event.name,
    dates: event.dates,
    teamFormat: activeStage?.format ?? "",
    venue: [event.course, event.city].filter(Boolean).join(", "),
    rows,
    teamRows,
    skins,
    nassau,
    modStableford,
    skinsNet,
    kind,
    teamRound,
    isStroke: state.isStroke,
    isStableford: activeStage?.scoringBasis === "stableford",
    holeCount,
    manualFormat: kind === "manual",
    allIn,
    roundLabel: activeStage?.description?.trim() || activeStage?.type || "",
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
