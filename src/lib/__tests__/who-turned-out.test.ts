import { describe, it, expect } from "vitest";
import { attendanceCsvRows, type AttendanceReport } from "@/lib/services/attendance-report";
import { resolveAttendance, ATTENDANCE_MODES, tracksPerRound } from "@/lib/domain/attendance";

/**
 * WHO TURNED OUT, AND WHAT THE SHEET IS ALLOWED TO CLAIM.
 *
 * Ajay, 2026-09-21: "build the report of opt in/out."
 *
 * The thing this report exists to preserve is the distinction between a stated
 * answer and a default. `resolveAttendance` carries it — "in" and "in because
 * nobody said otherwise" are different facts, and sixteen confirmed with eight
 * silent is a different Wednesday from twenty-four confirmed. A report is
 * exactly where that gets flattened, because a spreadsheet cell wants one
 * word, and this is the sheet a club reads when deciding who is still a
 * regular. So the CSV is asserted to keep it.
 *
 * The grid itself is a server component with no logic worth testing that the
 * service does not already own; what is pinned here is the EXPORT, which is
 * the artefact that leaves the app and gets mailed round a committee.
 */

const cell = (status: "in" | "out", explicit: boolean, decidedBy = "") => ({ status, explicit, decidedBy });

const report = (over: Partial<AttendanceReport> = {}): AttendanceReport => ({
  tracked: true,
  mode: "opt-out",
  modeLabel: "In unless they opt out",
  playersAnswerThemselves: true,
  rounds: [
    { stageId: "s1", label: "Round 1", playedOn: "2026-05-07", dateLabel: "Thu 7 May", in: 2, out: 0, inByDefault: 1 },
    { stageId: "s2", label: "Round 2", playedOn: "2026-05-14", dateLabel: "Thu 14 May", in: 1, out: 1, inByDefault: 0 },
  ],
  rows: [
    {
      playerId: "p1",
      name: "Ann Doyle",
      cells: [cell("in", true, "Ann Doyle"), cell("out", true, "Ann Doyle")],
      inCount: 1,
      answered: 2,
    },
    {
      playerId: "p2",
      name: "Bob Ellery",
      cells: [cell("in", false), cell("in", true, "Staff")],
      inCount: 2,
      answered: 1,
    },
  ],
  neverAnswered: 0,
  ...over,
});

describe("the attendance export", () => {
  it("keeps a stated answer distinct from a default", () => {
    const rows = attendanceCsvRows(report());
    const ann = rows.find((r) => r[0] === "Ann Doyle")!;
    const bob = rows.find((r) => r[0] === "Bob Ellery")!;

    // Ann said both. Bob said nothing about round 1 and was recorded for round 2.
    expect(ann[1]).toBe("In");
    expect(ann[2]).toBe("Out");
    expect(bob[1]).toBe("In (default)");
    expect(bob[2]).toBe("In");
  });

  /**
   * The control. Flattening every cell to "In"/"Out" — which is what a
   * spreadsheet wants and what somebody will eventually "tidy" this into —
   * passes any check that only asks whether the cell says In. So this asserts
   * the two are DIFFERENT strings, which a flattening cannot satisfy.
   */
  it("does not let a default read as somebody's word", () => {
    const rows = attendanceCsvRows(report());
    const ann = rows.find((r) => r[0] === "Ann Doyle")!;
    const bob = rows.find((r) => r[0] === "Bob Ellery")!;
    expect(bob[1]).not.toBe(ann[1]);
  });

  it("names each round and its date in the header", () => {
    const [head] = attendanceCsvRows(report());
    expect(head[0]).toBe("Player");
    expect(head[1]).toBe("Round 1 (Thu 7 May)");
    expect(head[2]).toBe("Round 2 (Thu 14 May)");
    expect(head.slice(-2)).toEqual(["Rounds in", "Answered"]);
  });

  it("carries a round with no date without inventing one", () => {
    const r = report({
      rounds: [{ stageId: "s1", label: "Round 1", playedOn: "", dateLabel: "", in: 1, out: 0, inByDefault: 0 }],
      rows: [{ playerId: "p1", name: "Ann Doyle", cells: [cell("in", true)], inCount: 1, answered: 1 }],
    });
    expect(attendanceCsvRows(r)[0][1]).toBe("Round 1");
  });

  it("puts the per-round totals on the sheet rather than leaving them to a formula", () => {
    const rows = attendanceCsvRows(report());
    const totals = rows[rows.length - 1];
    expect(totals[0]).toBe("In this round");
    expect(totals[1]).toBe("2");
    expect(totals[2]).toBe("1");
  });

  it("counts the rounds a player was in, and the ones they answered, separately", () => {
    const rows = attendanceCsvRows(report());
    const bob = rows.find((r) => r[0] === "Bob Ellery")!;
    // In for both, answered one. Collapsing these two into one number is how a
    // club comes to think a silent member confirmed.
    expect(bob.slice(-2)).toEqual(["2", "1"]);
  });
});

describe("the report knows when there is nothing to report", () => {
  it("is untracked for exactly the mode with no weekly question", () => {
    // `everyone` is the feature switched off. The other three all record
    // something, so all three have a report worth printing — including
    // `captains`, where the club records what the captain sent.
    for (const mode of ATTENDANCE_MODES) {
      expect(tracksPerRound(mode)).toBe(mode !== "everyone");
    }
  });

  it("exports nothing but a header when a tournament has no rounds", () => {
    const r = report({ rounds: [], rows: [] });
    const rows = attendanceCsvRows(r);
    expect(rows[0]).toEqual(["Player", "Rounds in", "Answered"]);
    expect(rows).toHaveLength(2); // header and the totals line
  });
});

describe("the grid and the weekly control read one answer", () => {
  /**
   * The report must not become a second opinion about who was in.
   *
   * Both go through `resolveAttendance`, so this asserts the behaviour the
   * report depends on rather than re-implementing it: an explicit row wins
   * over the mode's default, in every mode, and silence resolves to the
   * mode's own answer. If that ever changed, the report and the tee sheet
   * would disagree about the same Thursday.
   */
  it("prefers a stated answer over the default in every mode", () => {
    for (const mode of ATTENDANCE_MODES) {
      if (!tracksPerRound(mode)) continue;
      const out = resolveAttendance(mode, ["p1", "p2"], [
        { playerId: "p1", status: "out", decidedBy: "Ann" },
      ]);
      const p1 = out.rows.find((r) => r.playerId === "p1")!;
      const p2 = out.rows.find((r) => r.playerId === "p2")!;
      expect(p1.status, `${mode}: a stated OUT must survive`).toBe("out");
      expect(p1.explicit).toBe(true);
      expect(p2.explicit, `${mode}: silence is not an answer`).toBe(false);
    }
  });
});
