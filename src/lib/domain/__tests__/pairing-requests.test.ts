import { describe, it, expect } from "vitest";
import { honourRequests, requestClusters, requestPairs, splitRequests, type DrawGroup } from "../pairing-requests";

/**
 * Twelve players drawn into three four-balls, the draw deliberately putting
 * every requested pair in DIFFERENT groups — so a result that leaves the draw
 * alone looks different from one that honours it.
 */
const FIELD = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
const DRAW: DrawGroup[] = [
  { id: "g1", name: "Group 1", playerIds: ["a", "b", "c", "d"] },
  { id: "g2", name: "Group 2", playerIds: ["e", "f", "g", "h"] },
  { id: "g3", name: "Group 3", playerIds: ["i", "j", "k", "l"] },
];
const groupOf = (gs: DrawGroup[], id: string) => gs.findIndex((g) => g.playerIds.includes(id));

describe("who asked to play together", () => {
  it("chains requests into one cluster, whichever side stored them", () => {
    const pairs = requestPairs([
      { id: "a", playWith: ["e"] },
      { id: "i", playWith: ["e"] }, // stored on the OTHER side of the chain
      { id: "b", playWith: [] },
    ]);
    expect(requestClusters(pairs, FIELD)).toEqual([["a", "e", "i"]]);
  });

  it("drops a request for somebody not playing today", () => {
    expect(requestClusters([["a", "zz-not-here"]], FIELD)).toEqual([]);
  });

  it("ignores a player asking for themself", () => {
    expect(requestPairs([{ id: "a", playWith: ["a"] }])).toEqual([]);
  });
});

describe("honouring them in the draw", () => {
  it("brings a split pair together and keeps every group at four", () => {
    const { groups, kept, split } = honourRequests(DRAW, [["a", "e"]]);
    expect(groupOf(groups, "a")).toBe(groupOf(groups, "e"));
    expect(groups.map((g) => g.playerIds.length)).toEqual([4, 4, 4]);
    expect(new Set(groups.flatMap((g) => g.playerIds))).toEqual(new Set(FIELD));
    expect(kept).toEqual([["a", "e"]]);
    expect(split).toEqual([]);
  });

  it("keeps a chain of three together", () => {
    const { groups } = honourRequests(DRAW, [["a", "e", "i"]]);
    expect(new Set(["a", "e", "i"].map((id) => groupOf(groups, id))).size).toBe(1);
  });

  it("never breaks one kept request to make room for the next — it finds another group", () => {
    // Keeping a, e and i fills Group 1 with a, e, i and d. Then d wants f: the
    // group holding "most" of them is Group 1, which has no free place left
    // without breaking the first request — so the pair goes to f's group instead.
    const { groups, kept, split } = honourRequests(DRAW, [["a", "e", "i"], ["d", "f"]]);
    expect(split).toEqual([]);
    expect(kept).toHaveLength(2);
    expect(new Set(["a", "e", "i"].map((id) => groupOf(groups, id))).size).toBe(1);
    expect(groupOf(groups, "d")).toBe(groupOf(groups, "f"));
    expect(groups.map((g) => g.playerIds.length)).toEqual([4, 4, 4]);
  });

  it("reports a cluster bigger than a group rather than forcing a five-ball", () => {
    const five = ["a", "e", "i", "b", "f"];
    const { groups, split } = honourRequests(DRAW, [five]);
    expect(split).toEqual([five]);
    expect(groups).toEqual(DRAW); // left exactly as drawn
  });

  it("CONTROL: a draw that already honours a request is left alone", () => {
    const { groups, kept } = honourRequests(DRAW, [["a", "b"]]);
    expect(groups).toEqual(DRAW);
    expect(kept).toEqual([["a", "b"]]);
  });
});

describe("a sheet saved before the request came in", () => {
  it("names the requests it splits, and only those", () => {
    expect(splitRequests(DRAW, [["a", "e"], ["a2", "b2"], ["c", "d"]])).toEqual([["a", "e"]]);
  });
});
