import { describe, it, expect } from "vitest";
import {
  ATTENDANCE_MODES,
  ATTENDANCE_MODE_LABEL,
  ATTENDANCE_MODE_HELP,
  isAttendanceMode,
  defaultStatus,
  effectiveStatus,
  playerMayChange,
  resolveAttendance,
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
  it("describes all three and rejects anything else", () => {
    expect(ATTENDANCE_MODES).toHaveLength(3);
    for (const m of ATTENDANCE_MODES) {
      expect(isAttendanceMode(m), m).toBe(true);
      expect(ATTENDANCE_MODE_LABEL[m], m).toBeTruthy();
      expect(ATTENDANCE_MODE_HELP[m].length, m).toBeGreaterThan(30);
    }
    expect(isAttendanceMode("maybe")).toBe(false);
    expect(isAttendanceMode("")).toBe(false);
  });
});
