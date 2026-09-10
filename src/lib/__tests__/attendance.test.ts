import { describe, it, expect } from "vitest";
import {
  ATTENDANCE_MODES,
  ATTENDANCE_MODE_LABEL,
  ATTENDANCE_MODE_HELP,
  isAttendanceMode,
  defaultStatus,
  effectiveStatus,
  playerMayChange,
  playersAnswer,
  resolveAttendance,
  tracksPerRound,
  weekReturnsNote,
  attendanceModeChange,
} from "../domain/attendance";

/**
 * League attendance.
 *
 * The property everything hangs on: silence resolves to the mode's default,
 * and only explicit choices are stored — so "by default you're in" is
 * literally true, and changing the league's mode never rewrites anyone's
 * stated answer.
 */

describe("what silence means", () => {
  it("is in for an opt-out league and out for an opt-in one", () => {
    expect(defaultStatus("opt-out")).toBe("in");
    expect(defaultStatus("opt-in")).toBe("out");
    expect(defaultStatus("everyone")).toBe("in");
  });

  it("never overrides a stated answer", () => {
    expect(effectiveStatus("opt-out", "out")).toBe("out");
    expect(effectiveStatus("opt-in", "in")).toBe("in");
  });

  it("resolves silence to the default", () => {
    expect(effectiveStatus("opt-out", null)).toBe("in");
    expect(effectiveStatus("opt-in", undefined)).toBe("out");
  });
});

describe("the opt deadline", () => {
  it("keeps the window open through the deadline day itself", () => {
    // "Opt out by the 14th" means all of the 14th — the same inclusive
    // reading as every other deadline in the app.
    expect(playerMayChange("2026-08-14", new Date("2026-08-14T23:00:00"))).toBe(true);
    expect(playerMayChange("2026-08-14", new Date("2026-08-15T00:01:00"))).toBe(false);
  });

  it("stays open with no deadline set", () => {
    expect(playerMayChange("", new Date("2099-01-01"))).toBe(true);
  });

  it("does not close on free-text it cannot read", () => {
    // A deadline nobody set must not lock anyone out.
    expect(playerMayChange("next tuesday", new Date("2099-01-01"))).toBe(true);
  });
});

describe("resolving a field for one round", () => {
  const field = ["a", "b", "c", "d"];

  it("counts explicit and defaulted separately", () => {
    // Sixteen confirmed and eight silent is a different Wednesday from
    // twenty-four confirmed — the organizer needs both numbers.
    const s = resolveAttendance("opt-out", field, [
      { playerId: "a", status: "out", decidedBy: "a" },
      { playerId: "b", status: "in", decidedBy: "b" },
    ]);
    expect(s.in).toBe(3);
    expect(s.out).toBe(1);
    expect(s.inByDefault).toBe(2); // c and d, silent
  });

  it("flips the silent majority when the mode is opt-in", () => {
    const s = resolveAttendance("opt-in", field, [{ playerId: "a", status: "in", decidedBy: "a" }]);
    expect(s.in).toBe(1);
    expect(s.out).toBe(3);
    expect(s.inByDefault).toBe(0);
  });

  it("records who decided, for the player who asks why", () => {
    const s = resolveAttendance("opt-out", field, [
      { playerId: "a", status: "out", decidedBy: "Committee (R. Ferris)" },
    ]);
    expect(s.rows.find((r) => r.playerId === "a")).toMatchObject({
      status: "out",
      explicit: true,
      decidedBy: "Committee (R. Ferris)",
    });
  });

  it("ignores a stored status it does not recognise", () => {
    const s = resolveAttendance("opt-out", field, [{ playerId: "a", status: "maybe", decidedBy: "a" }]);
    expect(s.rows.find((r) => r.playerId === "a")).toMatchObject({ status: "in", explicit: false });
  });
});

describe("the modes on offer", () => {
  it("describes every one and rejects anything else", () => {
    expect(ATTENDANCE_MODES).toHaveLength(4);
    for (const m of ATTENDANCE_MODES) {
      expect(isAttendanceMode(m), m).toBe(true);
      expect(ATTENDANCE_MODE_LABEL[m], m).toBeTruthy();
      expect(ATTENDANCE_MODE_HELP[m].length, m).toBeGreaterThan(30);
    }
    expect(isAttendanceMode("maybe")).toBe(false);
    expect(isAttendanceMode("")).toBe(false);
  });
});

describe("captains send the list and the club enters it", () => {
  /**
   * The inter-club and pairs-league pattern: the captain owns the selection,
   * the club owns the sheet. The captain uses whatever they already use — a
   * WhatsApp message on Tuesday night — and staff type it in.
   */
  it("asks nobody in the app", () => {
    expect(playersAnswer("captains")).toBe(false);
    // ...unlike the two modes where the player answers on their own phone.
    expect(playersAnswer("opt-in")).toBe(true);
    expect(playersAnswer("opt-out")).toBe(true);
    // And `everyone` asks nobody either, because there is no question.
    expect(playersAnswer("everyone")).toBe(false);
  });

  it("still tracks a per-round field, unlike everyone", () => {
    // The distinction that made this mode possible. `mode !== "everyone"` used
    // to answer BOTH questions in four places; under captains they differ.
    expect(tracksPerRound("captains")).toBe(true);
    expect(tracksPerRound("opt-in")).toBe(true);
    expect(tracksPerRound("opt-out")).toBe(true);
    expect(tracksPerRound("everyone")).toBe(false);
  });

  it("assumes nobody is playing until a captain's list says so", () => {
    // A tee sheet that assumed a silent player in would invent a pairing the
    // captain never sent.
    expect(defaultStatus("captains")).toBe("out");
  });

  it("counts only the players staff have entered", () => {
    const s = resolveAttendance("captains", ["a", "b", "c"], [
      { playerId: "a", status: "in", decidedBy: "Club office" },
      { playerId: "b", status: "in", decidedBy: "Club office" },
    ]);
    expect(s.in).toBe(2);
    expect(s.out).toBe(1);
    // Nobody is ever "in by default" here — that number is the organizer's
    // uncertainty about silence, and under captains silence means out.
    expect(s.inByDefault).toBe(0);
  });

  it("records who entered it, because 'why am I not playing' needs a name", () => {
    const s = resolveAttendance("captains", ["a"], [
      { playerId: "a", status: "in", decidedBy: "Club office" },
    ]);
    expect(s.rows[0]).toMatchObject({ status: "in", explicit: true, decidedBy: "Club office" });
  });

  it("leaves the other modes exactly as they were", () => {
    // Adding a mode must not move anybody else's default.
    expect(defaultStatus("everyone")).toBe("in");
    expect(defaultStatus("opt-out")).toBe("in");
    expect(defaultStatus("opt-in")).toBe("out");
  });
});

/**
 * "16 played" was the same sentence on two different nights.
 *
 * The week sheet dropped anybody who did not play — right for the ranking,
 * and silent about whether the night was FINISHED. Sixteen rows on a week
 * eighteen were in for is two cards outstanding and somebody to ring;
 * sixteen rows on a week sixteen were in for is done, and the sheet looked
 * identical either way.
 */
describe("what the week's card count says", () => {
  it("names the cards still to come", () => {
    const s = weekReturnsNote({ expected: 18, returned: 16, out: 6 });
    expect(s).toContain("16 of 18");
    expect(s).toContain("2 still to come");
    expect(s).toContain("6 out this week");
  });

  it("stops saying it the moment the last card is in", () => {
    const s = weekReturnsNote({ expected: 18, returned: 18, out: 6 });
    expect(s).toContain("18 of 18");
    expect(s).not.toContain("still to come");
  });

  it("says nothing about absentees when there are none", () => {
    // "16 of 16 · 0 out" puts a nought on the screen for a fact nobody asked.
    const s = weekReturnsNote({ expected: 16, returned: 16, out: 0 });
    expect(s).not.toContain("out");
    expect(s).toContain("16 of 16");
  });

  it("reads as a week not yet filled rather than a week nobody played", () => {
    // Under captains before the captains' lists arrive, and under opt-in
    // before anybody signs up, this is the ordinary state of a future week.
    expect(weekReturnsNote({ expected: 0, returned: 0, out: 0 })).toMatch(/Nobody is in for this round yet/);
    expect(weekReturnsNote({ expected: 0, returned: 0, out: 4 })).toContain("4 out");
  });

  it("cannot report more cards in than were expected", () => {
    // A walk-up's card is deliberately still recorded — see the entry picker —
    // but they were not among the expected, so they must not push the count
    // past the total or produce a negative "still to come".
    const s = weekReturnsNote({ expected: 4, returned: 5, out: 1 });
    expect(s).not.toContain("-1");
    expect(s).not.toContain("still to come");
  });
});

/**
 * The switch that empties every tee sheet, and said nothing.
 *
 * Only explicit choices are stored, which is what makes "by default you're in"
 * true for forty players without forty rows — and it is what makes this switch
 * quietly enormous. A silent player's status is derived from the mode at read
 * time, so moving an opt-out league to opt-in or captains turns everyone who
 * has never touched the app from IN to OUT, for every round, the moment Save
 * is pressed.
 */
describe("changing the weekly sign-up mode", () => {
  it("warns when everybody silent is about to become out", () => {
    for (const to of ["opt-in", "captains"] as const) {
      const s = attendanceModeChange("opt-out", to);
      expect(s, to).toMatch(/in to OUT/);
      expect(s, to).toMatch(/tee sheet will be empty/i);
      // The organizer's first fear, answered: stored answers survive, because
      // resolveAttendance prefers an explicit row over the default in every
      // mode.
      expect(s, to).toMatch(/Answers already given are kept/);
    }
  });

  it("warns the other way too, which is the same surprise reversed", () => {
    for (const from of ["opt-in", "captains"] as const) {
      expect(attendanceModeChange(from, "opt-out")).toMatch(/out to IN/);
    }
  });

  it("says nothing when the switch moves nobody", () => {
    // opt-in and captains both read silence as out, so nobody's status
    // changes. Warning here would be crying wolf on the one screen where a
    // warning has to mean something.
    expect(attendanceModeChange("opt-in", "captains")).toBeNull();
    expect(attendanceModeChange("captains", "opt-in")).toBeNull();
    for (const m of ATTENDANCE_MODES) expect(attendanceModeChange(m, m)).toBeNull();
  });

  it("describes switching the question off as the question disappearing", () => {
    // Not a change of default: there is no default any more, because nobody is
    // asked and nobody is left out.
    const s = attendanceModeChange("opt-in", "everyone");
    expect(s).toMatch(/every confirmed player will be in every round/i);
    expect(s).toMatch(/come back if you turn it on again/i);
  });

  it("describes switching it on by what happens today", () => {
    // From `everyone`, nobody has ever answered anything — so opt-out moves
    // nobody and opt-in empties the sheet, and those read differently.
    expect(attendanceModeChange("everyone", "opt-out")).toMatch(/Nothing moves today/);
    expect(attendanceModeChange("everyone", "opt-in")).toMatch(/Tee sheets stay empty/);
    expect(attendanceModeChange("everyone", "captains")).toMatch(/until you record it/);
  });

  it("has something to say about every switch that moves somebody", () => {
    /**
     * Swept from the modes rather than hand-listed, so a mode added later is
     * covered the day it is added. The rule the sweep asserts: a pair whose
     * default status differs must produce a sentence, and a pair whose default
     * matches must not — with `everyone` exempt in both directions, because
     * "no question at all" is not a default and gets its own wording.
     */
    for (const from of ATTENDANCE_MODES) {
      for (const to of ATTENDANCE_MODES) {
        const s = attendanceModeChange(from, to);
        if (from === to) {
          expect(s, `${from}->${to}`).toBeNull();
        } else if (from === "everyone" || to === "everyone") {
          expect(s, `${from}->${to}`).toBeTruthy();
        } else if (defaultStatus(from) === defaultStatus(to)) {
          expect(s, `${from}->${to}`).toBeNull();
        } else {
          expect(s, `${from}->${to}`).toBeTruthy();
        }
      }
    }
  });
});
