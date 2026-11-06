import { describe, it, expect } from "vitest";
import { GROUP_MOST, groupLeftShort, groupsWithRoom, lastTeeTime, markTeedOff, placeInGroup, shortGroupLine, teedOffCaution, undrawnOn, type TeeSheet } from "../tee-sheet";
import { clubToday, clubWallClock } from "../club-clock";
import { teeTimeNotices } from "../tee-time-notice";

/**
 * PUTTING ONE NAMED PLAYER INTO A GROUP WITH ROOM (day-of field changes, PR B).
 *
 * The office practice, worked here by hand: after the draw is out, a late
 * entry or a reserve is written into a group that has room. Nobody else moves,
 * nobody's time changes, and nobody goes out as a five-ball — a group in stroke
 * play is two, three or four (the draw's own sizes). A player who has left the
 * field leaves a place in their group, though their name stays in the stored
 * sheet; a placed player is moved only by a re-draw.
 */

const sheet = (): TeeSheet => ({
  savedAt: "2026-11-28T18:00:00.000Z",
  startType: "tee",
  groups: [
    { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: ["a", "b", "c", "d"] },
    { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: ["e", "f", "g"] },
    { name: "Group 3", startHole: 1, time: "8:20 AM", playerIds: ["h", "i", "j", "k"] },
  ],
});
const FIELD = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "late"];

describe("groupsWithRoom", () => {
  it("offers a group short of four, not a full one", () => {
    const rooms = groupsWithRoom(sheet(), new Set(FIELD));
    expect(rooms.map((g) => [g.index, g.name, g.time, g.players])).toEqual([[1, "Group 2", "8:10 AM", 3]]);
  });

  it("a withdrawn player's place is room, though their id stays on the sheet", () => {
    const field = new Set(FIELD.filter((id) => id !== "j"));
    expect(groupsWithRoom(sheet(), field).map((g) => g.name)).toEqual(["Group 2", "Group 3"]);
    expect(groupsWithRoom(sheet(), field).find((g) => g.name === "Group 3")?.players).toBe(3);
  });

  it("four is the most a group takes", () => {
    expect(GROUP_MOST).toBe(4);
  });
});

describe("placeInGroup", () => {
  it("adds the one player to the one group and moves nobody else", () => {
    const before = sheet();
    const r = placeInGroup(before, "late", 1, new Set(FIELD));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.group).toEqual({ name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: ["e", "f", "g", "late"] });
    expect(r.sheet.groups[0]).toEqual(before.groups[0]);
    expect(r.sheet.groups[2]).toEqual(before.groups[2]);
    expect(r.sheet.savedAt).toBe(before.savedAt);
    // The sheet it was given is left as it was.
    expect(before.groups[1].playerIds).toEqual(["e", "f", "g"]);
  });

  it("on a published sheet only the placed player is told their time (the guide says so)", () => {
    const before = sheet();
    const r = placeInGroup(before, "late", 1, new Set(FIELD));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(teeTimeNotices(before, r.sheet, false)).toEqual([{ playerId: "late", kind: "new", time: "8:10 AM", startHole: 1 }]);
  });

  it("into the place a withdrawal left", () => {
    const field = new Set(FIELD.filter((id) => id !== "j"));
    const r = placeInGroup(sheet(), "late", 2, field);
    expect(r.ok && r.group.playerIds).toEqual(["h", "i", "j", "k", "late"]);
  });

  it("refuses a full group, a player already drawn, a player outside the field and a group not on the sheet", () => {
    const says = (r: ReturnType<typeof placeInGroup>) => (r.ok ? "" : r.says);
    expect(says(placeInGroup(sheet(), "late", 0, new Set(FIELD)))).toBe("Group 1 is full. Choose a group with room.");
    expect(says(placeInGroup(sheet(), "a", 1, new Set(FIELD)))).toBe("They are already in Group 1. To move them, re-draw the sheet.");
    expect(says(placeInGroup(sheet(), "stranger", 1, new Set(FIELD)))).toBe("That player isn’t in this round’s field.");
    expect(says(placeInGroup(sheet(), "late", 7, new Set(FIELD)))).toBe("That group isn’t on the sheet.");
    expect(says(placeInGroup(sheet(), "late", 1.5, new Set(FIELD)))).toBe("That group isn’t on the sheet.");
    expect(says(placeInGroup(sheet(), "late", -1, new Set(FIELD)))).toBe("That group isn’t on the sheet.");
  });
});

describe("undrawnOn", () => {
  it("is the field the sheet places nowhere, in the field's order", () => {
    expect(undrawnOn(sheet(), FIELD)).toEqual(["late"]);
    expect(undrawnOn(sheet(), ["late", "a", "reserve"])).toEqual(["late", "reserve"]);
  });
});

describe("lastTeeTime", () => {
  it("is the latest time on the sheet, as written, whatever the order of the groups", () => {
    const s = sheet();
    s.groups.reverse();
    expect(lastTeeTime(s)).toBe("8:20 AM");
  });

  it("reads a 24-hour sheet and the afternoon", () => {
    const s: TeeSheet = { savedAt: "", startType: "tee", groups: [
      { name: "Group 1", startHole: 1, time: "12:50", playerIds: ["a"] },
      { name: "Group 2", startHole: 1, time: "13:05", playerIds: ["b"] },
      { name: "Group 3", startHole: 10, time: "9:30", playerIds: ["c"] },
    ] };
    expect(lastTeeTime(s)).toBe("13:05");
    const ampm: TeeSheet = { ...s, groups: [{ ...s.groups[0], time: "12:45 PM" }, { ...s.groups[1], time: "1:05 PM" }, { ...s.groups[2], time: "11:55 AM" }] };
    expect(lastTeeTime(ampm)).toBe("1:05 PM");
  });

  it("a shotgun's one time is its last; a sheet with no time to read has none", () => {
    const shotgun: TeeSheet = { savedAt: "", startType: "shotgun", groups: [
      { name: "Group 1", startHole: 1, time: "9:00 AM", playerIds: ["a"] },
      { name: "Group 2", startHole: 2, time: "9:00 AM", playerIds: ["b"] },
    ] };
    expect(lastTeeTime(shotgun)).toBe("9:00 AM");
    expect(lastTeeTime({ ...shotgun, groups: shotgun.groups.map((g) => ({ ...g, time: "" })) })).toBeNull();
  });
});

describe("groupLeftShort", () => {
  it("names the group a withdrawal leaves short and how many are left", () => {
    const after = new Set(FIELD.filter((id) => id !== "e"));
    expect(groupLeftShort(sheet(), "e", after)).toEqual({ name: "Group 2", left: 2 });
    expect(groupLeftShort(sheet(), "a", new Set(FIELD.filter((id) => id !== "a")))).toEqual({ name: "Group 1", left: 3 });
    expect(groupLeftShort(sheet(), "late", new Set(FIELD))).toBeNull();
  });
});

/**
 * WHICH GROUPS ARE ALREADY OUT (panel review of #1029, must-fix 1), worked by
 * hand from the sheet's times: at 8:10 on the round's day the 8:00 group and
 * the 8:10 group are on the course (a group goes at its time, Rule 5.3a) and
 * the 8:20 group is not; the day before nobody is; the day after everybody is.
 */
describe("markTeedOff", () => {
  const rooms = () => groupsWithRoom(sheet(), new Set(FIELD.filter((id) => !["d", "j"].includes(id))));
  const out = (now: { day: string; minutes: number }, day = "2026-11-29") =>
    markTeedOff(rooms(), day, now).map((g) => `${g.name}${g.teedOff ? " (out)" : ""}`);

  it("marks the groups whose time has come on the round's day, and lists them last", () => {
    expect(out({ day: "2026-11-29", minutes: 8 * 60 + 10 })).toEqual(["Group 3", "Group 1 (out)", "Group 2 (out)"]);
    expect(out({ day: "2026-11-29", minutes: 8 * 60 + 9 })).toEqual(["Group 2", "Group 3", "Group 1 (out)"]);
  });

  it("the day before nobody is out; the day after everybody is; no day marks nobody", () => {
    expect(out({ day: "2026-11-28", minutes: 23 * 60 })).toEqual(["Group 1", "Group 2", "Group 3"]);
    expect(out({ day: "2026-11-30", minutes: 0 })).toEqual(["Group 1 (out)", "Group 2 (out)", "Group 3 (out)"]);
    expect(out({ day: "2026-11-29", minutes: 23 * 60 }, "")).toEqual(["Group 1", "Group 2", "Group 3"]);
  });

  it("a group already out says so in one caution, and the Committee decides", () => {
    expect(teedOffCaution({ name: "Group 2", time: "8:10 AM" })).toBe("Group 2 teed off at 8:10 AM. The Committee decides if a late arrival may join.");
  });
});

describe("shortGroupLine", () => {
  const us = { groupOfTwo: "twosome", groupOfThree: "threesome" };
  it("says what a withdrawal leaves, in the club's words, and nothing for a group still four strong", () => {
    expect(shortGroupLine("", { name: "Group 3", left: 2 }, us)).toBe("Group 3 goes out as a twosome. Leave it, or put someone in on the Tee sheet.");
    expect(shortGroupLine("Round 2", { name: "Group 3", left: 3 }, { groupOfTwo: "two-ball", groupOfThree: "three-ball" })).toBe(
      "Round 2, Group 3 goes out as a three-ball. Leave it, or put someone in on the Tee sheet.",
    );
    expect(shortGroupLine("", { name: "Group 3", left: 1 }, us)).toBe("Group 3 goes out with one player. Leave it, or put someone in on the Tee sheet.");
    expect(shortGroupLine("", { name: "Group 3", left: 0 }, us)).toBe("Group 3 has nobody left in it. Leave it, or put someone in on the Tee sheet.");
    expect(shortGroupLine("", { name: "Group 3", left: 4 }, us)).toBeNull();
  });
});

/**
 * THE CLUB'S WALL CLOCK: the day and the minutes past midnight AT THE CLUB.
 * Worked from fixed instants and two zones on opposite sides of UTC, by hand:
 * 2026-11-29 15:40 UTC is 10:40 in New York (UTC−5 in November) and 04:40 the
 * next day in Auckland (UTC+13 in November).
 */
describe("clubWallClock", () => {
  const at = new Date("2026-11-29T15:40:00.000Z");
  it("is the club's day and the minutes on the club's wall", () => {
    expect(clubWallClock("America/New_York", at)).toEqual({ day: "2026-11-29", minutes: 10 * 60 + 40 });
    expect(clubWallClock("Pacific/Auckland", at)).toEqual({ day: "2026-11-30", minutes: 4 * 60 + 40 });
  });
  it("its day is always clubToday's", () => {
    for (const zone of ["America/New_York", "Pacific/Auckland", "Europe/London", "", "Not/AZone"]) {
      expect(clubWallClock(zone, at).day, zone).toBe(clubToday(zone, at));
    }
  });
  it("a club that has not said where it is keeps this machine's clock", () => {
    expect(clubWallClock("", at).minutes).toBe(at.getHours() * 60 + at.getMinutes());
  });
});
