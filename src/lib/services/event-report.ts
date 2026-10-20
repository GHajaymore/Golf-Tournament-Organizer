import { prisma } from "../db";
import { liveBoard } from "./live-board";
import { loadEventState, playingStages } from "./tournament";
import { resultLinesFor } from "./tournament-result";
import { finishingPositions } from "./finish-order";
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
import { unrankedNote, type StandingRow } from "@/components/LeaderboardTable";
import {
  countWords,
  eventRibbon,
  eventStory,
  nineWords,
  placeFigure,
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
 * it. Prize AMOUNTS are left off — the report goes to everybody, and what a
 * prize is worth is the club's business. A casual round has no report, as it
 * has no honours board.
 */

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
  prizes: Array<{ what: string; winners: string[] }>;
}

export type AnyReport = { kind: "cup"; report: FinalReport } | { kind: "event"; report: EventReport };

/** The report for any tournament: a cup's, or a champion's. Null for a casual round. */
export async function reportFor(eventId: string): Promise<AnyReport | null> {
  const cupRounds = await prisma.stage.count({ where: { eventId, type: TEAM_SESSION } });
  if (cupRounds > 0) {
    const cup = await finalReport(eventId);
    return cup ? { kind: "cup", report: cup } : null;
  }
  const event = await eventReport(eventId);
  return event ? { kind: "event", report: event } : null;
}

/**
 * Why a row holds no position, in the BOARD's own words (`unrankedNote`, the
 * printed sheet's reader) — "Missed the cut after Round 1", "WD — withdrew".
 * The board leaves a player who returned nothing uncaptioned; a report sent
 * after the event says so.
 */
function unrankedWords(r: StandingRow): string {
  return unrankedNote(r) || "No return";
}

export async function eventReport(eventId: string): Promise<EventReport | null> {
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
  const sides: Array<{ name: string; members: string[]; gross: number; net: number; points: number; played: number; place: number | null }> = !team
    ? []
    : totals
      ? totals.rows.map((r, i) => ({ ...r, place: totalPlaces[i] ?? null }))
      : board.teamRows;

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
      return at.length ? { names: at.map((s) => s.name), figure: sideFigure(at[0], teamBasis) } : null;
    }
    const at = rows.filter((r) => r.ranked && r.rank === rank);
    return at.length ? { names: at.map((r) => r.name), figure: placeFigure(at[0], basis) } : null;
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
  const lines = await resultLinesFor(state);
  const recap = recapParagraphs(event.reportRecap);
  const story = recap.length
    ? recap
    : eventStory({ completed, first, second, rounds: lines.map((l) => ({ label: l.label, result: l.result })) });

  // The leaderboard, the whole field: a club sends this to everybody, and
  // everybody looks for themselves. Gross AND net wherever there are strokes.
  const columns = team
    ? teamBasis === "stableford"
      ? ["Points", "Gross"]
      : ["Gross", "Net"]
    : !basis.isStroke
      ? ["Played", "Points"]
      : basis.isStableford
        ? ["Points", "Gross"]
        : ["Gross", "Net", "To par"];
  // A side's place is the one `teamStandings` decided, countback and all,
  // written the way the team board writes it (`placeTexts`).
  const sidePlaces = placeTexts(sides.map((s) => s.place));
  const sideRows: EventReportRow[] = sides.map((s, i) => ({
    place: sidePlaces[i] ?? "",
    name: namedAfterPlayers(s.name, s.members) || s.members.length === 0 ? s.name : `${s.name} (${s.members.join(", ")})`,
    cells: s.played === 0 ? columns.map(() => "") : teamBasis === "stableford" ? [String(s.points), String(s.gross)] : [String(s.gross), String(s.net)],
    note: s.place === null ? (s.played === 0 ? "No return" : "Not placed") : "",
    first: !!first && s.place !== null && s.place === ranks[0],
  }));
  // The position and the to-par through the board's own readers: "T2" is
  // `placeText` over `sharedRanks`, and "To par" is the figure the public
  // board prints, on the basis it ranks on (`rankedScore`) — so a net board's
  // to-par is net to par, as it is on the board.
  const shared = sharedRanks(rows);
  const playerRows: EventReportRow[] = rows.map((r) => {
    const cells = !r.started
      ? columns.map(() => "")
      : !basis.isStroke
        ? [String(r.played), r.pts]
        : basis.isStableford
          ? [String(r.points), String(r.gross)]
          : [String(r.gross), String(r.net), rankedScore(r, basis).text];
    return {
      place: holdsPosition(r) ? placeText(r, shared) : "",
      name: r.name,
      cells,
      note: r.ranked ? "" : unrankedWords(r),
      first: !!first && r.ranked && first.names.includes(r.name) && r.rank === ranks[0],
    };
  });

  const [prizeRows, contests] = await Promise.all([
    prisma.prize.findMany({
      where: { eventId, winnerId: { not: null } },
      orderBy: { position: "asc" },
      select: { category: true, winnerId: true },
    }),
    prisma.contest.findMany({
      where: { eventId },
      orderBy: { createdAt: "asc" },
      select: { name: true, hole: true, entrants: { where: { won: true }, select: { playerId: true } } },
    }),
  ]);
  const nameOf = new Map(state.players.map((p) => [p.id, p.name]));
  const prizes = [
    ...prizeRows.map((p) => ({ what: p.category, winners: [nameOf.get(p.winnerId ?? "") ?? ""].filter(Boolean) })),
    ...contests
      .filter((c) => c.entrants.length > 0)
      .map((c) => ({
        what: c.hole > 0 && !c.name.includes(String(c.hole)) ? `${c.name} (hole ${c.hole})` : c.name,
        winners: c.entrants.map((e) => nameOf.get(e.playerId) ?? "").filter(Boolean),
      })),
  ].filter((p) => p.winners.length > 0);

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
      : rows.length
        ? `Ranked by ${board.unit}`
        : "",
    // A knockout's table is the round that seeded the draw, and says so.
    boardTitle: knockout ? "The qualifying round" : team ? "The sides" : "The leaderboard",
    columns,
    rows: team ? sideRows : playerRows,
    prizes,
  };
}
