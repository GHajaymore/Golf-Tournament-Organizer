import { describe, it, expect } from "vitest";
import { GROUP_MOST, groupLeftShort, groupsWithRoom, lastTeeTime, placeInGroup, undrawnOn, type TeeSheet } from "../tee-sheet";
import { clubToday, clubWallClock } from "../club-clock";

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
