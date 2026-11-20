import { describe, it, expect } from "vitest";
import {
  cutRuleOf,
  cutTieRuleOf,
  CUT_TIE_RULES,
  DEFAULT_CUT_TIE_RULE,
  cutHasBeenMade,
  cutRuleWords,
  cutAfterRound,
  cutDecidedBy,
  cutFeederOf,
  cardIsFinal,
  cutRoundAfter,
  cutBlockers,
  cardsNotFinal,
  cutProgress,
  cutBlockedSentence,
  roundReadyForCut,
} from "../cut-ready";

/**
 * Survivors of the Stryker run on `cut-ready.ts` (J49). Every expectation is
 * worked by counting, or from the Rules of Golf (Rule 3.3b: a player who has
 * not returned a card has not completed the round), never from the output of
 * the code. Invented rounds and ids only.
 */

const STROKE = "Stroke Play Round";
const FMT = "Stroke Play";
const played = JSON.stringify([4, 5, 3]);
const blank = JSON.stringify([null, null, null]);
const zeros = JSON.stringify([0, 0, 0]);

type R = {
  id: string;
  type: string;
  format: string;
  position?: number;
  cutEnabled: boolean;
  cutScope: string;
  cutMode: string;
  cutCount: number;
  cutPercent: number;
  cutTies: string;
  closedAt: Date | null;
};
const rd = (id: string, over: Partial<R> = {}): R => ({
  id,
  type: STROKE,
  format: FMT,
  cutEnabled: false,
  cutScope: "overall",
  cutMode: "count",
  cutCount: 10,
  cutPercent: 50,
  cutTies: "ties",
  closedAt: null,
  ...over,
});

describe("cutRuleOf", () => {
  it("reads each setting, and anything unknown as overall / count", () => {
    expect(cutRuleOf({ cutScope: "perFlight", cutMode: "percent", cutCount: 7, cutPercent: 33 })).toEqual({
      scope: "perFlight",
      mode: "percent",
      count: 7,
      percent: 33,
    });
    expect(cutRuleOf({ cutScope: "overall", cutMode: "count", cutCount: 7, cutPercent: 33 })).toEqual({
      scope: "overall",
      mode: "count",
      count: 7,
      percent: 33,
    });
    expect(cutRuleOf({ cutScope: "banana", cutMode: "banana", cutCount: 1, cutPercent: 2 })).toMatchObject({
      scope: "overall",
      mode: "count",
    });
    expect(cutRuleOf({ cutScope: "", cutMode: "", cutCount: 1, cutPercent: 2 })).toMatchObject({
      scope: "overall",
      mode: "count",
    });
  });
});

describe("cutTieRuleOf", () => {
  it("knows the three, and defaults the rest to ties", () => {
    expect(CUT_TIE_RULES).toEqual(["ties", "playoff", "countback"]);
    expect(DEFAULT_CUT_TIE_RULE).toBe("ties");
    expect(cutTieRuleOf("playoff")).toBe("playoff");
    expect(cutTieRuleOf("countback")).toBe("countback");
    expect(cutTieRuleOf("ties")).toBe("ties");
    expect(cutTieRuleOf("")).toBe("ties");
    expect(cutTieRuleOf(null)).toBe("ties");
    expect(cutTieRuleOf(undefined)).toBe("ties");
    expect(cutTieRuleOf("Playoff")).toBe("ties");
  });
});

describe("cutHasBeenMade: each of the five conditions alone refuses it", () => {
  const when = new Date("2026-03-01T10:00:00Z");
  const good = { cutEnabled: true, cutMadeAt: when, type: STROKE, format: FMT };
  const feeder = { closedAt: when, type: STROKE, format: FMT };

  it("is made when all five hold", () => {
    expect(cutHasBeenMade(good, feeder)).toBe(true);
  });
  it("is not made without a cut, a record, a feeder, or a closed feeder", () => {
    expect(cutHasBeenMade({ ...good, cutEnabled: false }, feeder)).toBe(false);
    expect(cutHasBeenMade({ ...good, cutMadeAt: null }, feeder)).toBe(false);
    expect(cutHasBeenMade(good, undefined)).toBe(false);
    expect(cutHasBeenMade(good, { ...feeder, closedAt: null })).toBe(false);
  });
  it("needs BOTH rounds to be individual stroke rounds", () => {
    // Feeder a match play round robin: not a card cut.
    expect(cutHasBeenMade(good, { ...feeder, type: "Round Robin", format: "Match Play" })).toBe(false);
    // The round itself a team format: not a card cut.
    expect(cutHasBeenMade({ ...good, format: "Scramble" }, feeder)).toBe(false);
    // Feeder a team format.
    expect(cutHasBeenMade(good, { ...feeder, format: "Scramble" })).toBe(false);
  });
});

describe("cutRuleWords", () => {
  const base = { scope: "overall", mode: "count", count: 16, percent: 25 } as const;
  it("words a count, a percent, a flight, and the ties", () => {
    expect(cutRuleWords(base)).toBe("Top 16 and ties");
    expect(cutRuleWords(base, false)).toBe("Top 16");
    expect(cutRuleWords({ ...base, mode: "percent" })).toBe("Top 25% and ties");
    expect(cutRuleWords({ ...base, scope: "perFlight", mode: "percent" })).toBe("Top 25% in each flight and ties");
    expect(cutRuleWords({ ...base, scope: "perFlight" }, false)).toBe("Top 16 in each flight");
  });
});

describe("cutFeederOf: which round a cut is taken out of", () => {
  it("is null for the first round, an unknown id, and an empty list", () => {
    const rs = [rd("a"), rd("b", { cutEnabled: true })];
    expect(cutFeederOf(rs, "a")).toBeNull();
    expect(cutFeederOf(rs, "zzz")).toBeNull();
    expect(cutFeederOf([], "a")).toBeNull();
  });
  it("is the round before when both are individual stroke rounds (a card)", () => {
    const rs = [rd("a"), rd("b"), rd("c")];
    const got = cutFeederOf(rs, "c");
    expect(got?.feeder.id).toBe("b");
    expect(got?.kind).toBe("card");
    expect(cutFeederOf(rs, "b")).toEqual({ feeder: rs[0], kind: "card" });
  });
  it("is the LAST round robin before it when the round beside it is not a card cut (a table)", () => {
    const rr1 = rd("rr1", { type: "Round Robin", format: "Match Play" });
    const rr2 = rd("rr2", { type: "Round Robin", format: "Match Play" });
    const medal = rd("medal");
    const target = rd("t");
    const got = cutFeederOf([rr1, rr2, medal, target], "t");
    // medal -> t is a card cut, so the card wins...
    expect(got).toEqual({ feeder: medal, kind: "card" });
    // ...but with a team round between, the table of the LAST round robin is used.
    const team = rd("team", { format: "Scramble" });
    expect(cutFeederOf([rr1, rr2, team, target], "t")).toEqual({ feeder: rr2, kind: "table" });
    // Directly after a round robin on match play: the table.
    expect(cutFeederOf([rr1, target], "t")).toEqual({ feeder: rr1, kind: "table" });
  });
  it("passes over rounds that are not played, and has no cut when no engine makes one", () => {
    const odd = { id: "x", type: "Not A Type", format: FMT };
    const rs = [rd("a"), odd, rd("b")];
    expect(cutFeederOf(rs, "b")).toEqual({ feeder: rs[0], kind: "card" });
    expect(cutFeederOf(rs, "x")).toBeNull();
    // Scramble before a stroke round, no round robin anywhere: nothing cuts.
    expect(cutFeederOf([rd("s", { format: "Scramble" }), rd("n")], "n")).toBeNull();
  });
  it("an id nobody has is never the target of a table cut, even with a round robin in the list", () => {
    const rr = rd("rr", { type: "Round Robin", format: "Match Play" });
    expect(cutFeederOf([rr, rd("x")], "nobody")).toBeNull();
  });
  it("a round robin on Stroke Play beside a medal is cut on cards (the stroke test first)", () => {
    const rr = rd("rr", { type: "Round Robin", format: "Stroke Play" });
    expect(cutFeederOf([rr, rd("m")], "m")).toEqual({ feeder: rr, kind: "card" });
  });
});

describe("cutDecidedBy: the cut a round decides", () => {
  it("is the first later round with a cut whose feeder is this round", () => {
    const rs = [rd("a"), rd("b", { cutEnabled: true }), rd("c", { cutEnabled: true })];
    expect(cutDecidedBy(rs, "a")?.next.id).toBe("b");
    expect(cutDecidedBy(rs, "a")?.kind).toBe("card");
    expect(cutDecidedBy(rs, "b")?.next.id).toBe("c");
    expect(cutDecidedBy(rs, "c")).toBeNull();
  });
  it("skips a round with no cut, and a bracket round (field is its qualifiers)", () => {
    const bracket = rd("br", { type: "Bracket Stage", format: "Match Play", cutEnabled: true });
    const rs = [rd("a"), rd("b"), bracket];
    expect(cutDecidedBy(rs, "a")).toBeNull();
    expect(cutDecidedBy(rs, "b")).toBeNull();
  });
  it("a bracket round does not stop a LATER cut round being found", () => {
    const rr = rd("rr", { type: "Round Robin", format: "Match Play" });
    const bracket = rd("br", { type: "Bracket Stage", format: "Match Play", cutEnabled: true });
    const cut = rd("cut", { cutEnabled: true });
    expect(cutDecidedBy([rr, bracket, cut], "rr")?.next.id).toBe("cut");
  });
  it("a cut whose feeder is another round is not this round's", () => {
    const rr = rd("rr", { type: "Round Robin", format: "Match Play" });
    const medal = rd("m");
    const cut = rd("c", { cutEnabled: true });
    // medal feeds c on cards; rr decides nothing.
    expect(cutDecidedBy([rr, medal, cut], "rr")).toBeNull();
    expect(cutDecidedBy([rr, medal, cut], "m")?.next.id).toBe("c");
  });
});

describe("cutAfterRound: what the sheet of a round says", () => {
  it("is null when the round decides no cut", () => {
    expect(cutAfterRound([rd("a"), rd("b")], "a")).toBeNull();
    expect(cutAfterRound([rd("a")], "a")).toBeNull();
  });
  it("describes a plain cut into the next round, with no 'into'", () => {
    const rs = [rd("a"), rd("b", { cutEnabled: true, cutCount: 12, cutScope: "perFlight", cutMode: "percent", cutPercent: 40, cutTies: "countback" })];
    const got = cutAfterRound(rs, "a");
    expect(got).toEqual({
      rule: { scope: "perFlight", mode: "percent", count: 12, percent: 40 },
      ties: false,
      tieRule: "countback",
      decidedOn: "card",
      intoId: "b",
      into: null,
    });
  });
  it("ties is true only for the 'ties' rule", () => {
    const mk = (t: string) => cutAfterRound([rd("a"), rd("b", { cutEnabled: true, cutTies: t })], "a");
    expect(mk("ties")?.ties).toBe(true);
    expect(mk("playoff")?.ties).toBe(false);
    expect(mk("playoff")?.tieRule).toBe("playoff");
    expect(mk("nonsense")?.tieRule).toBe("ties");
  });
  it("names the round the cut feeds when it is not the next one (round robin, medal, cut round)", () => {
    const rr = rd("rr", { type: "Round Robin", format: "Match Play", position: 1 });
    const medal = rd("m", { format: "Scramble", position: 2 });
    const cut = rd("c", { cutEnabled: true, position: 3 });
    const rs = [rr, medal, cut];
    const got = cutAfterRound(rs, "rr");
    expect(got?.decidedOn).toBe("table");
    expect(got?.intoId).toBe("c");
    expect(got?.into).toBe("Round 3");
    // The team round's sheet says nothing of that cut.
    expect(cutAfterRound(rs, "m")).toBeNull();
  });
  it("counts only played rounds when judging 'the next one'", () => {
    const a = rd("a");
    const ghost = { ...rd("g"), type: "Not A Type" };
    const b = rd("b", { cutEnabled: true });
    expect(cutAfterRound([a, ghost, b], "a")?.into).toBeNull();
  });
});

describe("cardIsFinal", () => {
  it("approved always; certified only where nobody reviews; nothing else", () => {
    expect(cardIsFinal("approved", true)).toBe(true);
    expect(cardIsFinal("approved", false)).toBe(true);
    expect(cardIsFinal("certified", false)).toBe(true);
    expect(cardIsFinal("certified", true)).toBe(false);
    expect(cardIsFinal("entered", false)).toBe(false);
    expect(cardIsFinal("disputed", false)).toBe(false);
    expect(cardIsFinal("", false)).toBe(false);
  });
});

describe("cutRoundAfter", () => {
  const mk = (id: string, over: Partial<{ type: string; format: string; cutEnabled: boolean }> = {}) => ({
    id,
    type: STROKE,
    format: FMT,
    cutEnabled: false,
    closedAt: null,
    ...over,
  });
  it("is the next round when it has a cut and both are individual stroke rounds", () => {
    const rs = [mk("a"), mk("b", { cutEnabled: true })];
    expect(cutRoundAfter(rs, "a")).toBe(rs[1]);
  });
  it("is null for the last round, an unknown round, an empty list, or a next with no cut", () => {
    const rs = [mk("a"), mk("b", { cutEnabled: true })];
    expect(cutRoundAfter(rs, "b")).toBeNull();
    expect(cutRoundAfter(rs, "zz")).toBeNull();
    expect(cutRoundAfter([], "a")).toBeNull();
    expect(cutRoundAfter([mk("a"), mk("b")], "a")).toBeNull();
  });
  it("is null when either round is not an individual stroke round", () => {
    expect(cutRoundAfter([mk("a", { format: "Scramble" }), mk("b", { cutEnabled: true })], "a")).toBeNull();
    expect(cutRoundAfter([mk("a"), mk("b", { cutEnabled: true, format: "Scramble" })], "a")).toBeNull();
    expect(cutRoundAfter([mk("a", { type: "Round Robin", format: "Match Play" }), mk("b", { cutEnabled: true })], "a")).toBeNull();
  });
  it("looks only one round ahead", () => {
    const rs = [mk("a"), mk("b"), mk("c", { cutEnabled: true })];
    expect(cutRoundAfter(rs, "a")).toBeNull();
    expect(cutRoundAfter(rs, "b")).toBe(rs[2]);
  });
});

describe("cardsNotFinal and cutBlockers: counted by hand", () => {
  // Nine cards: 2 approved, 2 certified, 1 entered, 1 disputed, 3 with nothing on them.
  const cards = [
    { status: "approved", strokes: played },
    { status: "approved", strokes: played },
    { status: "certified", strokes: played },
    { status: "certified", strokes: played },
    { status: "entered", strokes: played },
    { status: "disputed", strokes: played },
    { status: "entered", strokes: blank },
    { status: "disputed", strokes: zeros },
    { status: "certified", strokes: "[]" },
  ];

  it("a committee: certified and entered wait on IT (3), one disputed, approved are final", () => {
    const split = cardsNotFinal(cards, true);
    expect(split.pending).toHaveLength(3);
    expect(split.disputed).toHaveLength(1);
    expect(cutBlockers(cards, true)).toEqual({ awaitingApproval: 3, notReturned: 0, disputed: 1, total: 4 });
  });
  it("players confirm: only the entered card waits on its player (1), one disputed", () => {
    const split = cardsNotFinal(cards, false);
    expect(split.pending).toHaveLength(1);
    expect(split.disputed).toHaveLength(1);
    expect(cutBlockers(cards, false)).toEqual({ awaitingApproval: 0, notReturned: 1, disputed: 1, total: 2 });
  });
  it("a card with no stroke on it (blank, zeros, empty, not JSON, a string) is nobody's card", () => {
    const none = [
      { status: "entered", strokes: blank },
      { status: "entered", strokes: zeros },
      { status: "entered", strokes: "[]" },
      { status: "entered", strokes: "not json" },
      { status: "entered", strokes: "" },
      { status: "entered", strokes: JSON.stringify(["4", "5"]) },
      { status: "entered", strokes: JSON.stringify([-1, 0]) },
    ];
    expect(cutBlockers(none, true).total).toBe(0);
    expect(cutProgress(none, true)).toEqual({ final: 0, total: 0 });
  });
  it("one stroke anywhere on a card makes it a played card; a lone 1 counts, a zero does not", () => {
    expect(cutBlockers([{ status: "entered", strokes: JSON.stringify([null, 1, null]) }], true).total).toBe(1);
    expect(cutBlockers([{ status: "entered", strokes: JSON.stringify([0, 0, 2]) }], true).total).toBe(1);
  });
  it("no cards at all blocks nothing", () => {
    expect(cutBlockers([], true)).toEqual({ awaitingApproval: 0, notReturned: 0, disputed: 0, total: 0 });
    expect(cardsNotFinal([], false)).toEqual({ pending: [], disputed: [] });
  });
  it("hands back the very cards, not copies of their counts", () => {
    const c = { status: "entered", strokes: played };
    expect(cardsNotFinal([c], true).pending[0]).toBe(c);
  });
});

describe("cutProgress", () => {
  it("final is the played cards less the blockers; total is the played cards", () => {
    const cards = [
      { status: "approved", strokes: played },
      { status: "approved", strokes: played },
      { status: "entered", strokes: played },
      { status: "disputed", strokes: played },
      { status: "entered", strokes: blank },
    ];
    // 4 played, 2 blocked (1 awaiting + 1 disputed) -> 2 final of 4.
    expect(cutProgress(cards, true)).toEqual({ final: 2, total: 4 });
    // Players confirm: the entered card is unsigned (1) + disputed (1) -> still 2 of 4.
    expect(cutProgress(cards, false)).toEqual({ final: 2, total: 4 });
  });
  it("certified counts as final only where nobody reviews", () => {
    const cards = [{ status: "certified", strokes: played }];
    expect(cutProgress(cards, true)).toEqual({ final: 0, total: 1 });
    expect(cutProgress(cards, false)).toEqual({ final: 1, total: 1 });
  });
  it("a field of ONE returned card, final, is 1 of 1", () => {
    expect(cutProgress([{ status: "approved", strokes: played }], true)).toEqual({ final: 1, total: 1 });
  });
});

describe("cutBlockedSentence", () => {
  const none = { awaitingApproval: 0, notReturned: 0, disputed: 0, total: 0 };
  const tail = "Closing Round 1 makes the cut, so every card in it has to be final first.";
  it("says one card in the singular, many in the plural, joined by commas", () => {
    expect(cutBlockedSentence({ ...none, awaitingApproval: 1 }, "Round 1")).toBe(`1 card needs your approval. ${tail}`);
    expect(cutBlockedSentence({ ...none, awaitingApproval: 4 }, "Round 1")).toBe(`4 cards need your approval. ${tail}`);
    expect(cutBlockedSentence({ ...none, notReturned: 1 }, "Round 1")).toBe(`1 card hasn't been signed by the player. ${tail}`);
    expect(cutBlockedSentence({ ...none, notReturned: 2 }, "Round 1")).toBe(`2 cards haven't been signed by the player. ${tail}`);
    expect(cutBlockedSentence({ ...none, disputed: 1 }, "Round 1")).toBe(`1 card is disputed. ${tail}`);
    expect(cutBlockedSentence({ ...none, disputed: 3 }, "Round 1")).toBe(`3 cards are disputed. ${tail}`);
  });
  it("lists all three in order", () => {
    expect(cutBlockedSentence({ awaitingApproval: 2, notReturned: 1, disputed: 1, total: 4 }, "Round 1")).toBe(
      `2 cards need your approval, 1 card hasn't been signed by the player, 1 card is disputed. ${tail}`,
    );
  });
  it("uses the name it is given", () => {
    expect(cutBlockedSentence({ ...none, disputed: 1 }, "the Medal")).toContain("Closing the Medal makes the cut");
  });
});

describe("roundReadyForCut", () => {
  const mk = (id: string, over: Partial<{ cutEnabled: boolean; closedAt: Date | null; format: string }> = {}) => ({
    id,
    type: STROKE,
    format: FMT,
    cutEnabled: false,
    closedAt: null as Date | null,
    ...over,
  });
  const allIn = () => ({ final: 5, total: 5 });

  it("is the feeder and its next when every card is final", () => {
    const rs = [mk("a"), mk("b", { cutEnabled: true })];
    expect(roundReadyForCut(rs, allIn)).toEqual({ feeder: rs[0], next: rs[1] });
  });
  it("a field of ONE final card is ready; an empty field never is", () => {
    const rs = [mk("a"), mk("b", { cutEnabled: true })];
    expect(roundReadyForCut(rs, () => ({ final: 1, total: 1 }))).not.toBeNull();
    expect(roundReadyForCut(rs, () => ({ final: 0, total: 0 }))).toBeNull();
  });
  it("one card short is not ready; more final than total still is", () => {
    const rs = [mk("a"), mk("b", { cutEnabled: true })];
    expect(roundReadyForCut(rs, () => ({ final: 4, total: 5 }))).toBeNull();
    expect(roundReadyForCut(rs, () => ({ final: 6, total: 5 }))).not.toBeNull();
  });
  it("is null for no rounds and for one round", () => {
    expect(roundReadyForCut([], allIn)).toBeNull();
    expect(roundReadyForCut([mk("a")], allIn)).toBeNull();
  });
  it("a closed feeder is passed over; the cut after it is the next one's", () => {
    const rs = [mk("a", { closedAt: new Date("2026-03-01") }), mk("b", { cutEnabled: true }), mk("c", { cutEnabled: true })];
    const got = roundReadyForCut(rs, allIn);
    expect(got?.feeder.id).toBe("b");
    expect(got?.next.id).toBe("c");
  });
  it("a closed string date also counts as closed", () => {
    const rs = [mk("a", { closedAt: "2026-03-01" as unknown as Date }), mk("b", { cutEnabled: true }), mk("c", { cutEnabled: true })];
    expect(roundReadyForCut(rs, allIn)?.feeder.id).toBe("b");
  });
  it("an unclosed round with no cut after it passes to the next feeder (continue, not stop)", () => {
    // a -> b has no cut; b -> c has one.
    const rs = [mk("a"), mk("b"), mk("c", { cutEnabled: true })];
    const asked: string[] = [];
    const got = roundReadyForCut(rs, (r) => {
      asked.push(r.id);
      return { final: 3, total: 3 };
    });
    expect(got?.feeder.id).toBe("b");
    // The progress of a round with no cut after it is never asked.
    expect(asked).toEqual(["b"]);
  });
  it("an earlier round still owing cards makes a later cut wait behind it", () => {
    const rs = [mk("a"), mk("b", { cutEnabled: true }), mk("c", { cutEnabled: true })];
    const got = roundReadyForCut(rs, (r) => (r.id === "a" ? { final: 1, total: 5 } : { final: 5, total: 5 }));
    expect(got).toBeNull();
  });
  it("walks every neighbouring pair, including the last pair", () => {
    const rs = [mk("a", { closedAt: new Date() }), mk("b", { cutEnabled: true }), mk("c", { cutEnabled: true })];
    const got = roundReadyForCut(rs, allIn);
    expect(got?.feeder.id).toBe("b");
    expect(got?.next.id).toBe("c");
  });
  it("a team round next to a stroke round is no stroke cut", () => {
    const rs = [mk("a"), mk("b", { cutEnabled: true, format: "Scramble" })];
    expect(roundReadyForCut(rs, allIn)).toBeNull();
  });
});
