import "server-only";
import { isPlayingRound } from "../stage-types";
import { cleanMatchTiebreakers, type MatchTiebreakKey } from "../domain/match-tiebreak";
import { prisma } from "../db";
import { effectiveAllowance } from "./teams";
import {
  holeStrokesReceived, stablefordPointsForHole, allocationHoles, playingHandicapFrom } from "../domain";
import { resolveCourse } from "../courses";
import { pts as fmtPts, record as fmtRecord, diff as fmtDiff } from "../format";
import type { StandingRow } from "@/components/LeaderboardTable";
import {
  computeStandings,
  groupCutoff,
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
    tiePts: event.tiePts,
    lossPts: event.lossPts,
    holeRatioPts: event.holeRatioPts,
    bonusPts: event.bonusPts,
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
    carried = next?.carryForwardEnabled
      ? Object.fromEntries(overall.map((rp) => [rp.player.id, rp.stats.totalPoints * (next.carryForwardPct / 100)]))
      : {};
  }
  return perStage;
}

export async function loadEventState(eventId: string): Promise<EventState | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return null;

  const [accounts, players, groups, stages, matches, bracketWinners, scorecards, tees] = await Promise.all([
    prisma.account.findMany({ where: { eventId }, orderBy: { name: "asc" } }),
    prisma.player.findMany({ where: { eventId }, orderBy: { seed: "asc" } }),
    prisma.group.findMany({ where: { eventId }, orderBy: { position: "asc" } }),
    prisma.stage.findMany({ where: { eventId }, orderBy: { position: "asc" } }),
    prisma.match.findMany({ where: { eventId } }),
    prisma.bracketWinner.findMany({ where: { eventId } }),
    prisma.scorecard.findMany({ where: { eventId } }),
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
  const courseHcp = courseHandicapMap(confirmed, teeRatings, defaultTeeId, activeHoles);
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

  let carried: Record<string, number> = {};
  let overall: RankedPlayer[] = computeStandings(domainPlayers, [], scoring);
  let groupStandings: GroupStanding[] = groups.map((g) => {
    const gp = confirmed.filter((p) => p.groupId === g.id).map((p) => toDomainPlayer(p, hcpOf(p)));
    const ranked = computeStandings(gp, [], scoring);
    return { group: g, ranked, cutoff: groupCutoff(ranked, event.qualifyPerGroup) };
  });
  let activeDomainMatches: DomainMatch[] = [];

  for (let i = 0; i < rrStages.length; i += 1) {
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
    carried = next?.carryForwardEnabled
      ? Object.fromEntries(overall.map((rp) => [rp.player.id, rp.stats.totalPoints * (next.carryForwardPct / 100)]))
      : {};
  }

  const playRounds = playingStages(stages);
  // The current round is the latest round that actually has matches to score.
  // Taking the last stage unconditionally sent score entry to a Round 2 that
  // existed but hadn't been generated yet — "No matches yet" — while Round 1
  // sat fully scheduled one dropdown away. An organizer mid-tournament reads
  // that as the app being broken, because from where they stand it is.
  const stagesWithMatches = new Set(matches.map((m) => m.stageId));
  const latestActive = [...rrStages].reverse().find((s) => stagesWithMatches.has(s.id)) ?? null;
  // Falls back to the last played round so a tournament made only of medal
  // rounds still has a "current round" for the dashboard and score entry.
  const activeStage =
    latestActive ?? rrStages[rrStages.length - 1] ?? playRounds[playRounds.length - 1] ?? null;
  const rrMatches = activeStage ? matches.filter((m) => m.stageId === activeStage.id) : [];
  const domainMatches = activeDomainMatches;

  // Stroke-play standings (from submitted scorecards), used when the event format is stroke.
  const isStroke = event.format === "stroke";
  const pars = course.pars;
  const handicapById = courseHcp;
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const strokeAgg = new Map<string, { gross: number; thru: number; parThru: number; strokesReceived: number; points: number }>();
  for (const sc of scorecards) {
    let strokes: (number | null)[];
    try {
      strokes = JSON.parse(sc.strokes) as (number | null)[];
    } catch {
      continue;
    }
    // Playing Handicap, not Course Handicap: the format's allowance — 95% for
    // an individual medal or Stableford under WHS Appendix C, or whatever the
    // committee set on the round — applied to the strokes this card receives.
    // The allowance existed in the format table and on the stage, and the team
    // engines honoured it; the individual standings never did, so every medal
    // was quietly played off 100%.
    const cardStage = stageById.get(sc.stageId);
    const allowance = cardStage ? effectiveAllowance(cardStage.format, cardStage.handicapAllowance) : 100;
    const handicap = playingHandicapFrom(handicapById.get(sc.playerId) ?? 0, allowance);
    const a = strokeAgg.get(sc.playerId) ?? { gross: 0, thru: 0, parThru: 0, strokesReceived: 0, points: 0 };
    strokes.forEach((s, i) => {
      if (typeof s === "number" && s > 0) {
        a.gross += s;
        a.thru += 1;
        a.parThru += pars[i] ?? 0;
        // Strokes are allocated per hole actually played (not the full
        // handicap against a partial gross), so "net" is accurate thru any
        // number of holes, not just once the round is complete.
        const holeStrokes = holeStrokesReceived(handicap, holeDifficulty[i] ?? 18, allocationHoles(holeDifficulty.length));
        a.strokesReceived += holeStrokes;
        a.points += stablefordPointsForHole(s, pars[i] ?? 0, holeStrokes);
      }
    });
    strokeAgg.set(sc.playerId, a);
  }
  // Stableford ranks by points descending (higher is better); every other
  // basis ranks by net strokes ascending (lower is better).
  const stableford = activeStage?.scoringBasis === "stableford";
  const strokeStandings: StrokeStanding[] = confirmed
    .map((p) => {
      const a = strokeAgg.get(p.id) ?? { gross: 0, thru: 0, parThru: 0, strokesReceived: 0, points: 0 };
      return { player: p, gross: a.gross, net: a.gross - Math.round(a.strokesReceived), toPar: a.gross - a.parThru, points: a.points, thru: a.thru, rank: 0 };
    })
    .sort((x, y) => {
      const started = (y.thru > 0 ? 1 : 0) - (x.thru > 0 ? 1 : 0);
      if (started !== 0) return started;
      return stableford ? y.points - x.points : x.net - y.net || x.gross - y.gross;
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

  const advancingIds = qualifierIds;
  const advancingCount = qualifierIds.size;

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
  const done = state.rrMatches.filter((m) => {
    try {
      const holes = JSON.parse(m.holes) as HoleResultArr;
      return holes.some((h) => h !== null);
    } catch {
      return false;
    }
  }).length;
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
    const nonAdv = scored.filter((s) => !state.advancingIds.has(s.player.id));
    const lastIn = advancing[advancing.length - 1];
    const firstOut = nonAdv[0];
    if (lastIn) {
      out.push({
        icon: "🎯",
        title: "Qualification watch",
        text: stableford
          ? `${lastIn.player.name} holds the final qualifying spot at ${lastIn.points} pts.`
          : `${lastIn.player.name} holds the final qualifying spot at net ${lastIn.net}.`,
      });
    }
    if (firstOut && lastIn) {
      out.push({
        icon: "🚨",
        title: "Bubble watch",
        text: stableford
          ? `${firstOut.player.name} is ${lastIn.points - firstOut.points} points outside qualification.`
          : `${firstOut.player.name} is ${firstOut.net - lastIn.net} shots outside qualification.`,
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
  const nonAdvancing = state.overall.filter((rp) => !state.advancingIds.has(rp.player.id));
  const lastIn = advancing[advancing.length - 1];
  const firstOut = nonAdvancing[0];
  if (lastIn) {
    out.push({ icon: "🎯", title: "Qualification watch", text: `${lastIn.player.name} holds the final qualifying spot on ${fmt(lastIn.stats.totalPoints)} pts.` });
  }
  if (firstOut && lastIn) {
    const gap = lastIn.stats.totalPoints - firstOut.stats.totalPoints;
    out.push({ icon: "🚨", title: "Bubble watch", text: `${firstOut.player.name} is ${fmt(gap)} pts outside qualification.` });
  }

  return out;
}

export function expectedRrTotal(state: EventState): number {
  return state.groups.reduce((acc, g) => {
    const n = state.confirmed.filter((p) => p.groupId === g.id).length;
    return acc + roundRobinMatchCount(n);
  }, 0);
}
