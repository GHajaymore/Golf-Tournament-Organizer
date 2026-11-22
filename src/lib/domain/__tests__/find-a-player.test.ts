import { describe, it, expect } from "vitest";
import { findAPlayer, FIND_MAX_ROWS, type FindPlayer, type FindRound } from "../find-a-player";

/**
 * FIND A PLAYER (R9a): the seven states, worked from step 3 §2.2's table. Invented names only.
 */

const P = (id: string, name: string, status = "confirmed"): FindPlayer => ({ id, name, status });
const players: FindPlayer[] = [
  P("a", "Ana Whitlow"),
  P("b", "Bram Oakes"),
  P("c", "Cleo Whitley"),
  P("d", "Dov Withers", "withdrawn"),
  P("e", "Esme Dq", "disqualified"),
  P("f", "Finn Unplaced"),
];
const rounds: FindRound[] = [
  {
    id: "r1",
    label: "Round 1",
    published: true,
    groups: [
      { name: "Group 1", time: "8:00 AM", startHole: 1, playerIds: ["b", "d"] },
      { name: "Group 5", time: "9:20 AM", startHole: 10, playerIds: ["a", "c"] },
    ],
  },
  {
    id: "r2",
    label: "Round 2",
    published: true,
    groups: [{ name: "Group 5", time: "9:20 AM", startHole: 1, playerIds: ["a"] }],
  },
  { id: "r3", label: "Round 3", published: false, groups: [{ name: "Group 1", time: "8:00 AM", startHole: 1, playerIds: ["f"] }] },
];

describe("findAPlayer: its seven states", () => {
  it("empty: nothing typed says nothing", () => {
    expect(findAPlayer("", players, rounds, "r3")).toEqual({ state: "empty" });
    expect(findAPlayer("   ", players, rounds, "r3")).toEqual({ state: "empty" });
  });

  it("one letter: asks for two or more", () => {
    expect(findAPlayer("a", players, rounds, "r3")).toEqual({ state: "short", text: "Type two letters or more" });
  });

  it("found on a published sheet: one row per round she is drawn in, with group, time and tee", () => {
    const out = findAPlayer("ana", players, rounds, "r3");
    expect(out.state).toBe("found");
    if (out.state !== "found") return;
    expect(out.rows.map((r) => r.text)).toEqual([
      "Ana Whitlow · Round 1 · Group 5 · 9:20 · Tee 10",
      "Ana Whitlow · Round 2 · Group 5 · 9:20 · Tee 1",
    ]);
    expect(out.rows[1].href).toBe("/foursomes?round=r2#draw");
    expect(out.more).toBeNull();
  });

  it("entered but on no published sheet: says so, and opens the sheet that is not out", () => {
    const out = findAPlayer("finn", players, rounds, "r3");
    expect(out).toEqual({
      state: "unplaced",
      text: "Finn Unplaced is entered but not on a published sheet yet.",
      way: { says: "Open Round 3’s sheet", href: "/foursomes?round=r3" },
    });
  });

  it("withdrew or disqualified: says which, and goes to Entries; a stale name on a published sheet is not an answer", () => {
    expect(findAPlayer("withers", players, rounds, "r3")).toEqual({ state: "gone", text: "Dov Withers withdrew.", way: { says: "See Entries", href: "/registration" } });
    expect(findAPlayer("esme", players, rounds, "r3")).toMatchObject({ state: "gone", text: "Esme Dq was disqualified." });
  });

  it("nobody by that name: says the name typed, and goes to Entries", () => {
    expect(findAPlayer("Whitlo ", players.filter((p) => p.id === "b"), rounds, "r3")).toEqual({
      state: "nobody",
      text: "Nobody called ‘Whitlo’ is in this event.",
      way: { says: "See Entries", href: "/registration" },
    });
  });

  it("more than three rows: the first three, then '3 of N: keep typing'", () => {
    const many = Array.from({ length: 7 }, (_, i) => P(`m${i}`, `Wynn Match${i}`));
    const big: FindRound[] = [{ id: "r1", label: "Round 1", published: true, groups: many.map((p, i) => ({ name: `Group ${i + 1}`, time: "8:00 AM", startHole: 1, playerIds: [p.id] })) }];
    const out = findAPlayer("wynn", many, big, null);
    expect(out.state).toBe("found");
    if (out.state !== "found") return;
    expect(out.rows).toHaveLength(FIND_MAX_ROWS);
    expect(out.more).toBe("3 of 7: keep typing");
  });
});

describe("findAPlayer: the edges", () => {
  it("matches inside a name, without caring for case or accents", () => {
    const accented = [P("x", "Zoë Marsh")];
    const sheet: FindRound[] = [{ id: "r1", label: "Round 1", published: true, groups: [{ name: "Group 2", time: "7:40 AM", startHole: 1, playerIds: ["x"] }] }];
    expect(findAPlayer("ZOE", accented, sheet, null).state).toBe("found");
    expect(findAPlayer("rsh", accented, sheet, null).state).toBe("found");
  });

  it("a shotgun overflow half is part of the tee", () => {
    const sheet: FindRound[] = [{ id: "r1", label: "Round 1", published: true, groups: [{ name: "Group 2", time: "7:40 AM", startHole: 4, half: "B", playerIds: ["a"] }] }];
    const out = findAPlayer("ana", players, sheet, null);
    expect(out.state === "found" && out.rows[0].text.endsWith("Tee 4 B")).toBe(true);
  });

  it("an unpublished sheet is never searched, so a player only on it is 'entered but not on a published sheet'", () => {
    expect(findAPlayer("finn", players, rounds, null)).toMatchObject({ state: "unplaced" });
  });
});
