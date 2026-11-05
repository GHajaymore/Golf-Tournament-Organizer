import { describe, it, expect } from "vitest";
import {
  groupFragment,
  groupKeyForPlayers,
  groupKeyFromFragment,
  groupsOfRound,
  lastTimeSentence,
  matchGroupKey,
  parseRemembered,
  rememberGroup,
  rememberedGroup,
  teeGroupKey,
  type PlayGroup,
} from "../play-groups";
import type { TeeSheetGroup } from "../tee-sheet";
import { roundShareMessage, hostOf } from "../share-message";

/**
 * THE DOORS INTO A GROUP (2026-11-05): a link's group part, the group a phone
 * remembers across a tournament, which groups a round lists (one answer for the
 * list and for the printed signs), and the message that carries a code.
 * Names are invented.
 */
const names = new Map([
  ["a", "Zz Ann"],
  ["b", "Zz Bea"],
  ["c", "Zz Cat"],
  ["d", "Zz Dot"],
  ["e", "Zz Eve"],
  ["f", "Zz Fay"],
]);

const sheet: TeeSheetGroup[] = [
  { name: "Group 1", startHole: 1, time: "8:00", playerIds: ["a", "b"] },
  { name: "Group 2", startHole: 1, time: "8:10", playerIds: ["c", "d"] },
  { name: "Group 3", startHole: 10, time: "8:00", playerIds: ["e", "f"] },
];

describe("a group in a link", () => {
  it("is the key with its word cut to one letter", () => {
    expect(groupFragment(teeGroupKey(3))).toBe("t3");
    expect(groupFragment(matchGroupKey("cmhk3x9a20001abcdefghijklm"))).toBe("mcmhk3x9a20001abcdefghijklm");
  });

  it("comes back as the same key", () => {
    for (const key of [teeGroupKey(0), teeGroupKey(41), matchGroupKey("cmhk3x9a20001abcdefghijklm"), matchGroupKey("Ab-9_zz")]) {
      expect(groupKeyFromFragment(groupFragment(key)!), key).toBe(key);
    }
  });

  it("keeps the case of a match id, which is how ids are told apart", () => {
    expect(groupKeyFromFragment("mAbCd1234")).toBe("match:AbCd1234");
    expect(groupKeyFromFragment("mabcd1234")).toBe("match:abcd1234");
  });

  it("is nothing for a key or a fragment that is not a group's", () => {
    for (const key of ["", "tee:", "tee:x", "tee:07", "tee:1000", "match:", "match:ab", "match:a/b", "match:a.b", "player:q", "t3"]) {
      expect(groupFragment(key), key).toBeNull();
    }
    for (const frag of ["", "t", "tx", "t07", "t1000", "m", "mab", "m/../x", "m.x.y", "x3", "T3"]) {
      expect(groupKeyFromFragment(frag), frag).toBeNull();
    }
  });
});

describe("the group a phone remembers across a tournament", () => {
  const groups: PlayGroup[] = [
    { key: "tee:0", title: "Group 1", names: "Zz Ann, Zz Bea", tee: "8:00 off the 1st", players: [{ id: "a", name: "Zz Ann" }, { id: "b", name: "Zz Bea" }], oneMatch: false },
    { key: "tee:1", title: "Group 2", names: "Zz Cat, Zz Dot", tee: "8:10 off the 1st", players: [{ id: "c", name: "Zz Cat" }, { id: "d", name: "Zz Dot" }], oneMatch: false },
  ];

  it("is found again in the same round", () => {
    expect(rememberedGroup(rememberGroup(groups[1]), groups)?.key).toBe("tee:1");
  });

  it("is found under a new key when the same people are the same group (the next round's match, a redrawn sheet)", () => {
    const next: PlayGroup[] = [{ ...groups[1], key: "match:cmhk3x9a20001abcdefghijklm", title: "Match 4" }, groups[0]];
    expect(rememberedGroup(rememberGroup(groups[1]), next)?.key).toBe("match:cmhk3x9a20001abcdefghijklm");
  });

  it("is null when that group no longer exists: gone, or not the same people", () => {
    const gone = [groups[0]];
    expect(rememberedGroup(rememberGroup(groups[1]), gone)).toBeNull();
    // Same key, somebody else in it: not the group the phone confirmed.
    const changed: PlayGroup[] = [{ ...groups[1], players: [{ id: "c", name: "Zz Cat" }, { id: "e", name: "Zz Eve" }] }];
    expect(rememberedGroup(rememberGroup(groups[1]), changed)).toBeNull();
    // Somebody added.
    const grown: PlayGroup[] = [{ ...groups[1], players: [...groups[1].players, { id: "e", name: "Zz Eve" }] }];
    expect(rememberedGroup(rememberGroup(groups[1]), grown)).toBeNull();
    expect(rememberedGroup(rememberGroup(groups[1]), [])).toBeNull();
  });

  it("is null for nothing stored", () => {
    expect(rememberedGroup(null, groups)).toBeNull();
    expect(rememberedGroup({ key: "tee:1", ids: [] }, groups)).toBeNull();
  });

  it("is the same group whatever order the people are listed in", () => {
    expect(rememberedGroup({ key: "x", ids: ["d", "c"] }, groups)?.key).toBe("tee:1");
  });

  it("is read from storage only when what is there is one", () => {
    const stored = JSON.stringify(rememberGroup(groups[0]));
    expect(parseRemembered(stored)).toEqual({ key: "tee:0", ids: ["a", "b"] });
    for (const bad of [null, "", "not json", "null", "[]", '{"key":3,"ids":["a"]}', '{"key":"tee:0","ids":[]}', '{"key":"tee:0","ids":[1]}', '{"key":"tee:0"}']) {
      expect(parseRemembered(bad), String(bad)).toBeNull();
    }
  });

  it("is said as 'Last time: Group 3 — names'", () => {
    expect(lastTimeSentence({ title: "Group 3", names: "Zz Eve, Zz Fay" })).toBe("Last time: Group 3 — Zz Eve, Zz Fay");
  });
});

describe("which groups a round lists", () => {
  const matches = [
    { id: "m-aaaa1", a: ["a"], b: ["b"] },
    { id: "m-bbbb2", a: ["c"], b: ["d"] },
  ];

  it("lists the matches of a round that draws them, announced", () => {
    const groups = groupsOfRound({ lineupHidden: false, matches, names, sheet: null, oneMatch: true });
    expect(groups.map((g) => g.key)).toEqual(["match:m-aaaa1", "match:m-bbbb2"]);
  });

  it("lists the tee sheet's groups when no matches are drawn, or the lineup is not announced", () => {
    expect(groupsOfRound({ lineupHidden: false, matches: [], names, sheet, oneMatch: true }).map((g) => g.key)).toEqual(["tee:0", "tee:1", "tee:2"]);
    expect(groupsOfRound({ lineupHidden: true, matches, names, sheet, oneMatch: true }).map((g) => g.key)).toEqual(["tee:0", "tee:1", "tee:2"]);
  });

  it("lists nothing for a round robin or a round with no sheet: the names", () => {
    const robin = [{ id: "m-r1", a: ["a"], b: ["b"] }, { id: "m-r2", a: ["a"], b: ["c"] }];
    expect(groupsOfRound({ lineupHidden: false, matches: robin, names, sheet: null, oneMatch: true })).toEqual([]);
    expect(groupsOfRound({ lineupHidden: false, matches: [], names, sheet: null, oneMatch: true })).toEqual([]);
  });

  it("keeps a tee group's place in the sheet in its key, even when an earlier group is empty", () => {
    const withEmpty: TeeSheetGroup[] = [{ name: "Group 1", startHole: 1, time: "8:00", playerIds: ["zz-not-in-the-field"] }, ...sheet.slice(1)];
    expect(groupsOfRound({ lineupHidden: false, matches: [], names, sheet: withEmpty, oneMatch: true }).map((g) => g.key)).toEqual(["tee:1", "tee:2"]);
  });
});

describe("the group a sign opens", () => {
  const groups = groupsOfRound({ lineupHidden: false, matches: [], names, sheet, oneMatch: true });

  it("is the one entry its players are in", () => {
    expect(groupKeyForPlayers(groups, ["a", "b"])).toBe("tee:0");
    expect(groupKeyForPlayers(groups, ["e"])).toBe("tee:2");
  });

  it("is none when its players are in two entries, or in none: the sign opens the round's list", () => {
    expect(groupKeyForPlayers(groups, ["a", "c"])).toBeUndefined();
    expect(groupKeyForPlayers(groups, ["zz-nobody"])).toBeUndefined();
    expect(groupKeyForPlayers([], ["a"])).toBeUndefined();
  });
});

describe("the message that carries a code", () => {
  const input = {
    eventName: "Zz Spring Medal",
    roundLabel: "Round 1",
    code: "ABCDEFGH",
    link: "https://tourneyhq.club/play#ABCD-EFGH",
  };

  it("says what it is for, the link to tap, and the other way in", () => {
    expect(roundShareMessage(input)).toBe(
      "Scoring for Zz Spring Medal, Round 1: tap https://tourneyhq.club/play#ABCD-EFGH — or open tourneyhq.club/play and type ABCD-EFGH",
    );
  });

  it("names the host the link has, not a fixed one", () => {
    const msg = roundShareMessage({ ...input, link: "https://zz-preview.vercel.app/play#ABCD-EFGH" });
    expect(msg).toContain("or open zz-preview.vercel.app/play and type");
    expect(msg).not.toContain("tourneyhq.club");
  });

  it("drops a part it was not given rather than printing a hole", () => {
    expect(roundShareMessage({ ...input, roundLabel: "" })).toMatch(/^Scoring for Zz Spring Medal: tap /);
    expect(roundShareMessage({ ...input, eventName: "", roundLabel: "" })).toMatch(/^Scoring: tap /);
  });

  it("types the code as it is printed, whichever way it was stored", () => {
    expect(roundShareMessage({ ...input, code: "ABCD-EFGH" })).toMatch(/type ABCD-EFGH$/);
  });

  it("reads a host off an address", () => {
    expect(hostOf("https://tourneyhq.club/play#X")).toBe("tourneyhq.club");
    expect(hostOf("http://localhost:3000/play")).toBe("localhost:3000");
    expect(hostOf("tourneyhq.club/play")).toBe("tourneyhq.club");
  });
});
