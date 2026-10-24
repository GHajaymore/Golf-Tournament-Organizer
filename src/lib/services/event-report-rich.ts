import "server-only";
import type { EventState } from "./tournament";
import { playingStages } from "./tournament";
import type { LiveBoardView } from "./live-board";
import { finishingPositions } from "./finish-order";
import { flightStandings } from "./me";
import { teamStandingsWithCards } from "./teams";
import { playedStageIds } from "./event-report-sections";
import { findFormat, needsTeams } from "../formats";
import { holesPlayed } from "../domain/handicap";
import { roundLabel } from "../domain/round-label";
import { marginWords } from "../domain/my-tie";
import { holdsPosition, placeText, sharedRanks } from "../domain/shared-position";
import {
  countbackWords,
  leadFigure,
  leadPlaceWords,
  listWords,
  placeFigure,
  sideFigure,
  sideLeadFigure,
  type RankBasis,
} from "../domain/final-report";
import { namedAfterPlayers } from "../domain/side-name";
import {
  holeStrip,
  ladderGraphic,
  pathGraphic,
  pointsGraphic,
  sideGraphic,
  weeksGraphic,
  type HeroGraphic,
  type HoleStripGraphic,
  type WeekRow,
} from "../domain/report-graphics";
import type { HighlightRound } from "../domain/report-highlights";
import type { MovementRound } from "../domain/report-movement";
import type { StandingRow } from "@/components/LeaderboardTable";

/**
 * THE RICH REPORT'S LEAD AND PICTURES (2026-10-23) — what a report opens with,
 * in the format's own words, and the one graphic chosen for the format.
 *
 * Read, never worked out again: the places and the order are the board's
 * (`board.rows`, the sides' `place`), a flight's are `flightStandings`', a
 * knockout's `finishingPositions`', the countback step is the board's own
 * (`state.countbackBetween`) and a side's card is the board's counting of it
 * (`teamStandingsWithCards`). See `domain/report-graphics.ts` for the rule
 * that each graphic is drawn from the same rows as the table beside it.
 */

export type ReportKind = "stroke" | "stableford" | "match" | "knockout" | "league" | "team" | "casual";

export interface LeadLine {
  /** "Winner", "Second", "Joint third", "Champion", "Leading". */
  place: string;
  names: string[];
  /** "71 gross / 66 net", "38 points", "won the final 2&1". */
  figure: string;
  /** "won on countback, back 9", or a committee's note on a play-off; "" for none. */
  how: string;
}

export interface LeadGroup {
  /** "Overall", a flight's name. */
  label: string;
  lines: LeadLine[];
}

export interface ReportSide {
  name: string;
  members: string[];
  gross: number;
  net: number;
  points: number;
  played: number;
  place: number | null;
}

type Basis3 = "stableford" | "gross" | "net";

export async function leadFor(input: {
  state: EventState;
  board: LiveBoardView;
  rows: StandingRow[];
  sides: ReportSide[];
  teamBasis: Basis3;
  basis: RankBasis;
  kind: ReportKind;
  over: boolean;
  completed: boolean;
  knockout: boolean;
  margins: Map<string, string>;
  rowById: Map<string, StandingRow>;
  nameOf: Map<string, string>;
  confirmedNote: string;
  /** The champion the committee confirmed for the honours board — after a play-off, the one who won it. */
  confirmedChampion: string;
}): Promise<LeadGroup[]> {
  const { state, rows, basis, over } = input;
  const note = input.confirmedNote.trim();

  // ── A knockout: the champion, the final's margin, the runner-up ──────────
  if (input.kind === "knockout") {
    if (!over) return [];
    const places = finishingPositions(state);
    const at = (rank: number) => places.filter((p) => p.rank === rank).map((p) => p.name);
    const champion = at(1);
    if (champion.length === 0) return [];
    const main = input.board.draws[0]?.view;
    const final = main?.rounds[main.rounds.length - 1]?.matches[0];
    const margin = final ? marginWords(input.margins.get(final.key)) : "";
    const runnerUp = at(2);
    const lines: LeadLine[] = [
      {
        place: "Champion",
        names: champion,
        figure: runnerUp.length ? `beat ${listWords(runnerUp)} in the final${margin}` : "",
        how: note,
      },
      ...(runnerUp.length ? [{ place: "Runner-up", names: runnerUp, figure: "", how: "" }] : []),
      ...(at(3).length
        ? [
            {
              place: at(3).length > 1 ? "Semi-finalists" : "Semi-finalist",
              names: at(3),
              figure: "",
              how: "",
            },
          ]
        : []),
    ];
    return [
      {
        label: input.board.draws.length > 1 ? (input.board.draws[0]?.label ?? "Overall") : "Overall",
        lines,
      },
    ];
  }

  // ── Sides ─────────────────────────────────────────────────────────────────
  if (input.kind === "team") {
    const placed = input.sides.filter((s) => s.place !== null && s.place <= 3);
    const ranks = [...new Set(placed.map((s) => s.place as number))].sort((a, b) => a - b).slice(0, 3);
    const lines = ranks.map((rank, i) => {
      const at = placed.filter((s) => s.place === rank);
      const figures = at.map((s) => sideLeadFigure(s, input.teamBasis));
      const ranked = at.map((s) => sideFigure(s, input.teamBasis));
      return {
        place: leadPlaceWords(i + 1, at.length > 1, over),
        names: at.map((s) =>
          s.members.length && !namedAfterPlayers(s.name, s.members) ? `${s.name} (${s.members.join(" & ")})` : s.name,
        ),
        figure: figures.every((f) => f === figures[0])
          ? figures[0]
          : ranked.every((f) => f === ranked[0])
            ? ranked[0]
            : "",
        how: i === 0 && over ? note : "",
      };
    });
    return lines.length ? [{ label: "Overall", lines }] : [];
  }

  // ── Every individual board: overall, then each flight ───────────────────
  const linesOf = (
    ordered: Array<{ row: StandingRow; rank: number }>,
    withNote: boolean,
    places: number,
  ): LeadLine[] => {
    const all = [...new Set(ordered.filter((o) => o.rank > 0).map((o) => o.rank))].sort((a, b) => a - b);
    const ranks = all.slice(0, places);
    const out: LeadLine[] = [];
    ranks.forEach((rank, i) => {
      const at = ordered.filter((o) => o.rank === rank);
      const figures = at.map((o) => leadFigure(o.row, basis));
      // Shared on the ranked figure and apart on the other one: say the ranked one.
      const ranked = at.map((o) => placeFigure(o.row, basis));
      // Placed apart from the place below on the same figure: the board's countback did it, and says where.
      const nextRank = all[i + 1];
      const below = nextRank ? ordered.filter((o) => o.rank === nextRank) : [];
      const step = at.length === 1 && below.length > 0 ? state.countbackBetween(at[0].row.id, below[0].row.id) : null;
      out.push({
        place: leadPlaceWords(i + 1, at.length > 1, over),
        names: at.map((o) => o.row.name),
        figure: figures.every((f) => f === figures[0])
          ? figures[0]
          : ranked.every((f) => f === ranked[0])
            ? ranked[0]
            : "",
        how: [
          step
            ? countbackWords(
                step,
                i + 1,
                basis,
                over,
                below.map((b) => b.row.name),
              )
            : "",
          i === 0 && withNote ? note : "",
        ]
          .filter(Boolean)
          .join(". "),
      });
    });
    return out;
  };

  const overall = linesOf(
    rows.filter((r) => r.ranked).map((row) => ({ row, rank: row.rank })),
    true,
    3,
  );
  /**
   * A PLAY-OFF: the board shares first (the countback could not separate
   * them, and software never invents an order), and the committee CONFIRMED a
   * champion for the honours board — the one who won the play-off. Said that
   * way: the champion with the committee's note ("won the play-off at the
   * 2nd extra hole"), the others second on the same figure.
   */
  const champ = input.confirmedChampion.trim();
  if (over && champ && overall[0] && overall[0].names.length > 1 && overall[0].names.includes(champ)) {
    const shared = overall[0];
    const rest = shared.names.filter((n) => n !== champ);
    // Each side of the play-off on their own full figure: they were level on the ranked one.
    const figureOf = (names: string[]) => {
      const f = names.map((n) => rows.find((r) => r.name === n)).map((r) => (r ? leadFigure(r, basis) : ""));
      return f.every((x) => x === f[0]) && f[0] ? f[0] : shared.figure;
    };
    overall.splice(
      0,
      1,
      { place: "Winner", names: [champ], figure: figureOf([champ]), how: note || "won the play-off" },
      { place: rest.length > 1 ? "Joint second" : "Second", names: rest, figure: figureOf(rest), how: "lost the play-off" },
    );
    // The board's second place is now third, and so on; the list stays three long.
    if (overall[2])
      overall[2] = {
        ...overall[2],
        place: overall[2].names.length > 1 ? "Joint third" : "Third",
      };
    overall.splice(3);
  }
  const groups: LeadGroup[] = overall.length ? [{ label: "Overall", lines: overall }] : [];
  if (!input.knockout && state.groups.length > 1) {
    // A handful of flights each have a podium; thirty pools of four have a winner each.
    const places = state.groups.length > 4 ? 1 : 3;
    for (const f of flightStandings(state)) {
      const ordered = f.rows.flatMap((r) => {
        const row = input.rowById.get(r.id);
        return row && r.rank > 0 ? [{ row, rank: r.rank }] : [];
      });
      const lines = linesOf(ordered, false, places);
      if (lines.length) groups.push({ label: f.label, lines });
    }
  }
  return groups;
}

/* ------------------------------------------------------------------------ */
/*  The pictures                                                            */
/* ------------------------------------------------------------------------ */

export async function picturesFor(input: {
  state: EventState;
  board: LiveBoardView;
  rows: StandingRow[];
  sides: ReportSide[];
  totals: unknown;
  teamBasis: Basis3;
  basis: RankBasis;
  kind: ReportKind;
  over: boolean;
  completed: boolean;
  cardRounds: HighlightRound[];
  stages: ReturnType<typeof playingStages>;
  shared: ReturnType<typeof sharedRanks>;
  margins: Map<string, string>;
  movedRounds: MovementRound[];
}): Promise<{ hero: HeroGraphic | null; holeStrip: HoleStripGraphic | null }> {
  const { state, board, rows, basis, kind, stages } = input;
  const played = stages.filter((s) => state.roundsWithResults.has(s.id));
  const label = (id: string) => roundLabel(state.stages, id) || "Round";
  const short = (l: string) => {
    const m = /^Round (\d+)$/.exec(l.trim());
    return m ? `R${m[1]}` : l;
  };

  // The hole strip, over one round's cards: the second picture where it applies.
  const oneRoundStrip = (): HoleStripGraphic | null => {
    if (played.length !== 1 || (kind !== "stroke" && kind !== "stableford")) return null;
    const round = input.cardRounds.find((r) => r.stageId === played[0].id && r.strokePlay);
    return round ? holeStrip(round) : null;
  };

  let hero: HeroGraphic | null = null;

  if (kind === "knockout") {
    const main = board.draws[0]?.view;
    const champ = main?.champion;
    if (main && champ?.playerId) {
      hero = pathGraphic({
        champion: { id: champ.playerId, name: champ.name, seed: champ.seed },
        rounds: main.rounds,
        margin: (key) => marginWords(input.margins.get(key)),
        // Seeds mean something only where a qualifying round made them.
        seeded: !board.straightKnockout,
      });
    }
  } else if (kind === "team") {
    hero = await sideHero(input);
  } else if (kind === "league") {
    const columns = played.map((s) => short(label(s.id)));
    const lastMove = input.movedRounds[input.movedRounds.length - 1];
    const playedIn = (playerId: string, stageId: string) => {
      const cards = input.cardRounds.find((r) => r.stageId === stageId);
      if (cards?.cards.some((c) => c.playerId === playerId && c.strokes.some((s) => typeof s === "number" && s >= 1)))
        return true;
      return state.matches.some((m) => {
        if (m.stageId !== stageId || (m.playerAId !== playerId && m.playerBId !== playerId)) return false;
        if (m.forfeitedBy) return true;
        try {
          return (JSON.parse(m.holes) as unknown[]).length > 0;
        } catch {
          return false;
        }
      });
    };
    const weekRows: WeekRow[] = rows
      .filter((r) => holdsPosition(r))
      .map((r) => {
        const weeks = played.map((s) => playedIn(r.id, s.id));
        const moved = lastMove?.rows.find((m) => m.playerId === r.id);
        return {
          place: placeText(r, input.shared),
          name: r.name,
          points: basis.isStroke ? String(r.points) : r.pts,
          played: weeks.filter(Boolean).length,
          weeks,
          move: moved && !moved.isNew ? moved.change : 0,
        };
      });
    hero = weeksGraphic({
      rows: weekRows,
      columns,
      unit: basis.isStroke ? "Points" : "Match points",
      completed: input.over,
    });
  } else if (kind === "stableford") {
    hero = pointsGraphic(
      rows
        .filter((r) => holdsPosition(r))
        .map((r) => ({
          place: placeText(r, input.shared),
          name: r.name,
          points: r.points,
        })),
      input.over,
    );
  } else if (kind === "stroke" && played.length >= 2) {
    const cut = rows.find((r) => r.missedCut)?.missedCut ?? "";
    hero = ladderGraphic({
      rounds: input.movedRounds,
      final: rows
        .filter((r) => holdsPosition(r))
        .map((r) => ({
          id: r.id,
          name: r.name,
          place: placeText(r, input.shared),
        })),
      shortLabel: short,
      completed: input.completed,
      cutAfterRound: cut,
    });
  } else if (kind === "stroke") {
    hero = oneRoundStrip();
  }

  const strip = hero?.kind === "holes" ? null : oneRoundStrip();
  return { hero, holeStrip: strip };
}

/** The winning side's card in the last team round played, as the board counted it. */
async function sideHero(input: Parameters<typeof picturesFor>[0]): Promise<HeroGraphic | null> {
  const { state, stages, sides } = input;
  const played = await playedStageIds(state);
  const teamRounds = stages.filter((s) => needsTeams(s.format) && played.has(s.id));
  const stage = teamRounds[teamRounds.length - 1];
  const winners = sides.filter((s) => s.place === 1);
  if (!stage || winners.length !== 1) return null;
  const card = state.strokeCourseFor(stage.id);
  const rows = await teamStandingsWithCards(
    state.event.id,
    stage.id,
    stage.format,
    card.pars,
    card.holeDifficulty,
    stage.scoringBasis ?? "net",
    stage.handicapAllowance,
    stage.allowanceWeights,
    stage.countBest,
  );
  const side = rows.find((r) => r.name === winners[0].name);
  if (!side) return null;
  const holes = holesPlayed(stage.holes);
  const names = new Map(state.players.map((p) => [p.id, p.name.split(/\s+/)[0] || p.name]));
  return sideGraphic({
    side: side.members.length ? side.members.join(" & ") : side.name,
    round: teamRounds.length > 1 ? roundLabel(state.stages, stage.id) || "" : "",
    basis: input.teamBasis,
    shared: findFormat(stage.format).ball === "single",
    firstHole: holes === 9 && stage.nine === "back" ? 10 : 1,
    pars: card.pars,
    holes: side.holes.slice(0, holes),
    names,
  });
}
