import { describe, expect, it } from "vitest";
import type { TeeSheet } from "../tee-sheet";
import { teeTimeNotices } from "../tee-time-notice";
import { applyMove, applyMoves, emptiedGroups, groupStep, moveKindsOf, moveModeOf, playerMoveOptions, removalLines, settleSheet, shortGroupWarnings, slotLocks } from "../tee-sheet-moves";
import { readSource } from "../../__tests__/source";

/**
 * Expected values are worked by hand from the sheet below, not from the code:
 *
 *   slot 0  Group 1  8:00 AM  hole 1   a b c d     (full)
 *   slot 1  Group 2  8:10 AM  hole 1   e f g       (three)
 *   slot 2  Group 3  8:20 AM  hole 1   h i         (two)
 *   slot 3  Group 4  8:30 AM  hole 1   j k l m     (full)
 */
const sheet: TeeSheet = {
  savedAt: "2026-11-11T07:00:00.000Z",
  startType: "tee",
  groups: [
    { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: ["a", "b", "c", "d"] },
    { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: ["e", "f", "g"] },
    { name: "Group 3", startHole: 1, time: "8:20 AM", playerIds: ["h", "i"] },
    { name: "Group 4", startHole: 1, time: "8:30 AM", playerIds: ["j", "k", "l", "m"] },
  ],
};
const field = new Set("abcdefghijklm".split(""));
const ids = (s: TeeSheet) => s.groups.map((g) => g.playerIds.join(""));
const times = (s: TeeSheet) => s.groups.map((g) => `${g.time}@${g.startHole}${g.half ?? ""}`);
const ok = (r: ReturnType<typeof applyMove>) => {
  if (!r.ok) throw new Error(r.says);
  return r.sheet;
};

describe("moving one player", () => {
  it("takes the player out of one group and into another; nobody else moves; every time stays", () => {
    const next = ok(applyMove(sheet, { kind: "player", playerId: "a", toGroup: 2 }, field, {}));
    expect(ids(next)).toEqual(["bcd", "efg", "hia", "jklm"]);
    expect(times(next)).toEqual(times(sheet));
  });

  it("refuses a fifth player into a full group, in words naming the group", () => {
    const r = applyMove(sheet, { kind: "player", playerId: "e", toGroup: 0 }, field, {});
    expect(r).toEqual({ ok: false, says: "Group 1 is full. Choose a group with room." });
  });

  it("counts only the field: a withdrawn id left in the stored group leaves a place", () => {
    const f = new Set([..."abcdefghijklm"].filter((x) => x !== "d"));
    expect(ok(applyMove(sheet, { kind: "player", playerId: "e", toGroup: 0 }, f, {})).groups[0].playerIds).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("moving the last player out is allowed: the group stays in the draft as an empty slot", () => {
    const one: TeeSheet = { ...sheet, groups: [{ ...sheet.groups[0], playerIds: ["a", "b"] }, { ...sheet.groups[1], playerIds: ["e"] }] };
    const next = ok(applyMove(one, { kind: "player", playerId: "e", toGroup: 0 }, field, {}));
    expect(ids(next)).toEqual(["abe", ""]);
    expect(removalLines(next, field, {})).toEqual(["Group 2 will be removed (no players left)."]);
  });

  it("refuses a player who is not on the sheet (they are put in a group first) and one outside the field", () => {
    expect(applyMove(sheet, { kind: "player", playerId: "z", toGroup: 0 }, field, {})).toMatchObject({ ok: false });
    expect(applyMove(sheet, { kind: "player", playerId: "e", toGroup: 9 }, field, {})).toMatchObject({ ok: false });
    expect(applyMove(sheet, { kind: "player", playerId: "a", toGroup: 1 }, new Set(["b"]), {})).toMatchObject({ ok: false });
  });

  it("a locked group refuses both leaving and joining, saying why", () => {
    const locks = { 1: "Group 2 teed off at 8:10." };
    expect(applyMove(sheet, { kind: "player", playerId: "f", toGroup: 2 }, field, locks)).toEqual({ ok: false, says: "Group 2 teed off at 8:10. Nobody moves out of it." });
    expect(applyMove(sheet, { kind: "player", playerId: "h", toGroup: 1 }, field, locks)).toEqual({ ok: false, says: "Group 2 teed off at 8:10. Nobody moves into it." });
  });

  it("lists the other groups for the select, the full and the begun disabled with their reason", () => {
    const o = playerMoveOptions(sheet, "e", field, { 2: "Group 3 has a card in." });
        expect(o.map((x) => [x.index, x.players, x.disabled ?? ""])).toEqual([
      [0, 4, "Group 1 is full."],
      [2, 2, "Group 3 has a card in."],
      [3, 4, "Group 4 is full."],
    ]);
  });
});

describe("moving a whole group: the players move, the times stay with the slots", () => {
  it("the third group goes first — two taps up — and the others slide down", () => {
    const one = ok(applyMove(sheet, { kind: "group", from: 2, to: 1 }, field, {}));
    expect(ids(one)).toEqual(["abcd", "hi", "efg", "jklm"]);
    const two = ok(applyMove(one, { kind: "group", from: 1, to: 0 }, field, {}));
    expect(ids(two)).toEqual(["hi", "abcd", "efg", "jklm"]);
    expect(times(two)).toEqual(["8:00 AM@1", "8:10 AM@1", "8:20 AM@1", "8:30 AM@1"]);
  });

  it("a shotgun slot carries its hole: the players take the hole of the slot they move to", () => {
    const gun: TeeSheet = {
      ...sheet,
      startType: "shotgun",
      groups: [
        { name: "Group 1", startHole: 1, half: "A", time: "", playerIds: ["a"] },
        { name: "Group 2", startHole: 1, half: "B", time: "", playerIds: ["b"] },
        { name: "Group 3", startHole: 4, time: "", playerIds: ["c"] },
      ],
    };
    const next = ok(applyMove(gun, { kind: "group", from: 2, to: 0 }, field, {}));
    expect(next.groups.map((g) => [g.startHole, g.half ?? "", g.playerIds.join("")])).toEqual([
      [1, "A", "c"],
      [1, "B", "a"],
      [4, "", "b"],
    ]);
  });

  it("a locked group stays where it is, and nothing moves into its place; others slide round it", () => {
    const locks = { 1: "Group 2 has a card in." };
    expect(applyMove(sheet, { kind: "group", from: 1, to: 3 }, field, locks)).toEqual({ ok: false, says: "Group 2 has a card in. It stays where it is." });
    expect(applyMove(sheet, { kind: "group", from: 3, to: 1 }, field, locks)).toEqual({ ok: false, says: "Group 2 has a card in. Nothing moves into its place." });
    // Group 4 to the front slides Group 1 and Group 3 down, skipping the locked slot 1.
    const next = ok(applyMove(sheet, { kind: "group", from: 3, to: 0 }, field, locks));
    expect(ids(next)).toEqual(["jklm", "efg", "abcd", "hi"]);
  });

  it("the arrows step to the nearest slot that is not locked, and stop at the ends", () => {
    const locks = { 1: "x" };
    expect(groupStep(sheet, locks, 2, -1)).toBe(0);
    expect(groupStep(sheet, locks, 0, 1)).toBe(2);
    expect(groupStep(sheet, locks, 0, -1)).toBeNull();
    expect(groupStep(sheet, locks, 3, 1)).toBeNull();
    expect(groupStep(sheet, locks, 1, 1)).toBeNull();
  });
});

describe("moving a whole side", () => {
  it("takes the pair together into a group with room for two", () => {
    const next = ok(applyMove(sheet, { kind: "side", playerIds: ["e", "f"], toGroup: 2 }, field, {}));
    expect(ids(next)).toEqual(["abcd", "g", "hief", "jklm"]);
  });
  it("refuses when the pair will not fit (two into a three); a pair that is its whole group may go (the group is then removed)", () => {
    expect(applyMove(sheet, { kind: "side", playerIds: ["h", "i"], toGroup: 1 }, field, {})).toMatchObject({ ok: false, says: "Group 2 has no room for 2. Choose a group with room." });
    expect(applyMove(sheet, { kind: "side", playerIds: ["h", "i"], toGroup: 0 }, field, {})).toMatchObject({ ok: false });
    const f = new Set(field);
    const two = { ...sheet, groups: [sheet.groups[0], { ...sheet.groups[1], playerIds: ["e", "f"] }, sheet.groups[2]] };
    expect(ids(ok(applyMove(two, { kind: "side", playerIds: ["e", "f"], toGroup: 2 }, f, {})))).toEqual(["abcd", "", "hief"]);
  });
});

describe("a group the draft empties is removed on Save; the others keep their own times", () => {
  // Group 2 (8:10) holds two, who are moved into Group 1 and Group 3; Group 4 (8:30) then moves up into the freed slot.
  const four: TeeSheet = {
    ...sheet,
    groups: [
      { ...sheet.groups[0], playerIds: ["a", "b", "c"] },
      { ...sheet.groups[1], playerIds: ["e", "f"] },
      { ...sheet.groups[2], playerIds: ["h", "i", "j"] },
      { ...sheet.groups[3], playerIds: ["k", "l"] },
    ],
  };
  const emptied = ok(applyMoves(four, [{ kind: "player", playerId: "e", toGroup: 0 }, { kind: "player", playerId: "f", toGroup: 2 }], field, {}));

  it("two players moved out empty their group: it is removed, the rest keep 8:00, 8:20, 8:30 and are renumbered", () => {
    expect(ids(emptied)).toEqual(["abce", "", "hijf", "kl"]);
    expect(emptiedGroups(emptied, field, {})).toEqual([1]);
    const s = settleSheet(emptied, field, {});
    expect(s.removed).toEqual(["Group 2"]);
    expect(ids(s.sheet)).toEqual(["abce", "hijf", "kl"]);
    expect(times(s.sheet)).toEqual(["8:00 AM@1", "8:20 AM@1", "8:30 AM@1"]);
    expect(s.sheet.groups.map((g) => g.name)).toEqual(["Group 1", "Group 2", "Group 3"]);
  });

  it("then a later group moved up into the freed slot takes that slot's time (8:10), and the last slot goes", () => {
    const up = ok(applyMove(emptied, { kind: "group", from: 3, to: 1 }, field, {}));
    expect(ids(up)).toEqual(["abce", "kl", "hijf", ""]);
    const s = settleSheet(up, field, {});
    expect(ids(s.sheet)).toEqual(["abce", "kl", "hijf"]);
    expect(times(s.sheet)).toEqual(["8:00 AM@1", "8:10 AM@1", "8:20 AM@1"]);
  });

  it("a locked group is never emptied or removed, even when none of its players are in the field", () => {
    const f = new Set([..."abcdefghijklm"].filter((x) => x !== "k" && x !== "l"));
    expect(emptiedGroups(four, f, {})).toEqual([3]);
    expect(emptiedGroups(four, f, { 3: "Group 4 has a card in." })).toEqual([]);
    expect(settleSheet(four, f, { 3: "Group 4 has a card in." }).removed).toEqual([]);
  });

  it("players marked out of the field do not count: a group of two out-players is empty", () => {
    const f = new Set([..."abcdefghijklm"].filter((x) => x !== "e" && x !== "f"));
    expect(emptiedGroups(four, f, {})).toEqual([1]);
    expect(shortGroupWarnings(four, f, { groupOfTwo: "two-ball", groupOfThree: "three-ball" })).toEqual(["Group 1 goes out as a three-ball.", "Group 3 goes out as a three-ball.", "Group 4 goes out as a two-ball."]);
  });
});

describe("the draft", () => {
  it("replays several moves in order, and stops at the first refused", () => {
    const r = applyMoves(
      sheet,
      [
        { kind: "player", playerId: "a", toGroup: 2 },
        { kind: "group", from: 2, to: 0 },
      ],
      field,
      {},
    );
    expect(r.ok && ids(r.sheet)).toEqual(["hia", "bcd", "efg", "jklm"]);
    const bad = applyMoves(sheet, [{ kind: "group", from: 2, to: 0 }, { kind: "player", playerId: "e", toGroup: 1 + 2 }], field, {});
    expect(bad).toEqual({ ok: false, says: "Group 4 is full. Choose a group with room." });
  });

  it("warns for every group left short, in the club's words", () => {
    const next = ok(applyMove(sheet, { kind: "player", playerId: "a", toGroup: 2 }, field, {}));
    expect(shortGroupWarnings(next, field, { groupOfTwo: "two-ball", groupOfThree: "three-ball" })).toEqual(["Group 1 goes out as a three-ball.", "Group 2 goes out as a three-ball.", "Group 3 goes out as a three-ball."]);
    expect(shortGroupWarnings(sheet, field, { groupOfTwo: "twosome", groupOfThree: "threesome" })).toEqual(["Group 2 goes out as a threesome.", "Group 3 goes out as a twosome."]);
  });

  it("tells only the players whose time changed, once: a player moved and a group moved", () => {
    const next = ok(applyMove(sheet, { kind: "player", playerId: "a", toGroup: 2 }, field, {}));
    expect(teeTimeNotices(sheet, next, false).map((n) => [n.playerId, n.kind, n.time])).toEqual([["a", "changed", "8:20 AM"]]);
    const swapped = ok(applyMove(sheet, { kind: "group", from: 2, to: 1 }, field, {}));
    expect(teeTimeNotices(sheet, swapped, false).map((n) => n.playerId).sort()).toEqual(["e", "f", "g", "h", "i"]);
  });
});

describe("which slots have begun — told the club's day and wall clock", () => {
  const cards = new Set(["k"]);
  it("a group whose time has come on the round's day is teed off; a card in locks its group; nothing before the day", () => {
    const at = (day: string, minutes: number) => slotLocks(sheet, { roundDay: "2026-11-12", now: { day, minutes }, cardsIn: cards });
    expect(at("2026-11-12", 8 * 60 + 10)).toEqual({ 0: "Group 1 teed off at 8:00 AM.", 1: "Group 2 teed off at 8:10 AM.", 3: "Group 4 has a card in." });
    expect(at("2026-11-11", 23 * 60)).toEqual({ 3: "Group 4 has a card in." });
    expect(Object.keys(at("2026-11-13", 0))).toEqual(["0", "1", "2", "3"]);
  });
  it("no round day marks nobody teed off", () => {
    expect(slotLocks(sheet, { roundDay: "", now: { day: "2026-11-12", minutes: 900 }, cardsIn: new Set() })).toEqual({});
  });
});

describe("what may move in a round: the screen and the server are held to one answer", () => {
  it("individual stroke moves players; four-ball pairs move whole sides; singles match moves only whole groups", () => {
    const stroke = moveModeOf({ type: "Stroke Play Round", format: "Stroke Play" });
    const pairs = moveModeOf({ type: "Stroke Play Round", format: "Four-Ball" });
    const singles = moveModeOf({ type: "Single Match Stage", format: "Match Play" });
    expect([stroke, pairs, singles]).toEqual(["players", "sides", "groups"]);
    expect(moveKindsOf(stroke)).toEqual({ player: true, side: false, group: true });
    expect(moveKindsOf(pairs)).toEqual({ player: false, side: true, group: true });
    expect(moveKindsOf(singles)).toEqual({ player: false, side: false, group: true });
  });

  it("both ask the same function: the action refuses by moveKindsOf(moveModeOf), the screen draws by moveKindsOf(moveMode) of the page's moveModeOf", () => {
    const action = readSource("src", "app", "actions", "tee-sheet.ts");
    const screen = readSource("src", "components", "FoursomeMaker.tsx");
    const page = readSource("src", "app", "(app)", "foursomes", "page.tsx");
    expect(action).toMatch(/moveKindsOf\(mode\)/);
    expect(action).toMatch(/moveModeOf\(stage\)/);
    expect(screen).toMatch(/moveKindsOf\(moveMode\)\.player/);
    expect(screen).toMatch(/moveKindsOf\(moveMode\)\.side/);
    expect(page).toMatch(/moveMode=\{stage \? moveModeOf\(stage\)/);
  });

  it("CONTROL: the screen draws no player or side select from anything but the mode", () => {
    const screen = readSource("src", "components", "FoursomeMaker.tsx");
    expect(screen).not.toMatch(/moving && !bySides/);
    expect(screen).not.toMatch(/moving && bySides/);
  });
});

describe("the field of a sheet is one service's answer, asked by the page and by the move", () => {
  it("the page and both writers that count a group's room call sheetFieldFor, and none re-derives attendance", () => {
    const action = readSource("src", "app", "actions", "tee-sheet.ts");
    const page = readSource("src", "app", "(app)", "foursomes", "page.tsx");
    expect(action.match(/sheetFieldFor\(session\.eventId, stageId\)/g)?.length).toBe(2);
    expect(page).toMatch(/sheetFieldFor\(session\.eventId, stage\.id\)/);
    expect(page).not.toMatch(/resolveAttendance\(/);
  });
});
