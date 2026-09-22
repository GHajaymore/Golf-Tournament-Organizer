import "server-only";
import { prisma } from "../db";
import { playingStages, settingsOf, type EventState } from "./tournament";
import {
  resolveAttendance,
  tracksPerRound,
  playersAnswer,
  ATTENDANCE_MODE_LABEL,
  type AttendanceMode,
} from "../domain/attendance";
import { cleanIsoDate, shortDate } from "../domain/round-dates";
import { roundLabel } from "../domain/round-label";

/**
 * WHO TURNED OUT, ACROSS THE WHOLE SEASON.
 *
 * Ajay, 2026-09-21: "thee report of opt in/out in reporting menu" — then, when
 * asked whether it existed, "build the report of opt in/out."
 *
 * IT DID NOT. `WeekField` shows attendance for ONE round, on `/foursomes`,
 * `/entry` and `/stages`, and that is an operational control: it answers "who
 * is in for Thursday" while somebody is drawing Thursday's sheet. Nothing
 * anywhere answered the secretary's question, which is a different one and is
 * asked at the END of a season rather than during a week: who actually turned
 * out, how often, and who never replies at all.
 *
 * So this is a season-wide grid — every confirmed player against every playing
 * round — rather than a second copy of the weekly control.
 *
 * ONE READER OF THE ANSWER. Every cell comes from `resolveAttendance`, the
 * same function the weekly control and the player's own screen use, so a
 * report and a tee sheet cannot come to disagree about whether somebody was
 * in. That matters more here than anywhere else: this is the sheet a club
 * prints when it decides who is still a regular.
 *
 * AND IT SAYS WHEN THERE IS NOTHING TO REPORT. A tournament on `everyone`
 * tracks no attendance at all, so the honest output is a sentence saying so —
 * not an empty grid, and not a grid full of "in" that would read as forty
 * people having confirmed. See `tracked`.
 */

export interface AttendanceReportRound {
  stageId: string;
  /** "Round 7" — the tournament's own numbering. */
  label: string;
  /** The day it is played, ISO, or "" when nobody has dated it. */
  playedOn: string;
  /** "Tue 19 May", or "" when there is no date. */
  dateLabel: string;
  /** How many were in, out, and in only because they never answered. */
  in: number;
  out: number;
  inByDefault: number;
}

export interface AttendanceReportCell {
  status: "in" | "out";
  /** Whether that is somebody's stated answer, or the tournament's default. */
  explicit: boolean;
  /** Who recorded it — "" when nobody has. */
  decidedBy: string;
}

export interface AttendanceReportRow {
  playerId: string;
  name: string;
  /** One cell per round, in the same order as `rounds`. */
  cells: AttendanceReportCell[];
  /** Rounds this player was in for. */
  inCount: number;
  /** Rounds they actually answered for themselves or had recorded. */
  answered: number;
}

export interface AttendanceReport {
  /**
   * Whether this tournament tracks attendance at all.
   *
   * False for `everyone`, where the confirmed field plays every round and
   * there is no question. The caller renders the reason rather than a grid.
   */
  tracked: boolean;
  mode: AttendanceMode;
  /** "In unless they opt out" — the setting, in the organizer's own words. */
  modeLabel: string;
  /** False under `captains`, where staff record what the captain sends. */
  playersAnswerThemselves: boolean;
  rounds: AttendanceReportRound[];
  rows: AttendanceReportRow[];
  /** Players who have never answered any round. The chase list. */
  neverAnswered: number;
}

const EMPTY = (mode: AttendanceMode): AttendanceReport => ({
  tracked: false,
  mode,
  modeLabel: ATTENDANCE_MODE_LABEL[mode],
  playersAnswerThemselves: playersAnswer(mode),
  rounds: [],
  rows: [],
  neverAnswered: 0,
});

export async function attendanceReport(state: EventState): Promise<AttendanceReport> {
  const mode = settingsOf(state.event).attendanceMode as AttendanceMode;
  if (!tracksPerRound(mode)) return EMPTY(mode);

  const rounds = playingStages(state.stages);
  if (rounds.length === 0) return EMPTY(mode);

  const explicit = await prisma.roundAttendance.findMany({
    where: { eventId: state.event.id, stageId: { in: rounds.map((r) => r.id) } },
    select: { stageId: true, playerId: true, status: true, decidedBy: true },
  });

  const confirmed = state.confirmed;
  const ids = confirmed.map((p) => p.id);

  // Resolved once per round for the whole field, rather than per player — a
  // twenty-week league against forty members is 800 cells and this keeps it
  // to one pass per round.
  const byStage = new Map(
    rounds.map((r) => [
      r.id,
      resolveAttendance(
        mode,
        ids,
        explicit
          .filter((e) => e.stageId === r.id)
          .map((e) => ({ playerId: e.playerId, status: e.status, decidedBy: e.decidedBy })),
      ),
    ]),
  );

  const reportRounds: AttendanceReportRound[] = rounds.map((r) => {
    const summary = byStage.get(r.id)!;
    const playedOn = cleanIsoDate(r.playedOn);
    return {
      stageId: r.id,
      label: roundLabel(state.stages, r.id),
      playedOn,
      dateLabel: playedOn ? shortDate(playedOn) : "",
      in: summary.in,
      out: summary.out,
      inByDefault: summary.inByDefault,
    };
  });

  const rows: AttendanceReportRow[] = confirmed.map((p) => {
    const cells = rounds.map((r) => {
      const row = byStage.get(r.id)?.rows.find((x) => x.playerId === p.id);
      return {
        status: row?.status ?? "out",
        explicit: row?.explicit ?? false,
        decidedBy: row?.decidedBy ?? "",
      };
    });
    return {
      playerId: p.id,
      name: p.name,
      cells,
      inCount: cells.filter((c) => c.status === "in").length,
      answered: cells.filter((c) => c.explicit).length,
    };
  });

  return {
    tracked: true,
    mode,
    modeLabel: ATTENDANCE_MODE_LABEL[mode],
    playersAnswerThemselves: playersAnswer(mode),
    rounds: reportRounds,
    rows,
    neverAnswered: rows.filter((r) => r.answered === 0).length,
  };
}

/**
 * The report as a spreadsheet.
 *
 * One row per player, one column per round, plus the two totals a secretary
 * actually sorts on. The cell says IN or OUT and marks the ones nobody
 * answered, because "in by default" and "said they were in" are different
 * facts and this sheet is where a club decides who is still a regular — the
 * same distinction `resolveAttendance` exists to preserve, carried all the way
 * to the export rather than flattened on the way out.
 */
export function attendanceCsvRows(report: AttendanceReport): string[][] {
  const head = [
    "Player",
    ...report.rounds.map((r) => (r.dateLabel ? `${r.label} (${r.dateLabel})` : r.label)),
    "Rounds in",
    "Answered",
  ];
  const body = report.rows.map((row) => [
    row.name,
    ...row.cells.map((c) => (c.explicit ? (c.status === "in" ? "In" : "Out") : c.status === "in" ? "In (default)" : "Out (default)")),
    String(row.inCount),
    String(row.answered),
  ]);
  // The column totals, on the sheet rather than left to a formula.
  const totals = [
    "In this round",
    ...report.rounds.map((r) => String(r.in)),
    "",
    "",
  ];
  return [head, ...body, totals];
}
