import "server-only";
import { isPlayingRound } from "../stage-types";
import { carryUnitsCompatible, standingsUnit, type StandingsUnit } from "../format-chain";
import { isManualFormat } from "../formats";
import { courseForRound, applyNine, cleanNine } from "./course-resolution";
import { survivors, currentRoundCutRule, type CutCandidate } from "../domain/cut";
import { cleanMatchTiebreakers, type MatchTiebreakKey } from "../domain/match-tiebreak";
import { prisma } from "../db";
import { effectiveAllowance } from "./teams";
import {
  holeStrokesReceived, stablefordPointsForHole, allocationHoles, playingHandicapFrom } from "../domain";
import { aggregateStroke, emptyAgg, netOf, type StrokeCard } from "../domain/stroke-agg";
import { resolveCourse } from "../courses";
import { todayIso } from "../deadline";
import { cleanIsoDate } from "../domain/round-dates";
import { pts as fmtPts, record as fmtRecord, diff as fmtDiff } from "../format";
import type { StandingRow } from "@/components/LeaderboardTable";
import {
  computeStandings,
  groupCutoff,
  qualificationBubble,
  buildBracket,
  drawBrackets,
  firstRoundLosers,
  isBracketMode,
  roundRobinMatchCount,
  resolveMatch,
  courseHandicapMap,
  type Player,
  type Match as DomainMatch,
  type ScoringRules,
  type RankedPlayer,
  type BracketView,
  type BracketMode,
  type TiebreakerKey,
} from "../domain";
import type { Event, Player as DbPlayer, Group as DbGroup, Stage as DbStage, Match as DbMatch } from "@prisma/client";
import { cleanSettings, allowsAutoConfirm, type TournamentSettings } from "../tournament-settings";

export type HoleResultArr = DomainMatch["holes"];

const AUTO_CONFIRM_MS = 24 * 60 * 60 * 1000;
export type ScoreStatus = "pending" | "confirmed" | "disputed" | "auto-confirmed";

/**
 * Effective confirmation status.
 *
 * `allowAutoConfirm` comes from the tournament's score-approval setting. When
 * an organizer signs off cards, a pending result stays pending however long it
 * sits — silently locking a score nobody reviewed is precisely what that
 * setting exists to prevent. Callers that genuinely have no settings to hand
 * default to false, so the safe reading is the one you get by forgetting.
 */
export function effectiveScoreStatus(
  m: { scoreStatus: string; scoredAt: Date | null },
  allowAutoConfirm = false,
): ScoreStatus {
  if (m.scoreStatus === "confirmed") return "confirmed";
  if (m.scoreStatus === "disputed") return "disputed";
  if (
    allowAutoConfirm &&
    m.scoreStatus === "pending" &&
    m.scoredAt &&
    Date.now() - new Date(m.scoredAt).getTime() > AUTO_CONFIRM_MS
  ) {
    return "auto-confirmed";
  }
  return "pending";
}

/** Read a tournament's settings off an Event row already in hand. */
export function settingsOf(event: Event): TournamentSettings {
  return cleanSettings(event);
}

export function scoringFrom(event: Event): ScoringRules {
  let tiebreakers: TiebreakerKey[];
  try {
    tiebreakers = JSON.parse(event.tiebreakers) as TiebreakerKey[];
  } catch {
    tiebreakers = ["head-to-head", "holes-won-ratio", "fewest-holes-lost", "lower-handicap"];
  }
  return {
    winPts: event.winPts,
    maxPerMatch: event.maxPerMatch,
    tiePts: event.tiePts,
    lossPts: event.lossPts,
    holeRatioPts: event.holeRatioPts,
    bonusPts: event.bonusPts,
    playPts: event.playPts,
    tiebreakers,
  };
}

/**
 * A player as the engines see them.
 *
 * `handicap` here is a **Course Handicap**, not the roster Index. Callers
 * inside loadEventState pass the resolved value; the default is the raw index
 * so the few call sites outside it keep working unrated.
 */
function toDomainPlayer(p: DbPlayer, courseHandicap?: number): Player {
  return {
    id: p.id,
    name: p.name,
    handicap: courseHandicap ?? p.handicap,
    seed: p.seed,
    groupId: p.groupId,
  };
}

/**
 * Whether anyone has written a score on this match yet.
 *
 * The same test `matchProgress` calls "complete", so "the round being played"
 * and "N/M matches complete" can never disagree about which round that is.
 */
export function hasAnyHole(holesJson: string): boolean {
  try {
    const holes = JSON.parse(holesJson) as HoleResultArr;
    return Array.isArray(holes) && holes.some((h) => h !== null);
  } catch {
    return false;
  }
}

/**
 * Whether a match has a result — by card OR by forfeit.
 *
 * A forfeited match has no holes at all, and every "is this round finished"
 * test in the app was reading holes. So a conceded match looked permanently
 * unplayed: `currentRoundIndex` pinned the tournament on that round FOREVER,
 * a fully played round after it became invisible on every screen, and round
 * progress stopped one short of the total.
 *
 * That is the same "live forever" failure the forfeit feature was built to
 * remove, arriving through the feature itself. A result is a result however it
 * was arrived at, which is what this function exists to say.
 */
export function matchSettled(m: { holes: string; forfeitedBy?: string | null }): boolean {
  return !!m.forfeitedBy || hasAnyHole(m.holes);
}

/**
 * Which round is being played now, as an index into the Round Robin stages.
 *
 * The EARLIEST generated round that still holds a match nobody has written a
 * score on. -1 when no round has been generated at all.
 *
 * "The latest round that has matches" looked equivalent and isn't. Every round
 * robin without a cut line is scheduled up front, in one pass, so a two-round
 * series has both rounds full of empty matches from the moment it is created —
 * and the latest of those is Round 2. Score entry opened on Round 2, the
 * dashboard called it the current round, the tee sheet said "no scores posted
 * yet", and the leaderboard and the printed standings showed its numbers: a
 * table of zeroes, with a fully played Round 1 one dropdown away. An organizer
 * reads that as scoring being broken, and from where they stand it is.
 *
 * Once every generated round is finished this lands on the last of them, so a
 * completed tournament still shows its final standings.
 */
/**
 * Which round a tournament with no Round Robin stages is on, read off the
 * calendar.
 *
 * The rule above needs matches to reason about, and a stroke-play league has
 * none — so the fallback was simply "the last playing round", which is right
 * for the one-round tournament this app started as and wrong for every league
 * since. A twelve-week league in week two opened every screen on week twelve:
 * an empty tee sheet, an empty card, and standings drawn from a round nobody
 * had played.
 *
 * The answer is the round most recently PLAYED, not the one coming next. The
 * day after a league night the organizer is entering scores and a player is
 * finishing a card, and both of those belong to the round just played; sending
 * them forward a week would put an unreturned card out of reach. Looking
 * forward is what the tee sheet and the availability card are for — and note
 * the player's "next round" there is deliberately a different question from
 * this one.
 *
 * Returns -1 when no round carries a date, which keeps every undated
 * tournament on exactly the behaviour it has always had.
 */
export function currentDatedRoundIndex(
  playRounds: Array<{ playedOn: string }>,
  now: Date = new Date(),
): number {
  const today = todayIso(now);
  let lastPlayed = -1;
  let firstDated = -1;
  for (let i = 0; i < playRounds.length; i += 1) {
    const day = cleanIsoDate(playRounds[i].playedOn);
    if (!day) continue;
    if (firstDated < 0) firstDated = i;
    // Today counts as played: a round is "current" from the moment it starts,
    // not from the day after.
    if (day <= today) lastPlayed = i;
  }
  // Before the season opens there is nothing played, and the round everyone is
  // preparing for is the first — never the last.
  return lastPlayed >= 0 ? lastPlayed : firstDated;
}

export function currentRoundIndex(
  rrStages: Array<{ id: string }>,
  matches: Array<{ stageId: string; holes: string; forfeitedBy?: string | null }>,
): number {
  let lastGenerated = -1;
  for (let i = 0; i < rrStages.length; i += 1) {
    const own = matches.filter((m) => m.stageId === rrStages[i].id);
    if (own.length === 0) continue;
    lastGenerated = i;
    // A forfeited match counts as decided — see matchSettled. Reading holes
    // alone pinned the tournament on the round a concession was recorded in.
    if (own.some((m) => !matchSettled(m))) return i;
  }
  return lastGenerated;
}

function toDomainMatch(m: DbMatch): DomainMatch {
  let holes: HoleResultArr;
  try {
    holes = JSON.parse(m.holes) as HoleResultArr;
  } catch {
    holes = [];
  }
  return {
    id: m.id,
    stageId: m.stageId,
    groupId: m.groupId,
    round: m.round,
    playerAId: m.playerAId,
    playerBId: m.playerBId,
    holes,
    // Carried through so the standings can decide a conceded or walked-over
    // match by the forfeit rather than by whatever holes were on the card.
    forfeitedBy: m.forfeitedBy ?? "",
  };
}

export interface GroupStanding {
  group: DbGroup;
  ranked: RankedPlayer[];
  cutoff: number | null;
}

export interface StrokeStanding {
  player: DbPlayer;
  gross: number;
  net: number;
  toPar: number;
  points: number;
  thru: number;
  rank: number;
}

export interface EventState {
  event: Event;
  scoring: ScoringRules;
  accounts: Awaited<ReturnType<typeof prisma.account.findMany>>;
  players: DbPlayer[];
  confirmed: DbPlayer[];
  waitlist: DbPlayer[];
  groups: DbGroup[];
  stages: DbStage[];
  matches: DbMatch[];
  /** Every Round Robin stage, in play order — a tournament can sequence more than one. */
  rrStages: DbStage[];
  /** Every round the field plays, including medal rounds that have no pairings. */
  playRounds: DbStage[];
  /** The current/most recent Round Robin round — what score entry and "current round" default to. */
  activeStage: DbStage | null;
  /** Matches for the active Round Robin stage only. */
  rrMatches: DbMatch[];
  domainPlayers: Player[];
  domainMatches: DomainMatch[];
  /** Final standings after the full Round Robin sequence, chaining carried points stage to stage. */
  overall: RankedPlayer[];
  groupStandings: GroupStanding[];
  isStroke: boolean;
  strokeStandings: StrokeStanding[];
  /**
   * What `strokeStandings` measures, and which rounds went into it.
   *
   * The board used to total every card in the event and label the column with
   * whatever the active round happened to measure — so a hand-scored round, a
   * gross round and a Stableford round could all be summed and presented as
   * one number. These say what is actually being shown, so a screen can name
   * it rather than assume.
   */
  strokeUnit: StandingsUnit;
  strokeRounds: DbStage[];
  /**
   * Playing handicap for a player on a given round, allowance and hole count
   * already applied. Exposed so the weekly league view prices a card through
   * the identical function these totals used, rather than rebuilding the tee
   * maps and drifting.
   */
  strokeHandicapFor: (playerId: string, stageId: string) => number;
  advancingCount: number;
  advancingIds: Set<string>;
  pendingConfirmations: number;
  overallCutoff: number | null;
  brackets: { winners: BracketView; consolation: BracketView };
  qualifiers: Player[];
}

/** Every stage of type "Round Robin", in play order. */
/** Stored JSON to a clean sequence; anything unparseable means "leave it halved". */
export function parseMatchTiebreakers(raw: string | null | undefined): MatchTiebreakKey[] {
  if (!raw) return [];
  try {
    return cleanMatchTiebreakers(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function roundRobinStages(stages: DbStage[]): DbStage[] {
  return stages.filter((s) => s.type === "Round Robin");
}

/**
 * Every round the field actually plays, in play order.
 *
 * Distinct from roundRobinStages, which is specifically the match-points
 * chain. A medal round is played and scored but produces no match points, so
 * it belongs here and not there — score entry and the hole count follow this
 * list, while the chained standings follow the other one.
 */
export function playingStages(stages: DbStage[]): DbStage[] {
  return stages.filter((s) => isPlayingRound(s.type));
}

/**
 * Chain standings through a sequence of Round Robin stages: each stage scores
 * only its own matches, carrying the previous stage's totalPoints forward
 * (scaled by that stage's carry %) when carryForwardEnabled. Returns one
 * ranking per stage, in order — the same math loadEventState uses for the
 * tournament's final standings, reused here so a cut line entering a later
 * stage reads the identical ranking the leaderboard shows.
 */
export function chainRoundStandings(
  rrStages: DbStage[],
  matches: DbMatch[],
  domainPlayers: Player[],
  scoring: ScoringRules,
  /** Stroke index per hole (1 = hardest), for the "toughest N holes" tiebreakers. */
  holeDifficulty?: number[],
  /** How an all-square match is decided, in order. */
  matchTiebreakers: MatchTiebreakKey[] = [],
): RankedPlayer[][] {
  let carried: Record<string, number> = {};
  const perStage: RankedPlayer[][] = [];
  for (let i = 0; i < rrStages.length; i += 1) {
    const stage = rrStages[i];
    const stageMatches = matches.filter((m) => m.stageId === stage.id).map(toDomainMatch);
    const carryIn = i > 0 && stage.carryForwardEnabled ? carried : {};
    const overall = computeStandings(domainPlayers, stageMatches, scoring, carryIn, holeDifficulty, matchTiebreakers);
    perStage.push(overall);
    const next = rrStages[i + 1];
    // Points carry only between rounds counted in the same unit. Across a
    // format boundary the survivors still advance (the cut is taken elsewhere),
    // but their match points are not scaled into a stroke round's totals — that
    // would be a meaningless number, and chainIssues surfaces the warning.
    carried =
      next?.carryForwardEnabled && carryUnitsCompatible(stage, next)
        ? Object.fromEntries(overall.map((rp) => [rp.player.id, rp.stats.totalPoints * (next.carryForwardPct / 100)]))
        : {};
  }
  return perStage;
}

/** Cards come out of the database with strokes as a JSON string; unparseable
 *  ones are dropped rather than guessed at. */
export function parseStrokeCards(
  rows: Array<{ playerId: string; stageId: string; strokes: string }>,
): StrokeCard[] {
  const out: StrokeCard[] = [];
  for (const r of rows) {
    try {
      out.push({ playerId: r.playerId, stageId: r.stageId, strokes: JSON.parse(r.strokes) });
    } catch {
      // A corrupt card is skipped, not treated as a round of zeros.
    }
  }
  return out;
}

/**
 * Price a card the way its own round says it should be priced.
 *
 * The round's setup decides whether it is nine holes or eighteen and what
 * allowance applies — not whichever round happened to come first in the
 * tournament. Exported so the weekly league view resolves handicaps through
 * exactly this function rather than a second copy of the rule.
 */
export function strokeHandicapResolver(ctx: {
  stageById: Map<string, DbStage>;
  courseHcp9: Map<string, number>;
  courseHcp18: Map<string, number>;
  fallback: Map<string, number>;
}): (playerId: string, stageId: string) => number {
  return (playerId, stageId) => {
    const stage = ctx.stageById.get(stageId);
    const allowance = stage ? effectiveAllowance(stage.format, stage.handicapAllowance) : 100;
    const byRound = stage?.holes === 9 ? ctx.courseHcp9 : ctx.courseHcp18;
    return playingHandicapFrom(byRound.get(playerId) ?? ctx.fallback.get(playerId) ?? 0, allowance);
  };
}

export async function loadEventState(eventId: string): Promise<EventState | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return null;

  const [accounts, players, groups, stages, matches, bracketWinners, scorecards, venues, tees] = await Promise.all([
    prisma.account.findMany({ where: { eventId }, orderBy: { name: "asc" } }),
    prisma.player.findMany({ where: { eventId }, orderBy: { seed: "asc" } }),
    prisma.group.findMany({ where: { eventId }, orderBy: { position: "asc" } }),
    prisma.stage.findMany({ where: { eventId }, orderBy: { position: "asc" } }),
    /**
     * Ordered, and it has to be.
     *
     * This had no orderBy at all, so Postgres returned heap order — and an
     * UPDATE rewrites a row to the end of it. Every score entered, and every
     * card approved, physically moved that match and reshuffled the draw
     * underneath the organizer: approve one and it jumps to the top of the
     * picker, which is how this was noticed. The same defect as the standings
     * comparator, in a different disguise — a list whose order depended on
     * something that was never meant to carry meaning.
     *
     * Round then flight is how the draw reads on paper; id last so two
     * matches in the same flight and round can never swap places between two
     * loads of the same page.
     */
    prisma.match.findMany({
      where: { eventId },
      orderBy: [{ round: "asc" }, { groupId: "asc" }, { id: "asc" }],
    }),
    prisma.bracketWinner.findMany({ where: { eventId } }),
    prisma.scorecard.findMany({ where: { eventId } }),
    // The tournament's venues, so a round played at another club is scored
    // against that club's card rather than the first round's.
    prisma.course.findMany({ where: { events: { some: { eventId } } } }),
    // Tees carry the Course Rating and Slope that turn a Handicap Index into
    // the strokes a player actually receives here.
    prisma.tee.findMany({ where: { course: { events: { some: { eventId } } } }, orderBy: [{ position: "asc" }] }),
  ]);

  const scoring = scoringFrom(event);
  // Resolved once. Applied at read time rather than stored on the match, so
  // changing the rule re-decides every affected match instead of leaving old
  // results frozen under whatever was in force when the card was entered.
  const matchTiebreakers = parseMatchTiebreakers(event.matchTiebreakers);
  const confirmed = players.filter((p) => p.status === "confirmed");
  const venuesById = new Map(venues.map((c) => [c.id, c]));

  // Every handicap below this line is a Course Handicap, not an Index.
  // Resolved once, here, because converting at each consuming site means one
  // missed site silently reinstates the original bug with no visible symptom.
  // With no rated tees the map is the raw indexes, which is exactly how the
  // app behaved before ratings existed.
  const activeHoles = playingStages(stages)[0]?.holes === 9 ? 9 : 18;
  const teeRatings = new Map(
    tees.map((t) => [t.id, { courseRating: t.courseRating, slopeRating: t.slopeRating, par: t.par }]),
  );
  const defaultTeeId = tees[0]?.id ?? null;
  // Both conversions, so every consumer takes the one its own round calls
  // for. One map keyed to the first round's hole count meant a tournament
  // mixing an 18-hole round with a 9-hole one converted every handicap on
  // the first round's setting, whichever card it was scoring.
  const courseHcp18 = courseHandicapMap(confirmed, teeRatings, defaultTeeId, 18);
  const courseHcp9 = courseHandicapMap(confirmed, teeRatings, defaultTeeId, 9);
  const courseHcp = activeHoles === 9 ? courseHcp9 : courseHcp18;
  const hcpOf = (p: { id: string; handicap: number }) => courseHcp.get(p.id) ?? p.handicap;
  const waitlist = players.filter((p) => p.status === "waitlisted");

  // Standings chain through every Round Robin stage in order: each stage scores
  // its own matches, and — when the next stage has "carry forward" enabled —
  // feeds its totalPoints (scaled by that stage's carry %) in as the next
  // stage's starting points. The final stage's numbers are the tournament's
  // standings; a single Round Robin stage behaves exactly as before.
  const rrStages = roundRobinStages(stages);
  const domainPlayers = confirmed.map((p) => toDomainPlayer(p, hcpOf(p)));
  const course = resolveCourse(event);
  const holeDifficulty = course.strokeIndex;

  const playRounds = playingStages(stages);
  const activeRrIdx = currentRoundIndex(rrStages, matches);
  // A dated stroke-play league is read off the calendar; an undated one keeps
  // the old "last round" answer, which is correct for a single-round event and
  // is all there is to go on without dates.
  const datedIdx = currentDatedRoundIndex(playRounds);
  const activeStage =
    rrStages[activeRrIdx] ??
    rrStages[rrStages.length - 1] ??
    (datedIdx >= 0 ? playRounds[datedIdx] : playRounds[playRounds.length - 1]) ??
    null;
  // The chain runs up to the round being played, not past it. Running it to
  // the end left `overall` holding the last round's standings, which is why a
  // played Round 1 showed as zeroes while Round 2 was nominally current.
  const chainTo = activeRrIdx >= 0 ? activeRrIdx : rrStages.length - 1;

  let carried: Record<string, number> = {};
  let overall: RankedPlayer[] = computeStandings(domainPlayers, [], scoring);
  let groupStandings: GroupStanding[] = groups.map((g) => {
    const gp = confirmed.filter((p) => p.groupId === g.id).map((p) => toDomainPlayer(p, hcpOf(p)));
    const ranked = computeStandings(gp, [], scoring);
    return { group: g, ranked, cutoff: groupCutoff(ranked, event.qualifyPerGroup) };
  });
  let activeDomainMatches: DomainMatch[] = [];

  for (let i = 0; i <= chainTo; i += 1) {
    const stage = rrStages[i];
    const stageMatches = matches.filter((m) => m.stageId === stage.id).map(toDomainMatch);
    const carryIn = i > 0 && stage.carryForwardEnabled ? carried : {};

    overall = computeStandings(domainPlayers, stageMatches, scoring, carryIn, holeDifficulty, matchTiebreakers);
    groupStandings = groups.map((g) => {
      const gp = confirmed.filter((p) => p.groupId === g.id).map((p) => toDomainPlayer(p, hcpOf(p)));
      const ranked = computeStandings(gp, stageMatches, scoring, carryIn, holeDifficulty, matchTiebreakers);
      return { group: g, ranked, cutoff: groupCutoff(ranked, event.qualifyPerGroup) };
    });
    activeDomainMatches = stageMatches;

    const next = rrStages[i + 1];
    // Same rule as chainRoundStandings: carry points only when the two rounds
    // measure the same thing. Incompatible formats reset to zero here, the cut
    // having already carried the advancement.
    carried =
      next?.carryForwardEnabled && carryUnitsCompatible(stage, next)
        ? Object.fromEntries(overall.map((rp) => [rp.player.id, rp.stats.totalPoints * (next.carryForwardPct / 100)]))
        : {};
  }

  const rrMatches = activeStage ? matches.filter((m) => m.stageId === activeStage.id) : [];
  const domainMatches = activeDomainMatches;

  // Stroke-play standings (from submitted scorecards), used when the event format is stroke.
  // Par and stroke index are now resolved per round by `courseFor` below —
  // the event's card is only the fallback for a round that names no venue.
  const isStroke = event.format === "stroke";
  const stageById = new Map(stages.map((s) => [s.id, s]));

  /**
   * Playing Handicap, not Course Handicap: the format's allowance — 95% for an
   * individual medal or Stableford under WHS Appendix C, or whatever the
   * committee set on the round — applied to the strokes this card receives.
   *
   * Shared with the weekly view via strokeHandicapResolver so a league night
   * and the event totals can never price the same card differently.
   */
  const handicapFor = strokeHandicapResolver({
    stageById,
    courseHcp9,
    courseHcp18,
    fallback: courseHcp,
  });

  /**
   * The course each round is played on, walking round → event.
   *
   * `Stage.courseId` has existed as long as the venue library and nothing in
   * production ever read it — `courseForRound` had zero callers — so every
   * round of a two-course tournament was scored against round one's par and
   * stroke index. Resolved once per round rather than per card.
   */
  const roundCards = new Map<string, { pars: number[]; holeDifficulty: number[] }>();
  const courseFor = (stageId: string) => {
    const cached = roundCards.get(stageId);
    if (cached) return cached;
    const stage = stageById.get(stageId);
    const roundCourse = stage?.courseId ? venuesById.get(stage.courseId) ?? null : null;
    const resolved = courseForRound(roundCourse, event) ?? course;
    // Narrowed to the nine actually played, the same way the match path does
    // it: nine holes of an eighteen-hole card carry stroke indexes scattered
    // through 1..18, and allocating off those gives the wrong holes.
    const holes = stage?.holes === 9 ? 9 : 18;
    const applied = applyNine(resolved, cleanNine(stage?.nine), holes);
    const value = { pars: applied.pars, holeDifficulty: applied.strokeIndex };
    roundCards.set(stageId, value);
    return value;
  };

  /**
   * Which rounds this board may add together.
   *
   * Every card in the event used to be summed into one column and labelled
   * with whatever the ACTIVE round happened to measure. Three different
   * tournaments were wrong in three ways at once: a hand-scored round was
   * ranked the moment it shared an event with a scored one; a gross round was
   * ranked by net; and two rounds measuring different things were added
   * together and presented as a total.
   *
   * The rule is the one the match-play carry already uses — rounds add up when
   * they measure the same unit — plus the one the weekly view already applies:
   * a hand-scored round has cards and adding them up produces a ranking the
   * club never played for.
   */
  const strokeUnitStage = activeStage ?? playRounds[playRounds.length - 1] ?? null;
  const strokeRounds = playRounds.filter(
    (s) =>
      !isManualFormat(s.format) &&
      (!strokeUnitStage || carryUnitsCompatible(s, strokeUnitStage)),
  );
  const strokeRoundIds = new Set(strokeRounds.map((s) => s.id));
  const strokeUnit = strokeUnitStage
    ? standingsUnit(strokeUnitStage.format, strokeUnitStage.scoringBasis)
    : "strokes";

  const strokeAgg = aggregateStroke(
    parseStrokeCards(scorecards.filter((c) => strokeRoundIds.has(c.stageId))),
    {
      courseFor,
      handicapFor,
      holeStrokesReceived,
      stablefordPointsForHole,
      allocationHoles,
    },
  );
  // Stableford ranks by points descending (higher is better). Everything else
  // ranks by strokes ascending — GROSS strokes for a gross round, which is the
  // whole of that round's point: a scratch competition ranked by net is a
  // different competition, and the board was silently running it.
  const stableford = strokeUnit === "Stableford points" || strokeUnit === "modified Stableford points";
  const grossBasis = strokeUnitStage?.scoringBasis === "gross";
  const strokeStandings: StrokeStanding[] = confirmed
    .map((p) => {
      const a = strokeAgg.get(p.id) ?? emptyAgg();
      return { player: p, gross: a.gross, net: netOf(a), toPar: a.gross - a.parThru, points: a.points, thru: a.thru, rank: 0 };
    })
    .sort((x, y) => {
      const started = (y.thru > 0 ? 1 : 0) - (x.thru > 0 ? 1 : 0);
      if (started !== 0) return started;
      if (stableford) return y.points - x.points;
      return grossBasis ? x.gross - y.gross || x.net - y.net : x.net - y.net || x.gross - y.gross;
    })
    .map((s, i) => ({ ...s, rank: i + 1 }));

  // Qualification: format-aware — top N by net (stroke) or points (match), per flight or overall.
  let qualifierIds: Set<string>;
  if (isStroke) {
    const scored = strokeStandings.filter((s) => s.thru > 0);
    if (event.qualifyMode === "overall") {
      qualifierIds = new Set(scored.slice(0, event.qualifyOverall).map((s) => s.player.id));
    } else {
      qualifierIds = new Set<string>();
      for (const g of groups) {
        scored
          .filter((s) => s.player.groupId === g.id)
          .slice(0, event.qualifyPerGroup)
          .forEach((s) => qualifierIds.add(s.player.id));
      }
    }
  } else {
    qualifierIds =
      event.qualifyMode === "overall"
        ? new Set(overall.slice(0, event.qualifyOverall).map((rp) => rp.player.id))
        : new Set(
            groupStandings.flatMap((gs) =>
              gs.ranked.slice(0, event.qualifyPerGroup).map((rp) => rp.player.id),
            ),
          );
  }

  // Which players the standings highlight as advancing — the lit rows on the
  // dashboard flight standings and on the live leaderboard everyone watches.
  //
  // A knockout advances into a bracket, so its qualifiers are the event-level
  // qualification set (qualifyPerGroup / qualifyOverall) that seeds it. A
  // tournament that cuts round to round has no such stage: who advances is the
  // survivors of the ACTIVE round's own cut, so the lit rows match the number
  // set in Round setup rather than the qualifyPerGroup default (2/flight = 8
  // across four flights, which highlighted the wrong players on every board).
  // With neither a knockout nor a round cut, nobody is advancing yet.
  const hasKnockout = stages.some(
    (s) => s.type === "Bracket Stage" || s.type === "Qualification Stage",
  );
  let advancingIds: Set<string>;
  if (hasKnockout) {
    advancingIds = qualifierIds;
  } else {
    const activePlayIdx = activeStage ? playRounds.findIndex((s) => s.id === activeStage.id) : -1;
    const cutRule = currentRoundCutRule(playRounds, activePlayIdx);
    if (!cutRule) {
      advancingIds = new Set<string>();
    } else {
      // Ranked in finishing order, which survivors() takes the front of — per
      // flight or overall as the cut's scope dictates. Stroke ranks by returned
      // cards (only those who've posted), match by the chained standings.
      //
      // Restricted to the players who actually CONTESTED the round being cut
      // out of, which is the same rule generateCutRound applies. Without it the
      // board answered a different question from the engine and the two
      // disagreed on screen: a percent cut sized itself against the whole
      // original field (28 rather than the 24 still in, lighting 19 rows where
      // the engine would schedule 16), and players eliminated a round earlier
      // sat at zero points with a zero hole differential — which ranks ABOVE a
      // survivor who played and lost — so the board highlighted them as
      // advancing while the player actually in the next round was not lit.
      //
      // Filtered rather than re-ranked on purpose. `overall` is already in
      // finishing order, and re-sorting a different population through an
      // intransitive comparator (head-to-head decides nothing between players
      // who never met) can reorder players relative to each other.
      const contestedIds = new Set(
        rrMatches.flatMap((m) => [m.playerAId, m.playerBId]).filter(Boolean),
      );
      const stillIn = contestedIds.size
        ? overall.filter((rp) => contestedIds.has(rp.player.id))
        : overall;
      const ranked: CutCandidate[] = isStroke
        ? strokeStandings.filter((s) => s.thru > 0).map((s) => ({ id: s.player.id, groupId: s.player.groupId }))
        : stillIn.map((rp) => ({ id: rp.player.id, groupId: rp.player.groupId }));
      advancingIds = survivors(ranked, cutRule);
    }
  }
  const advancingCount = advancingIds.size;

  // Completed matches still awaiting sign-off. Under staff approval nothing
  // auto-confirms, so this is the organizer's review queue.
  const autoConfirm = allowsAutoConfirm(settingsOf(event));
  const pendingConfirmations = rrMatches.filter((m) => {
    let holes: HoleResultArr;
    try {
      holes = JSON.parse(m.holes) as HoleResultArr;
    } catch {
      return false;
    }
    return resolveMatch(holes).complete && effectiveScoreStatus(m, autoConfirm) === "pending";
  }).length;
  const qualifiers = isStroke
    ? strokeStandings.filter((s) => qualifierIds.has(s.player.id)).map((s) => toDomainPlayer(s.player, hcpOf(s.player)))
    : overall.filter((rp) => qualifierIds.has(rp.player.id)).map((rp) => rp.player);

  const advTotals = overall
    .filter((rp) => qualifierIds.has(rp.player.id))
    .map((rp) => rp.stats.totalPoints);
  const overallCutoff = advTotals.length ? Math.min(...advTotals) : null;
  const winnersMap: Record<string, string> = {};
  for (const bw of bracketWinners) winnersMap[bw.key] = bw.winnerId;

  // How the knockout is arranged is the organizer's decision. A plate is built
  // in two passes because its second bracket is filled by results rather than
  // by seeding: the main bracket has to exist before anyone has lost in it.
  const mode: BracketMode = isBracketMode(event.bracketMode) ? event.bracketMode : "split";
  const firstDraw = drawBrackets(qualifiers, mode);
  const mainBracket = buildBracket("winners", firstDraw.main, winnersMap);
  const secondField =
    mode === "plate"
      ? firstRoundLosers(mainBracket, new Map(qualifiers.map((p) => [p.id, p])))
      : firstDraw.second;
  const brackets = {
    winners: mainBracket,
    consolation: buildBracket("consolation", secondField, winnersMap),
  };

  return {
    event,
    scoring,
    accounts,
    players,
    confirmed,
    waitlist,
    groups,
    stages,
    matches,
    rrStages,
    playRounds,
    activeStage,
    rrMatches,
    domainPlayers,
    domainMatches,
    overall,
    groupStandings,
    isStroke,
    strokeStandings,
    strokeUnit,
    strokeRounds,
    strokeHandicapFor: handicapFor,
    advancingCount,
    advancingIds,
    pendingConfirmations,
    overallCutoff,
    brackets,
    qualifiers,
  };
}

/** Dashboard stat helpers. */
export function matchProgress(state: EventState): { done: number; total: number; pct: number } {
  const done = state.rrMatches.filter((m) => matchSettled(m)).length;
  const total = state.rrMatches.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, pct };
}

/** Build format-aware standings rows for the leaderboard/dashboard tables. */
export function standingRows(state: EventState): StandingRow[] {
  const flightByPlayer = new Map(
    state.groups.flatMap((g, i) =>
      state.confirmed.filter((p) => p.groupId === g.id).map((p) => [p.id, `Flight ${i + 1}`] as const),
    ),
  );
  const flight = (id: string) => flightByPlayer.get(id) ?? "—";

  if (state.isStroke) {
    return state.strokeStandings.map((s) => ({
      id: s.player.id,
      rank: s.rank,
      name: s.player.name,
      flight: flight(s.player.id),
      advancing: state.advancingIds.has(s.player.id),
      record: "",
      diff: "",
      pts: "",
      played: 0,
      wins: 0,
      ties: 0,
      losses: 0,
      gross: s.gross,
      net: s.net,
      toPar: s.toPar,
      points: s.points,
      thru: s.thru,
    }));
  }
  return state.overall.map((r) => ({
    id: r.player.id,
    rank: r.rank,
    name: r.player.name,
    flight: flight(r.player.id),
    advancing: state.advancingIds.has(r.player.id),
    record: fmtRecord(r.stats),
    diff: fmtDiff(r.stats),
    pts: fmtPts(r.stats.totalPoints),
    played: r.stats.played,
    wins: r.stats.wins,
    ties: r.stats.ties,
    losses: r.stats.losses,
    gross: 0,
    net: 0,
    toPar: 0,
    points: 0,
    thru: 0,
  }));
}

export interface Highlight {
  icon: string;
  title: string;
  text: string;
}

/** Data-driven "Tournament Highlights" for the live leaderboard. */
export function computeHighlights(state: EventState): Highlight[] {
  const out: Highlight[] = [];
  const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

  if (state.isStroke) {
    const scored = state.strokeStandings.filter((s) => s.thru > 0);
    if (!scored.length) return out;
    const stableford = state.activeStage?.scoringBasis === "stableford";
    const lead = scored[0];
    if (stableford) {
      out.push({ icon: "🏆", title: "Leader", text: `${lead.player.name} leads on ${lead.points} Stableford pts.` });
    } else {
      const par = lead.toPar === 0 ? "level par" : lead.toPar > 0 ? `+${lead.toPar}` : `${lead.toPar}`;
      out.push({ icon: "🏆", title: "Leader", text: `${lead.player.name} leads at ${par} (net ${lead.net}).` });
    }
    const advancing = scored.filter((s) => state.advancingIds.has(s.player.id));
    const lastIn = advancing[advancing.length - 1];
    if (lastIn) {
      out.push({
        icon: "🎯",
        title: "Qualification watch",
        text: stableford
          ? `${lastIn.player.name} holds the final qualifying spot at ${lastIn.points} pts.`
          : `${lastIn.player.name} holds the final qualifying spot at net ${lastIn.net}.`,
      });
    }
    // Measured against the line that applies: each flight's own bubble under a
    // per-flight cut, the whole field under an overall one. Comparing a flight
    // qualifier against the overall list reported them "outside" by a negative
    // number of shots even while they were safe in their flight. Stableford
    // ranks by points (higher better); every other basis by net (lower better).
    const bubble = qualificationBubble(
      scored.map((s) => ({
        id: s.player.id,
        score: stableford ? s.points : s.net,
        groupId: s.player.groupId,
        advancing: state.advancingIds.has(s.player.id),
      })),
      state.event.qualifyMode === "overall" ? "overall" : "perFlight",
      stableford,
    );
    if (bubble) {
      const outName = scored.find((s) => s.player.id === bubble.firstOut.id)!.player.name;
      out.push({
        icon: "🚨",
        title: "Bubble watch",
        text: stableford
          ? `${outName} is ${bubble.gap} points outside qualification.`
          : `${outName} is ${bubble.gap} shots outside qualification.`,
      });
    }
    return out;
  }

  const leader = state.overall[0];
  if (leader && leader.stats.played > 0) {
    out.push({ icon: "🏆", title: "Leader", text: `${leader.player.name} leads on ${fmt(leader.stats.totalPoints)} pts.` });
  }

  // Longest current win streak across the field.
  let best = { name: "", n: 0 };
  for (const rp of state.overall) {
    const ms = state.domainMatches
      .filter((m) => m.playerAId === rp.player.id || m.playerBId === rp.player.id)
      .sort((a, b) => a.round - b.round);
    let streak = 0;
    for (const m of ms) {
      const r = resolveMatch(m.holes);
      if (!r.complete) continue;
      const isA = m.playerAId === rp.player.id;
      const won = (r.winner === "A" && isA) || (r.winner === "B" && !isA);
      streak = won ? streak + 1 : 0;
    }
    if (streak > best.n) best = { name: rp.player.name, n: streak };
  }
  if (best.n >= 2) {
    out.push({ icon: "🔥", title: "Hot streak", text: `${best.name} has won ${best.n} matches in a row.` });
  }

  // Qualification bubble.
  const advancing = state.overall.filter((rp) => state.advancingIds.has(rp.player.id));
  const lastIn = advancing[advancing.length - 1];
  if (lastIn) {
    out.push({ icon: "🎯", title: "Qualification watch", text: `${lastIn.player.name} holds the final qualifying spot on ${fmt(lastIn.stats.totalPoints)} pts.` });
  }
  // Against the applicable line: the player's own flight under a per-flight
  // cut, the whole field under an overall one. The overall comparison put a
  // safe flight qualifier "behind" a stronger player in a deeper flight and
  // reported a negative points gap — telling someone who was through that they
  // were outside.
  const bubble = qualificationBubble(
    state.overall.map((rp) => ({
      id: rp.player.id,
      score: rp.stats.totalPoints,
      groupId: rp.player.groupId,
      advancing: state.advancingIds.has(rp.player.id),
    })),
    state.event.qualifyMode === "overall" ? "overall" : "perFlight",
    true,
  );
  if (bubble) {
    const outName = state.overall.find((rp) => rp.player.id === bubble.firstOut.id)!.player.name;
    out.push({ icon: "🚨", title: "Bubble watch", text: `${outName} is ${fmt(bubble.gap)} pts outside qualification.` });
  }

  return out;
}

export function expectedRrTotal(state: EventState): number {
  return state.groups.reduce((acc, g) => {
    const n = state.confirmed.filter((p) => p.groupId === g.id).length;
    return acc + roundRobinMatchCount(n);
  }, 0);
}
