import { describe, it, expect } from "vitest";
import {
  applyReplace,
  candidateWhy,
  STAND_IN_MARK,
  clubTimeWords,
  guestFigureRefusal,
  handicapUsedWords,
  pairNameAfter,
  readReplaceReason,
  replaceAuditLine,
  replaceCandidates,
  replaceRefusal,
  replaceWillSay,
  swapPairMember,
  voidedGamesWords,
  type ReplaceCandidate,
  type ReplaceWorld,
} from "../tee-sheet-replace";
import { slotLocks } from "../tee-sheet-moves";
import type { TeeSheet } from "../tee-sheet";

/**
 * REPLACE A PLAYER IN A SLOT (B43), worked by hand.
 *
 *   Group 1  8:00 AM  hole 1   a b c d
 *   Group 2  8:10 AM  hole 1   e f
 *   Group 3  8:20 AM  hole 10  g h
 *   not on the sheet: i (in the field), j (marked out), k (missed the cut)
 */
const sheet: TeeSheet = {
  savedAt: "2026-11-12T00:00:00.000Z",
  startType: "split",
  groups: [
    { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: ["a", "b", "c", "d"] },
    { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: ["e", "f"] },
    { name: "Group 3", startHole: 10, time: "8:20 AM", playerIds: ["g", "h"] },
  ],
};
const people: ReplaceCandidate[] = "abcdefghijk".split("").map((id, n) => ({ id, name: id.toUpperCase(), index: n === 7 ? "no index" : `${10 + n}.0` }));
const world: ReplaceWorld = {
  sheet,
  field: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "k"],
  out: ["j"],
  sides: {},
  cut: null,
  flights: {},
  sameFlight: false,
};
const noLocks = {};
const facts = (day: string, minutes: number, cardsIn: string[] = []) => ({ roundDay: "2026-11-12", now: { day, minutes }, cardsIn: new Set(cardsIn) });

describe("the stand-in's mark", () => {
  it("is one constant the writer and the finder share; a wording change must be deliberate", () => {
    expect(STAND_IN_MARK).toBe("(stand-in for ");
  });
});

describe("until when: the absentee's group has not started", () => {
  it("before 8:00 the club's day, nothing is locked and the swap is allowed", () => {
    const locks = slotLocks(sheet, facts("2026-11-12", 7 * 60 + 59));
    expect(locks).toEqual({});
    expect(replaceRefusal(sheet, "a", locks)).toBeNull();
  });

  it("at 8:00 Group 1 has started; Group 2 (8:10) has not — only Group 1 refuses", () => {
    const locks = slotLocks(sheet, facts("2026-11-12", 8 * 60 + 5));
    expect(replaceRefusal(sheet, "a", locks)).toBe("Group 1 teed off at 8:00 AM. A group that has started can’t have a player swapped in. If somebody has gone home, that is a withdrawal.");
    expect(replaceRefusal(sheet, "e", locks)).toBeNull();
  });

  it("a card in a group starts it whatever the clock says; another group's card does not", () => {
    const locks = slotLocks(sheet, facts("2026-11-12", 6 * 60, ["g"]));
    expect(replaceRefusal(sheet, "h", locks)).toBe("Group 3 has a card in. A group that has started can’t have a player swapped in. If somebody has gone home, that is a withdrawal.");
    expect(replaceRefusal(sheet, "a", locks)).toBeNull();
  });

  it("the day before the round's day every group is still to come; the day after, all have started", () => {
    expect(slotLocks(sheet, facts("2026-11-11", 23 * 60 + 59))).toEqual({});
    expect(Object.keys(slotLocks(sheet, facts("2026-11-13", 0)))).toEqual(["0", "1", "2"]);
  });

  it("somebody not on the sheet cannot be replaced", () => {
    expect(replaceRefusal(sheet, "i", noLocks)).toBe("That player isn’t in a group on this sheet.");
  });
});

describe("who steps in", () => {
  it("is offered the field members not already playing; the rest are listed with the reason", () => {
    const rows = replaceCandidates(people, "a", world);
    expect(rows.filter((r) => !r.why).map((r) => r.id)).toEqual(["i", "k"]);
    const why = Object.fromEntries(rows.filter((r) => r.why).map((r) => [r.id, r.why]));
    expect(why).toEqual({
      b: "Already in Group 1.",
      c: "Already in Group 1.",
      d: "Already in Group 1.",
      e: "Already in Group 2.",
      f: "Already in Group 2.",
      g: "Already in Group 3.",
      h: "Already in Group 3.",
      j: "Marked out for this week. Put them back in first.",
    });
    // K is not in the sheet and in the field: eligible too when there is no cut.
    expect(rows.find((r) => r.id === "k")?.why).toBeUndefined();
    // The absentee is never offered; choosable people come first.
    expect(rows.some((r) => r.id === "a")).toBe(false);
    expect(rows.slice(0, 2).map((r) => r.id)).toEqual(["i", "k"]);
  });

  it("a player stored in a group but marked out is not 'already playing' — marked out wins and is said", () => {
    const w: ReplaceWorld = { ...world, out: ["b"] };
    expect(candidateWhy(people[1], "a", w)).toBe("Marked out for this week. Put them back in first.");
  });

  it("a player on the sheet is never offered, even one the field no longer holds (stored in a group, outside the field)", () => {
    const w: ReplaceWorld = { ...world, field: world.field.filter((id) => id !== "e") };
    expect(candidateWhy(people[4], "a", w)).toBe("Already in Group 2.");
    expect(replaceCandidates(people, "a", w).find((r) => r.id === "e")?.why).toBe("Already in Group 2.");
  });

  it("missed the cut: refused once a cut has been made", () => {
    const w: ReplaceWorld = { ...world, cut: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] };
    expect(candidateWhy(people[10], "a", w)).toBe("Missed the cut.");
    expect(candidateWhy(people[8], "a", w)).toBeNull();
  });

  it("in a pair round somebody holding a place in another pair is refused, named for the pair", () => {
    const w: ReplaceWorld = { ...world, sides: { i: "Ann / Bea" } };
    expect(candidateWhy(people[8], "a", w)).toBe("Already playing in Ann / Bea.");
  });

  it("in an interclub league the substitute must play for the absentee's club", () => {
    const w: ReplaceWorld = { ...world, sameFlight: true, flights: { a: "home", i: "home", k: "away", j: "home" } };
    expect(candidateWhy(people[8], "a", w)).toBeNull();
    expect(candidateWhy(people[10], "a", w)).toBe("Plays for another club.");
    // With no flights in play, club does not matter.
    expect(candidateWhy(people[10], "a", { ...world, flights: { a: "home", k: "away" } })).toBeNull();
  });
});

describe("the sheet after a swap", () => {
  it("the substitute takes the exact place: same group, same position; the others and the times are untouched", () => {
    const r = applyReplace(sheet, "c", "i", noLocks);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sheet.groups.map((g) => g.playerIds)).toEqual([["a", "b", "i", "d"], ["e", "f"], ["g", "h"]]);
    expect(r.sheet.groups.map((g) => [g.time, g.startHole])).toEqual([["8:00 AM", 1], ["8:10 AM", 1], ["8:20 AM", 10]]);
    expect(r.group).toBe(0);
    expect(r.groupName).toBe("Group 1");
    // The input sheet is not changed.
    expect(sheet.groups[0].playerIds).toEqual(["a", "b", "c", "d"]);
  });

  it("a shotgun slot keeps its hole", () => {
    const r = applyReplace(sheet, "g", "i", noLocks);
    expect(r.ok && r.sheet.groups[2]).toMatchObject({ startHole: 10, time: "8:20 AM", playerIds: ["i", "h"] });
  });

  it("a group that has started refuses on its own words; replacing oneself is refused", () => {
    const locks = slotLocks(sheet, facts("2026-11-12", 8 * 60 + 15));
    expect(applyReplace(sheet, "e", "i", locks)).toMatchObject({ ok: false });
    expect(applyReplace(sheet, "a", "a", noLocks)).toEqual({ ok: false, says: "Choose somebody other than the player being replaced." });
  });
});

describe("a pair: the member is swapped, the position kept", () => {
  const pair = [
    { playerId: "p", position: 0 },
    { playerId: "q", position: 1 },
  ];
  it("the substitute for Q is second in the pair, as Q was", () => {
    expect(swapPairMember(pair, "q", "z")).toEqual({ ok: true, members: [{ playerId: "p", position: 0 }, { playerId: "z", position: 1 }] });
    expect(swapPairMember(pair, "p", "z")).toEqual({ ok: true, members: [{ playerId: "z", position: 0 }, { playerId: "q", position: 1 }] });
  });
  it("refuses somebody not in the pair, and somebody already in it", () => {
    expect(swapPairMember(pair, "x", "z")).toEqual({ ok: false, says: "That player isn’t in this pair." });
    expect(swapPairMember(pair, "p", "q")).toEqual({ ok: false, says: "That player is already in this pair." });
  });
  it("a pair named for its players is renamed; a chosen name is left alone", () => {
    expect(pairNameAfter("Ann / Bea", ["Ann", "Bea"], ["Ann", "Cat"])).toBe("Ann / Cat");
    expect(pairNameAfter("The Reds", ["Ann", "Bea"], ["Ann", "Cat"])).toBe("The Reds");
  });
});

describe("the words", () => {
  it("reasons are the three; anything else is not one", () => {
    expect(["no-show", "cancelled", "other"].map(readReplaceReason)).toEqual(["no-show", "cancelled", "other"]);
    expect(readReplaceReason("sulking")).toBeNull();
    expect(readReplaceReason(undefined)).toBeNull();
  });

  it("the audit line: who, whom, by whom, when, where, why, the handicap, and what was voided", () => {
    expect(
      replaceAuditLine({
        absentee: "Ann Doyle",
        sub: "Bea Ford",
        staff: "Sam Desk",
        clubTime: clubTimeWords({ day: "2026-11-12", minutes: 7 * 60 + 5 }),
        round: "Round 3",
        group: "Group 2",
        reason: "no-show",
        handicap: handicapUsedWords("no index"),
        games: voidedGamesWords({ contests: 1, sideGames: 0, kept: 1, skins: [{ cents: 500, paid: true }, { cents: 250, paid: false }] }),
      }),
    ).toBe(
      "Replaced Ann Doyle with Bea Ford by Sam Desk at 2026-11-12 07:05, Round 3, Group 2, reason no-show, handicap used no index (gross only). " +
        "Marked the absentee out of 1 contest they had not paid for. Left 1 paid stake in the pot, as a withdrawal leaves it. Left the absentee’s stake in 2 skins pots on the record (5.00 paid, 2.50 not paid), to be settled by hand.",
    );
  });

  it("a guest with no figure is refused in a round scored net, allowed in a gross one", () => {
    expect(guestFigureRefusal("net", "Rob Hale", false)).toBe("Type the handicap the committee gives Rob Hale — this round is scored net.");
    expect(guestFigureRefusal("both", "Rob Hale", false)).not.toBeNull();
    expect(guestFigureRefusal("stableford", "Rob Hale", false)).not.toBeNull();
    expect(guestFigureRefusal("gross", "Rob Hale", false)).toBeNull();
    expect(guestFigureRefusal("net", "Rob Hale", true)).toBeNull();
  });

  it("nothing voided says nothing; a one-round tournament leaves the round out", () => {
    expect(voidedGamesWords({ contests: 0, sideGames: 0, kept: 0, skins: [] })).toBe("");
    expect(replaceAuditLine({ absentee: "A", sub: "B", staff: "S", clubTime: "t", round: "", group: "Group 1", reason: "other", handicap: "12.4", games: "" })).toBe(
      "Replaced A with B by S at t, Group 1, reason other, handicap used 12.4.",
    );
  });

  it("the one sentence the confirm states", () => {
    expect(replaceWillSay({ absentee: "Ann", sub: "Bea", group: "Group 2", time: "8:10 AM", handicap: "12.4", inSides: false, weekly: true })).toBe(
      "Bea takes Ann’s place in Group 2, 8:10 AM, playing off 12.4; Ann comes off the sheet and is marked out for the week, and their side-game entries for this round are marked out (what they paid stays on the record).",
    );
    expect(replaceWillSay({ absentee: "Ann", sub: "Rob", group: "Group 1", time: "", handicap: "no index", inSides: true, weekly: false })).toContain("playing off no index (gross only), keeping the pair and its match; Ann comes off the sheet and is withdrawn from the field (the row is kept), and their side-game entries");
  });
});
