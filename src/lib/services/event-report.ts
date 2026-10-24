import { prisma } from "../db";
import { liveBoard, type LiveBoardView } from "./live-board";
import { loadEventState, playingStages } from "./tournament";
import { roundOutcomesFor } from "./tournament-result";
import { finishingPositions } from "./finish-order";
import { flightStandings } from "./me";
import { formattingForEvent } from "./organization";
import {
  comingUpFor,
  highlightRoundsFor,
  moneySections,
  movementRoundsFor,
  showsAmounts,
  venueNames,
  type ReportAudience,
  type ReportMoney,
  type ReportPot,
} from "./event-report-sections";
import { tournamentResult, type RoundOutcome } from "../domain/tournament-result";
import { averageWords, reportHighlights, toParWords, type HoleStat } from "../domain/report-highlights";
import { movementStory, placeIn, whoWords } from "../domain/report-movement";
import { cleanIsoDate, shortDate } from "../domain/round-dates";
import { placeOrdinal } from "../format";
import { finalReport, recapParagraphs, type FinalReport } from "./final-report";
import { TEAM_SESSION } from "./cup";
import { isMatch } from "../tournament-shape";
import { roundLabel } from "../domain/round-label";
import { rankedScore, unitIsNet } from "../domain/ranked-score";
import { holdsPosition, placeText, sharedRanks } from "../domain/shared-position";
import { placeTexts } from "../domain/flight-places";
import { pairTotalPlaces } from "../domain/pair-totals";
import { isStablefordRound } from "../domain/week-basis";
import { namedAfterPlayers } from "../domain/side-name";
import { lookupFormat } from "../formats";
import { tieResultWords } from "../domain/my-tie";
import { unrankedNote, type StandingRow } from "@/components/LeaderboardTable";
import {
  countWords,
  eventRibbon,
  eventStory,
  halves,
  listWords,
  nineWords,
  placeFigure,
  sharedFigure,
  sideFigure,
  type Place,
  type RankBasis,
} from "../domain/final-report";

/**
 * THE FINAL REPORT OF ANY TOURNAMENT THAT IS NOT A CUP (2026-10-19; Ajay:
 * "go ahead", then "go with your recommendations" — docs/final-report-every-format.md).
 *
 * A champion where a cup has a score. Every figure is read from a reader the
 * app already has, so the report cannot disagree with the board or the honours
 * board ("one rule, one place"):
 *
 *   the leaderboard     `liveBoard` — the public board's own rows, unit and
 *                       basis, at its default view, which for stroke play is
 *                       the TOTAL of every stroke round
 *   the figure          `placeFigure`, on the board's basis (`rankedScore`'s)
 *   a knockout's places `finishingPositions` — the draw, not a table
 *   the champion        a CONFIRMED honours entry wins over anything worked out
 *   each round          `resultLinesFor`, as the board words it
 *   prizes, contests    the winners the organizer recorded on Prizes
 *
 * A tie at the top is said as shared and never broken: the committee settles
 * it. A casual round has no report, as it has no honours board.
 *
 * WIDENED 2026-10-21 into the tournament's conclusion (Ajay: "the highlights
 * and player accomplishments, leaderboard movement, any schedule deadline …
 * THE REPORT CAN INCLUDE EVERYTHING THE TOURNAMENT IS USING INCLUDING MONEY").
 * Each section appears only where the tournament used that part of the app,
 * and each is a read of the reader the screen holding it uses — see
 * `event-report-sections.ts` for the list, and `report-highlights.ts` for the
 * one new piece of arithmetic (what the cards show: aces, birdies, runs).
 *
 * WHO SEES AMOUNTS (decided by recommendation, 2026-10-21; the owner may
 * change it). This header used to say prize amounts were left off because the
 * report goes to everybody. That was a recommendation and it is superseded:
 *
 *   the organizer's copy (Reports)      amounts, the costs, the whole settle-up
 *   a signed-in player in the field     the same, with their own line first
 *   the public link, signed out         winners, NEVER what they won; no costs,
 *                                       no settle-up, no pinned notices
 *
 * The rule is `showsAmounts(audience)`, decided once where the report is
 * built, so a section written later cannot print an amount on the public copy
 * by forgetting to ask. Money itself is reported FINAL ONLY: a pot still being
 * played is absent, exactly as it is absent from the settle-up.
 */

export { reportAudienceFor, type ReportAudience } from "./event-report-sections";

export interface EventReportRow {
  /** "1", "T2", or "" for somebody who holds no position. */
  place: string;
  name: string;
  /** The figures, as the board prints them; "" where there is none. */
  cells: string[];
  /** The board's own words for somebody without a position: "Withdrew", "Missed the cut". */
  note: string;
  first: boolean;
}

export interface EventReport {
  name: string;
  where: string;
  completed: boolean;
  first: Place | null;
  ribbon: string;
  story: string[];
  storyByOrganizer: boolean;
  facts: Array<{ label: string; value: string }>;
  /** "Ranked by net strokes" — the board's own caption. */
  rankedBy: string;
  /** "The leaderboard", "The sides", or a knockout's "The qualifying round". */
  boardTitle: string;
  columns: string[];
  rows: EventReportRow[];
  /** `amount` is "" on the public copy, and for a prize or contest with none. */
  prizes: Array<{ what: string; winners: string[]; amount: string }>;

  /** Who this copy is for — and so whether `amounts` appear anywhere in it. */
  audience: ReportAudience["kind"];
  amounts: boolean;
  /** Each flight's winner, when the field is divided into flights. */
  flights: Array<{ label: string; names: string[]; figure: string }>;
  /** A knockout's ties, round by round, as the draw holds them. */
  draw: Array<{ label: string; ties: string[] }>;
  /** Each round's result, when there is more than one — `resultLinesFor`'s sentence. */
  rounds: Array<{ label: string; date: string; result: string }>;
  /** How it was won, and the podium's place after each round. Null with one round. */
  movement: {
    story: Array<{ label: string; text: string }>;
    columns: string[];
    rows: Array<{ name: string; places: string[]; up: boolean[] }>;
  } | null;
  /** One line each: the label, who, and what. Aces and eagles first. */
  highlights: Array<{ label: string; who: string; what: string }>;
  /** A number and what it counts. */
  numbers: Array<{ figure: string; label: string }>;
  skins: ReportPot[];
  sideGames: ReportPot[];
  costs: ReportMoney["costs"];
  settleUp: ReportMoney["settleUp"];
  comingUp: Array<{ when: string; text: string }>;
}

export type AnyReport = { kind: "cup"; report: FinalReport } | { kind: "event"; report: EventReport };

/**
 * The report for any tournament: a cup's, or a champion's. Null for a casual
 * round. The audience defaults to the PUBLIC copy — the safe direction: a
 * caller that forgets to say who is looking shows nobody an amount.
 */
export async function reportFor(eventId: string, audience: ReportAudience = { kind: "public" }): Promise<AnyReport | null> {
  const cupRounds = await prisma.stage.count({ where: { eventId, type: TEAM_SESSION } });
  if (cupRounds > 0) {
    const cup = await finalReport(eventId);
    return cup ? { kind: "cup", report: cup } : null;
  }
  const event = await eventReport(eventId, audience);
  return event ? { kind: "event", report: event } : null;
}

/**
 * Why a row holds no position, in the BOARD's own words (`unrankedNote`, the
 * printed sheet's reader) — "Missed the cut after Round 1", "WD — withdrew".
 * The board leaves a player who returned nothing uncaptioned; a report sent
 * after the event says so.
 */
export function unrankedWords(r: StandingRow, completed: boolean): string {
  // While the tournament is still being played, somebody with nothing on a
  // card has not FAILED to return one — they have not teed off yet.
  return unrankedNote(r) || (completed ? "No return" : "Not started");
}

/** A side on the report's table: the round's side, or a pair's total over every team round. */
export interface ReportStandingSide {
  name: string;
  members: string[];
  /** Who is on it, by id — so a member's own screen finds THEIR side, never one sharing a name. */
  memberIds: string[];
  gross: number;
  net: number;
  points: number;
  played: number;
  place: number | null;
}

/**
 * WHO HOLDS WHICH PLACE, AS THE REPORT AND THE PUBLIC BOARD PLACE THEM — the
 * report's table and a member's own season (`services/my-season.ts`, 2026-10-24)
 * both read this, so the two cannot place one player two ways. Built from the
 * public board's own view (`liveBoard`), at its default round:
 *
 *   a player board   the board's rows; "T2" is `placeText` over `sharedRanks`
 *   a team round     the sides as `teamStandings` placed them, countback and
 *                    all — or, over several team rounds, the pairs' TOTALS,
 *                    placed as the board's totals table places them
 *   a hand-scored    nothing at all: the app does not rank that round
 *
 * A pure read of the board: nothing here decides a figure.
 */
export function reportStandings(board: LiveBoardView): {
  team: boolean;
  individual: boolean;
  teamBasis: LiveBoardView["teamBasis"];
  /** The pairs' totals, when the team event is decided on them. */
  totals: LiveBoardView["pairTotals"];
  rows: StandingRow[];
  sides: ReportStandingSide[];
  /** Each side's place as the team board writes it ("T1", "2"); "" for one with no card. */
  sidePlaces: string[];
  shared: Set<number>;
} {
  /**
   * A TEAM EVENT OF SEVERAL ROUNDS is decided on its TOTALS — the pairs' total
   * over every team round (`pairTotals`), placed exactly as the board's totals
   * table places them (`placesByValue` over `teamPlaceValue`, ties shared). The
   * team board itself shows one round at a time; a report of one round would
   * name that round's winner as the event's.
   */
  const totals = board.teamRound ? board.pairTotals : null;
  const teamBasis = totals?.basis ?? board.teamBasis;
  const team = board.teamRound && (board.teamRows.length > 0 || (totals?.rows.length ?? 0) > 0);
  const individual = !board.teamRound && !board.manualFormat;
  const rows = individual ? board.rows : [];
  const totalPlaces = totals ? pairTotalPlaces(totals.rows, teamBasis) : [];
  const sides: ReportStandingSide[] = !team
    ? []
    : totals
      ? totals.rows.map((r, i) => ({ ...r, place: totalPlaces[i] ?? null }))
      : board.teamRows;
  return {
    team,
    individual,
    teamBasis,
    totals,
    rows,
    sides,
    // A side's place is the one `teamStandings` decided, countback and all,
    // written the way the team board writes it (`placeTexts`).
    sidePlaces: placeTexts(sides.map((s) => s.place)).map((p) => p ?? ""),
    shared: sharedRanks(rows),
  };
}

/** A player's place on the board, as the board prints it: "1", "T2" — or "" for no position. */
export function reportPlace(r: StandingRow, shared: ReadonlySet<number>): string {
  return holdsPosition(r) ? placeText(r, shared) : "";
}

export async function eventReport(eventId: string, audience: ReportAudience = { kind: "public" }): Promise<EventReport | null> {
  const [event, state, board] = await Promise.all([
    prisma.event.findUnique({
      where: { id: eventId },
      select: { name: true, dates: true, course: true, status: true, shape: true, reportRecap: true },
    }),
    loadEventState(eventId),
    liveBoard(eventId),
  ]);
  if (!event || !state || !board || isMatch(event.shape)) return null;
  const completed = event.status === "completed";

  const basis: RankBasis = { isStroke: board.isStroke, isStableford: board.isStableford, isNet: unitIsNet(board.unit) };
  // Who holds which place — the one reading of the board, shared with a member's own season.
  const { totals, teamBasis, team, individual, rows, sides, sidePlaces, shared } = reportStandings(board);
  /**
   * A TABLE ONLY ONCE SOMEBODY HAS A RESULT (walked 2026-10-23). A tournament
   * taking entries printed its whole field as "No return", and a knockout
   * drawn in flights — which has no qualifying round — printed "The qualifying
   * round" as thirty-six rows of dashes. Nothing has been played, so there is
   * no table to send.
   */
  const anyResult = rows.some((r) => r.started);
  /**
   * HOW FAR ROUND, while any card is still open: the board prints "Thru 8"
   * beside a part-played card, and without it a gross 44 above a gross 75
   * reads as a 31-shot lead.
   */
  const thruColumn =
    !completed && board.isStroke && rows.some((r) => r.started && r.holesOwed > 0 && r.thru < r.holesOwed);

  /**
   * The places: off the draw for a knockout, off the sides for a team round,
   * off the board's rows otherwise. A KNOCKOUT STILL BEING PLAYED has no
   * leader — only players still in — so it names nobody until it is over; and
   * its table is the qualifying round, said as such.
   */
  const knockout = board.draws.length > 0;
  const placeAt = (rank: number): Place | null => {
    if (knockout) {
      const at = finishingPositions(state).filter((p) => p.rank === rank);
      return at.length ? { names: at.map((p) => p.name), figure: "" } : null;
    }
    if (team) {
      const at = sides.filter((s) => s.place === rank);
      return at.length ? { names: at.map((s) => s.name), figure: sharedFigure(at.map((s) => sideFigure(s, teamBasis))) } : null;
    }
    const at = rows.filter((r) => r.ranked && r.rank === rank);
    return at.length ? { names: at.map((r) => r.name), figure: sharedFigure(at.map((r) => placeFigure(r, basis))) } : null;
  };
  const ranks = (
    knockout
      ? finishingPositions(state).map((p) => p.rank)
      : team
        ? sides.flatMap((s) => (s.place === null ? [] : [s.place]))
        : rows.filter((r) => r.ranked).map((r) => r.rank)
  )
    .filter((v, i, all) => all.indexOf(v) === i)
    .sort((a, b) => a - b);
  const placesKnown = !knockout || completed;
  let first = placesKnown && ranks.length ? placeAt(ranks[0]) : null;
  const second = placesKnown && ranks.length > 1 ? placeAt(ranks[1]) : null;

  // A champion the committee CONFIRMED for the honours board is the record.
  const confirmed = completed
    ? await prisma.honoursEntry.findFirst({ where: { eventId }, select: { championName: true } })
    : null;
  if (confirmed) first = { names: [confirmed.championName], figure: first?.names.includes(confirmed.championName) ? first.figure : "" };

  const stages = playingStages(state.stages);
  const outcomes = await roundOutcomesFor(state);
  const lines = tournamentResult(outcomes.map((o) => o.outcome));
  const recap = recapParagraphs(event.reportRecap);
  // Each round's result has its own table now (`rounds` below), so the story
  // told from the results says who won and leaves the rounds to the table.
  const story = recap.length ? recap : eventStory({ completed, first, second, rounds: [] });

  // The leaderboard, the whole field: a club sends this to everybody, and
  // everybody looks for themselves. Gross AND net wherever there are strokes.
  const columns = team
    ? teamBasis === "stableford"
      ? ["Points", "Gross"]
      : ["Gross", "Net"]
    : !basis.isStroke
      ? ["Played", "Points"]
      : [...(basis.isStableford ? ["Points", "Gross"] : ["Gross", "Net", "To par"]), ...(thruColumn ? ["Thru"] : [])];
  const sideRows: EventReportRow[] = sides.map((s, i) => ({
    place: sidePlaces[i] ?? "",
    name: namedAfterPlayers(s.name, s.members) || s.members.length === 0 ? s.name : `${s.name} (${s.members.join(", ")})`,
    cells: s.played === 0 ? columns.map(() => "") : teamBasis === "stableford" ? [String(s.points), String(s.gross)] : [String(s.gross), String(s.net)],
    note: s.place === null ? (s.played === 0 ? "No return" : "Not placed") : "",
    first: !!first && s.place !== null && s.place === ranks[0],
  }));
  // The position and the to-par through the board's own readers: "T2" is
  // `placeText` over `sharedRanks` (`reportPlace`), and "To par" is the figure
  // the public board prints, on the basis it ranks on (`rankedScore`) — so a
  // net board's to-par is net to par, as it is on the board.
  const playerRows: EventReportRow[] = rows.map((r) => {
    const thru = thruColumn ? [r.holesOwed > 0 && r.thru >= r.holesOwed ? "F" : String(r.thru)] : [];
    const cells = !r.started
      ? columns.map(() => "")
      : !basis.isStroke
        ? [String(r.played), r.pts]
        : basis.isStableford
          ? [String(r.points), String(r.gross), ...thru]
          : [String(r.gross), String(r.net), rankedScore(r, basis).text, ...thru];
    return {
      place: reportPlace(r, shared),
      name: r.name,
      cells,
      note: r.ranked ? "" : unrankedWords(r, completed),
      first: !!first && r.ranked && first.names.includes(r.name) && r.rank === ranks[0],
    };
  });

  const [prizeRows, contests, money] = await Promise.all([
    prisma.prize.findMany({
      where: { eventId, winnerId: { not: null } },
      orderBy: { position: "asc" },
      select: { category: true, winnerId: true, amount: true },
    }),
    prisma.contest.findMany({
      where: { eventId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, hole: true, entrants: { where: { won: true }, select: { playerId: true } } },
    }),
    moneySections(state, audience),
  ]);
  const nameOf = new Map(state.players.map((p) => [p.id, p.name]));
  const prizes = [
    ...prizeRows.map((p) => ({
      what: p.category,
      winners: [nameOf.get(p.winnerId ?? "") ?? ""].filter(Boolean),
      amount: money.prizeAmount(p.amount),
    })),
    ...contests
      .filter((c) => c.entrants.length > 0)
      .map((c) => {
        const pot = money.contestPots.get(c.id) ?? 0;
        return {
          what: c.hole > 0 && !c.name.includes(String(c.hole)) ? `${c.name} (hole ${c.hole})` : c.name,
          winners: c.entrants.map((e) => nameOf.get(e.playerId) ?? "").filter(Boolean),
          // The pot the money screen holds for it (`moneyFor`), shared where it was shared.
          amount: pot > 0 ? `${money.money(pot)}${c.entrants.length > 1 ? ", shared" : ""}` : "",
        };
      }),
  ].filter((p) => p.winners.length > 0);

  // ── Flights: each flight's winner, from the reader Prizes and Today use ──
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const flights =
    individual && !knockout && state.groups.length > 1
      ? flightStandings(state).flatMap((f) => {
          const top = f.rows.filter((r) => r.rank === 1);
          if (top.length === 0) return [];
          const row = rowById.get(top[0].id);
          return [{ label: f.label, names: top.map((t) => nameOf.get(t.id) ?? "").filter(Boolean), figure: row ? placeFigure(row, basis) : "" }];
        })
      : [];

  // ── A knockout's draw, round by round, with the margins the committee recorded ──
  const margins = knockout
    ? new Map((await prisma.bracketWinner.findMany({ where: { eventId }, select: { key: true, result: true } })).map((w) => [w.key, w.result.trim()]))
    : new Map<string, string>();
  const draw = board.draws.flatMap((d) => {
    const ties = d.view.rounds.flatMap((round) =>
      round.matches.flatMap((m) => {
        if (!m.winnerId || !m.a.playerId || !m.b.playerId) return [];
        const [w, l] = m.winnerId === m.a.playerId ? [m.a, m.b] : [m.b, m.a];
        return [`${round.label}: ${w.name} beat ${l.name}${tieResultWords(margins.get(m.key))}`];
      }),
    );
    return ties.length ? [{ label: board.draws.length > 1 ? d.label : "The draw", ties }] : [];
  });

  // ── Each round, when there is more than one ──────────────────────────────
  const { locale } = await formattingForEvent(eventId);
  const rounds =
    stages.length > 1
      ? lines.map((l, i) => ({
          label: l.label,
          date: shortDate(cleanIsoDate(stages[i]?.playedOn), locale),
          result: l.result,
        }))
      : [];

  // ── How it was won: the week sheet's table after each round ──────────────
  let movement: EventReport["movement"] = null;
  let climb: ReturnType<typeof movementStory>["climb"] = null;
  if (individual && !knockout && stages.length > 1) {
    const moved = await movementRoundsFor(state, basis.isStableford ? "stableford" : basis.isNet ? "net" : "gross");
    if (moved.rounds.length > 1) {
      const words = (v: number) =>
        !state.isStroke
          ? `${halves(v)} match points`
          : moved.basis === "stableford"
            ? `${v} points`
            : moved.basis === "gross"
              ? `gross ${v}`
              : `net ${v}`;
      const told = movementStory(moved.rounds, words);
      climb = told.climb;
      // The podium, by the BOARD's places — the table under the champion.
      const podium = rows.filter((r) => r.ranked && r.rank <= 3);
      const earlier = moved.rounds.slice(0, -1);
      movement = {
        story: told.story,
        // The board's own places — the final ones only once it is over.
        columns: [...earlier.map((r) => shortRound(r.label)), completed ? "Final" : "Now"],
        rows: podium.map((r) => {
          const places = [...earlier.map((round) => placeIn(round.rows, r.id)), placeText(r, shared)];
          const nums = places.map((p) => Number(p.replace(/^T/, "")) || 0);
          return { name: r.name, places, up: nums.map((n, i) => i > 0 && n > 0 && nums[i - 1] > 0 && n < nums[i - 1]) };
        }),
      };
    }
  }

  // ── Highlights and the numbers, off the cards ────────────────────────────
  const cardRounds = await highlightRoundsFor(state);
  const found = reportHighlights(cardRounds);
  const venues = await venueNames(
    state,
    cardRounds.map((r) => r.venue),
  );
  const severalVenues = new Set(cardRounds.filter((r) => r.strokePlay).map((r) => r.venue)).size > 1;
  const holeWords = (h: HoleStat) => `Hole ${h.hole}${severalVenues && venues.get(h.venue) ? ` at ${venues.get(h.venue)}` : ""}`;
  const best = bestRoundOf(outcomes, stages);
  const several = stages.length > 1;
  // The names once each, however many rounds they did it in, and the rounds beside them.
  const whoOf = (holders: Array<{ name: string }>) => whoWords([...new Set(holders.map((h) => h.name))]);
  const whereOf = (holders: Array<{ name: string; round: string }>) => (several ? holdersWords(holders, true, 3) : "");
  const feat = (label: string, feats: typeof found.eagles) =>
    feats.length <= 4
      ? feats.map((e) => ({
          label: label === "Hole-in-one" ? label : e.what === "albatross" ? "Albatross" : "Eagle",
          who: e.name,
          what: e.what === "hole-in-one" ? `Hole ${e.hole}${e.par ? `, par ${e.par}` : ""}${several ? `, ${e.round}` : ""}` : `${e.strokes} on the par-${e.par} hole ${e.hole}${several ? `, ${e.round}` : ""}`,
        }))
      : [{ label: label === "Hole-in-one" ? "Holes-in-one" : "Eagles", who: whoOf(feats), what: `${feats.length} of them` }];
  // On a gross board the best round IS the lowest gross; said once.
  const lowSameAsBest = !!best && !!found.lowestGross && best.figure === `gross ${found.lowestGross.score}`;
  const highlights = [
    ...feat("Hole-in-one", found.aces),
    ...feat("Eagle", found.eagles),
    ...(best ? [{ label: "Best round", who: `${whoWords(best.names)} · ${best.figure}`, what: listWords(best.rounds) }] : []),
    ...(found.lowestGross && !lowSameAsBest
      ? [{ label: "Lowest gross", who: `${whoOf(found.lowestGross.holders)} · ${found.lowestGross.score}`, what: whereOf(found.lowestGross.holders) }]
      : []),
    ...(found.bestNine
      ? [
          {
            label: "Best nine holes",
            who: `${whoOf(found.bestNine.holders)} · ${found.bestNine.score}`,
            what: [`${capital(toParWords(found.bestNine.toPar))} on the ${found.bestNine.holders[0].nine} nine`, whereOf(found.bestNine.holders)].filter(Boolean).join(", "),
          },
        ]
      : []),
    ...(found.longestRun
      ? [
          {
            label: "Longest run at par or better",
            who: `${whoOf(found.longestRun.holders)} · ${found.longestRun.length} holes`,
            what:
              found.longestRun.holders.length === 1
                ? `Hole ${found.longestRun.holders[0].from} to ${found.longestRun.holders[0].to}${several ? `, ${found.longestRun.holders[0].round}` : ""}`
                : whereOf(found.longestRun.holders),
          },
        ]
      : []),
    ...(found.mostBirdiesInARound
      ? [
          {
            label: several ? "Most birdies in a round" : "Most birdies",
            who: `${whoOf(found.mostBirdiesInARound.holders)} · ${found.mostBirdiesInARound.count}`,
            what: whereOf(found.mostBirdiesInARound.holders),
          },
        ]
      : []),
    ...(found.mostBirdies
      ? [{ label: "Most birdies in the tournament", who: `${whoWords(found.mostBirdies.names)} · ${found.mostBirdies.count}`, what: "Across every round" }]
      : []),
    ...(climb
      ? [
          {
            label: "Biggest climb",
            who: `${whoWords(climb.names)} · up ${climb.places}`,
            what: climb.place ? `To ${climb.place.startsWith("T") ? `share ${placeOrdinal(Number(climb.place.slice(1)))}` : placeOrdinal(Number(climb.place))} after ${climb.round}` : `After ${climb.round}`,
          },
        ]
      : []),
  ];
  const n = found.numbers;
  // Only once a card is in: a knockout with no cards read "0 birdies".
  const numbers: Array<{ figure: string; label: string }> =
    !cardRounds.some((r) => r.cards.length > 0)
      ? []
      : [
          ...(n.cards > 0 ? [{ figure: String(n.cards), label: n.cards === 1 ? "card returned" : "cards returned" }] : []),
          { figure: String(n.birdies), label: n.birdies === 1 ? "birdie" : "birdies" },
          ...(n.eagles > 0 ? [{ figure: String(n.eagles), label: n.eagles === 1 ? "eagle or better" : "eagles or better" }] : []),
          ...(n.everyRound ? [{ figure: String(n.everyRound), label: "played every round" }] : []),
          ...n.hardest.slice(0, 1).map((h) => ({ figure: holeWords(h), label: `hardest: par ${h.par}, average ${averageWords(h.average)}` })),
          ...n.easiest.slice(0, 1).map((h) => ({ figure: holeWords(h), label: `easiest: par ${h.par}, average ${averageWords(h.average)}` })),
        ];

  const comingUp = await comingUpFor(state, audience);

  const facts: Array<{ label: string; value: string }> = [
    { label: "Format", value: stages.length === 1 ? "One round" : `${countWords(stages.length).replace(/^./, (c) => c.toUpperCase())} rounds` },
    ...stages.map((s) => {
      const f = lookupFormat(s.format.trim());
      const name = f?.name ?? s.format;
      // A Stableford is a FORMAT, whatever basis it is stored on — the one
      // reader of that is `isStablefordRound`, never the basis alone.
      const what = isStablefordRound(s.scoringBasis, s.format)
        ? /stableford/i.test(name)
          ? name
          : `${name}, Stableford`
        : `${s.scoringBasis === "gross" ? "Gross" : "Net"} ${name.toLowerCase()}`;
      return {
        label: roundLabel(stages, s.id) || s.description || "Round",
        value: `${what}, ${nineWords(s.holes, s.nine)}`,
      };
    }),
    { label: "Field", value: `${state.confirmed.length} ${state.confirmed.length === 1 ? "player" : "players"}` },
  ];

  return {
    name: event.name,
    where: [event.dates.trim(), event.course.trim()].filter(Boolean).join(" · "),
    completed,
    first,
    ribbon: eventRibbon({ completed, first }),
    story,
    storyByOrganizer: recap.length > 0,
    facts,
    rankedBy: team
      ? `Ranked by ${teamBasis === "stableford" ? "Stableford points" : `${teamBasis} strokes`}${totals ? ", every round added together" : ""}`
      : anyResult
        ? `Ranked by ${board.unit}`
        : "",
    // A knockout's table is the round that seeded the draw, and says so.
    boardTitle: knockout ? "The qualifying round" : team ? "The sides" : "The leaderboard",
    columns,
    rows: team ? (sides.some((s) => s.played > 0) ? sideRows : []) : anyResult ? playerRows : [],
    prizes,
    audience: audience.kind,
    amounts: showsAmounts(audience),
    flights,
    draw,
    rounds,
    movement,
    highlights,
    numbers,
    skins: money.skins,
    sideGames: money.sideGames,
    costs: money.costs,
    settleUp: money.settleUp,
    comingUp,
  };
}

/** "Round 2" → "R2" for a narrow column; anything else as it is. */
function shortRound(label: string): string {
  const m = /^Round (\d+)$/.exec(label.trim());
  return m ? `R${m[1]}` : label;
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * "Round 1 and Round 2" for one holder, "Ann in Round 1; Bob and Cat in Round 2"
 * for several — or just the rounds once there are more holders than a line holds.
 */
function holdersWords(holders: Array<{ name: string; round: string }>, rounds: boolean, most: number): string {
  const names = [...new Set(holders.map((h) => h.name))];
  if (!rounds) return names.length > most ? "" : listWords(names);
  const roundsIn = [...new Set(holders.map((h) => h.round))];
  if (names.length === 1 || roundsIn.length === 1 || names.length > most) return listWords(roundsIn);
  return roundsIn
    .map((round) => `${listWords([...new Set(holders.filter((h) => h.round === round).map((h) => h.name))])} in ${round}`)
    .join("; ");
}

/**
 * THE BEST ROUND OF A TOURNAMENT OF SEVERAL, read off the board's own winner
 * of each round (`roundOutcomesFor` — the reader `resultLinesFor` words) and
 * never worked out again. Only where every counted round is scored in the same
 * unit over the same holes: a Stableford round is not compared with a medal,
 * nor a nine with an eighteen. Null with one round — the champion is that.
 */
function bestRoundOf(
  outcomes: Array<{ stageId: string; outcome: RoundOutcome }>,
  stages: Array<{ id: string; holes: number }>,
): { names: string[]; figure: string; rounds: string[] } | null {
  if (stages.length < 2) return null;
  const scored = outcomes.flatMap(({ stageId, outcome }) =>
    outcome.kind === "stroke" &&
    (outcome.unit === "net" || outcome.unit === "gross" || outcome.unit === "pts") &&
    outcome.winners.length > 0 &&
    Number.isFinite(Number(outcome.winners[0].score))
      ? [{ stageId, unit: outcome.unit, label: outcome.label, value: Number(outcome.winners[0].score), names: outcome.winners.map((w) => w.name) }]
      : [],
  );
  if (scored.length < 2) return null;
  const unit = scored[0].unit;
  const holes = stages.find((s) => s.id === scored[0].stageId)?.holes;
  if (scored.some((s) => s.unit !== unit || stages.find((x) => x.id === s.stageId)?.holes !== holes)) return null;
  const higher = unit === "pts";
  const top = higher ? Math.max(...scored.map((s) => s.value)) : Math.min(...scored.map((s) => s.value));
  const at = scored.filter((s) => s.value === top);
  return {
    names: [...new Set(at.flatMap((s) => s.names))],
    figure: unit === "pts" ? `${top} points` : `${unit} ${top}`,
    rounds: at.map((s) => s.label),
  };
}
