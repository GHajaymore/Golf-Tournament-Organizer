import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AttendanceReport } from "@/components/AttendanceReport";
import {
  ATTENDANCE_MODES,
  ATTENDANCE_MODE_LABEL,
  tracksPerRound,
  playersAnswer,
  type AttendanceMode,
} from "@/lib/domain/attendance";
import type { AttendanceReport as Report } from "@/lib/services/attendance-report";

/**
 * THE REPORT IN ALL FOUR MODES, BECAUSE THE FIXTURE ONLY HAS ONE.
 *
 * `seed-club.mjs` sets `attendanceMode` exactly once, to `opt-out`. So walking
 * the seeded club renders this panel in ONE of its four states however many
 * screens are opened, and the other three ship unlooked-at — the trap
 * CLAUDE.md states as "a state nothing can express is a state nobody walks".
 *
 * That is not hypothetical today. Earlier on 2026-09-21 a theme defect lived
 * entirely in the one enum value no test passed — `auto` — while 8,293 tests
 * were green on the other two, and it was found by looking at a screen. This
 * is the same shape caught before it ships rather than after.
 *
 * Two of the four modes were verified against real rows: `opt-out` on the
 * Thursday league (the grid, 20 players) and `everyone` on the Club
 * Championship (the refusal, and no export offered). These cover all four and
 * assert the RULES rather than the sentences, so rewording does not turn them
 * red.
 */

const round = (i: number) => ({
  stageId: `s${i}`,
  label: `Round ${i}`,
  playedOn: `2026-05-0${i}`,
  dateLabel: `Thu ${i} May`,
  in: 1,
  out: 1,
  inByDefault: i === 1 ? 1 : 0,
});

const report = (mode: AttendanceMode): Report => ({
  tracked: tracksPerRound(mode),
  mode,
  modeLabel: ATTENDANCE_MODE_LABEL[mode],
  playersAnswerThemselves: playersAnswer(mode),
  rounds: tracksPerRound(mode) ? [round(1), round(2)] : [],
  rows: tracksPerRound(mode)
    ? [
        {
          playerId: "p1",
          name: "Ann Doyle",
          cells: [
            { status: "in", explicit: true, decidedBy: "Ann Doyle" },
            { status: "out", explicit: true, decidedBy: "Ann Doyle" },
          ],
          inCount: 1,
          answered: 2,
        },
        {
          playerId: "p2",
          name: "Bob Ellery",
          cells: [
            { status: "in", explicit: false, decidedBy: "" },
            { status: "out", explicit: false, decidedBy: "" },
          ],
          inCount: 1,
          answered: 0,
        },
      ]
    : [],
  neverAnswered: tracksPerRound(mode) ? 1 : 0,
});

const html = (mode: AttendanceMode) => renderToStaticMarkup(<AttendanceReport report={report(mode)} />);

describe("the attendance report renders in every mode", () => {
  it.each(ATTENDANCE_MODES)("comes up at all (%s)", (mode) => {
    // The floor: a panel that throws takes the whole Reports screen down, and
    // three of these four states have never been rendered against real rows.
    expect(html(mode).length).toBeGreaterThan(100);
  });

  it.each(ATTENDANCE_MODES)("shows a grid exactly when there is one to show (%s)", (mode) => {
    const out = html(mode);
    // `everyone` records nothing, so a grid would be an invention. The other
    // three all record something — including `captains`, where the club writes
    // down what the captain sent.
    expect(/<table/.test(out), `${mode}: grid presence`).toBe(tracksPerRound(mode));
  });

  it("says why, rather than drawing an empty grid, when nothing is tracked", () => {
    const out = html("everyone");
    // Matched WITHOUT the apostrophe on purpose. The component writes
    // `doesn&rsquo;t`, which renders as U+2019 rather than the `&#x27;` a
    // plain quote would give — so an assertion carrying either spelling is
    // pinned to an encoding rather than to the sentence.
    expect(out).toMatch(/use weekly sign-up/);
    expect(out).toMatch(/nothing to report/);
    expect(out).not.toMatch(/<table/);
  });

  /**
   * WHO IS BEING ASKED, which is a different question from whether anything is
   * tracked — and the distinction `captains` exists for. Under captains the
   * club records what a captain sent and the player is never asked, so a panel
   * telling a secretary that "players answer on their own phone" would be
   * describing a different league.
   */
  it.each(ATTENDANCE_MODES.filter(tracksPerRound))(
    "describes who actually answers (%s)",
    (mode) => {
      const out = html(mode);
      const saysPlayers = /Players answer on their own phone/.test(out);
      const saysCaptains = /Captains send their pairs in/.test(out);
      expect(saysPlayers).toBe(playersAnswer(mode));
      expect(saysCaptains).toBe(!playersAnswer(mode));
    },
  );

  it.each(ATTENDANCE_MODES.filter(tracksPerRound))(
    "names the mode the club actually chose (%s)",
    (mode) => {
      // The setting in the organizer's own words, so the sheet and the
      // settings screen cannot describe the league differently.
      expect(html(mode)).toContain(
        ATTENDANCE_MODE_LABEL[mode].replace(/'/g, "&#x27;"),
      );
    },
  );

  it("counts the people who have never answered, so there is a chase list", () => {
    // An opt-in league starts every week in this state, and a secretary needs
    // to know how much of the grid is a real answer before reading it.
    expect(html("opt-in")).toMatch(/1 player has never answered/);
  });
});
