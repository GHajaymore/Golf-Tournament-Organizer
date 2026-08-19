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
