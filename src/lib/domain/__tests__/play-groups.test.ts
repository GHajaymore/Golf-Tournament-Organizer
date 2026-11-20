import { describe, it, expect } from "vitest";
import { keepingSentence, keepingYes, matchPlayGroups, sheetPlayGroups, targetKey, teeWords } from "../play-groups";

/** Pick your group, not your name (2026-11-04) — see `play-groups.ts`. */
const names = new Map([
  ["r", "Sam Hill"],
  ["s", "Alex Lake"],
  ["u", "Jo Park"],
  ["p", "Max Dale"],
  ["a", "Ann Lee"],
  ["b", "Bea Ray"],
]);

describe("a match round's groups", () => {
  it("one per match, both sides named, side A first, in draw order", () => {
    const groups = matchPlayGroups({
      matches: [
        { id: "m1", a: ["r", "s"], b: ["u", "p"] },
        { id: "m2", a: ["a"], b: ["b"] },
      ],
      names,
      sheet: null,
      oneMatch: true,
    });
    expect(groups?.map((g) => [g.title, g.names, g.tee])).toEqual([
      ["Match 1", "Sam Hill & Alex Lake v Jo Park & Max Dale", ""],
      ["Match 2", "Ann Lee v Bea Ray", ""],
    ]);
    expect(groups?.[0].players.map((x) => x.id)).toEqual(["r", "s", "u", "p"]);
    expect(groups?.[0].oneMatch).toBe(true);
  });

  it("takes each match's tee time and starting hole off a published sheet, and goes in tee order", () => {
    const groups = matchPlayGroups({
      matches: [
        { id: "m1", a: ["r", "s"], b: ["u", "p"] },
        { id: "m2", a: ["a"], b: ["b"] },
      ],
      names,
      sheet: [
        { name: "Group 1", startHole: 1, time: "12:46", playerIds: ["a", "b"] },
        { name: "Group 3", startHole: 10, time: "12:54", playerIds: ["u", "r", "p", "s"] },
      ],
      oneMatch: true,
    });
    expect(groups?.map((g) => `${g.title} · ${g.tee}`)).toEqual(["Group 1 · 12:46 off the 1st", "Group 3 · 12:54 off the 10th"]);
  });

  it("a round robin keeps the names: one player in several matches would be listed over and over", () => {
    expect(
      matchPlayGroups({
        matches: [
          { id: "m1", a: ["a"], b: ["b"] },
          { id: "m2", a: ["a"], b: ["r"] },
        ],
        names,
        sheet: null,
        oneMatch: true,
      }),
    ).toBeNull();
  });

  it("a match kept on stroke cards is not one card, so a player is picked inside it", () => {
    const [g] = matchPlayGroups({ matches: [{ id: "m1", a: ["a"], b: ["b"] }], names, sheet: null, oneMatch: false }) ?? [];
    expect(g.oneMatch).toBe(false);
  });
});

describe("a stroke round's groups, off its tee sheet", () => {
  it("each group with all its names and its tee", () => {
    const groups = sheetPlayGroups([{ name: "Group 2", startHole: 1, time: "8:10 AM", half: undefined, playerIds: ["a", "b", "gone"] }], names);
    expect(groups).toEqual([
      {
        key: "tee:0",
        title: "Group 2",
        names: "Ann Lee, Bea Ray",
        tee: "8:10 AM off the 1st",
        players: [
          { id: "a", name: "Ann Lee" },
          { id: "b", name: "Bea Ray" },
        ],
        oneMatch: false,
      },
    ]);
  });
});

describe("the one confirmation", () => {
  const group = {
    key: "match:m1",
    title: "Group 3",
    names: "Sam & Alex v Jo & Max",
    tee: "12:54 off the 10th",
    players: [],
    oneMatch: true,
  };

  it("says back the group in full, as the UX Writer wrote it", () => {
    expect(keepingSentence({ kind: "group", group })).toBe("You're keeping Group 3: Sam & Alex v Jo & Max · 12:54 off the 10th");
    expect(keepingYes({ kind: "group", group })).toBe("Yes, that's my group");
  });

  it("leaves the tee out where there is no tee sheet", () => {
    expect(keepingSentence({ kind: "group", group: { ...group, title: "Match 2", tee: "" } })).toBe("You're keeping Match 2: Sam & Alex v Jo & Max");
  });

  it("a name, on a round with no groups, is confirmed too", () => {
    expect(keepingSentence({ kind: "player", id: "a", name: "Ann Lee" })).toBe("You're keeping Ann Lee's card");
  });

  it("is never 'Are you sure?'", () => {
    for (const s of [keepingSentence({ kind: "group", group }), keepingYes({ kind: "group", group }), keepingYes({ kind: "player", id: "a", name: "Ann" })]) {
      expect(s).not.toMatch(/are you sure/i);
    }
  });

  it("remembers a group and a player apart", () => {
    expect(targetKey({ kind: "group", group })).toBe("match:m1");
    expect(targetKey({ kind: "player", id: "a", name: "Ann" })).toBe("player:a");
  });
});

describe("a group's tee, as a starter says it", () => {
  it("time, then the hole", () => {
    expect(teeWords({ time: "12:54", startHole: 10 })).toBe("12:54 off the 10th");
    expect(teeWords({ time: "", startHole: 1 })).toBe("off the 1st");
    expect(teeWords({ time: "8:00 AM", startHole: 2, half: "B" })).toBe("8:00 AM off the 2nd (B)");
  });
});
