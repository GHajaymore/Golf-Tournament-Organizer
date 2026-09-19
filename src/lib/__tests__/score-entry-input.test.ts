import { describe, it, expect } from "vitest";
import { parseTypedCard, parseHoleTranscript, type SpokenPlayer } from "@/lib/domain/score-entry-input";
import { parseStrokesTranscript } from "@/lib/domain/stroke";

describe("typing a whole card", () => {
  it("reads scores separated by spaces or commas", () => {
    const r = parseTypedCard("4 5 3, 4 4 5 3 4 4", 9);
    expect(r).toEqual({ ok: true, strokes: [4, 5, 3, 4, 4, 5, 3, 4, 4], filled: 9 });
  });

  it("splits a run of digits one per hole only when it is exactly the right length", () => {
    expect(parseTypedCard("453445344", 9)).toMatchObject({ ok: true, strokes: [4, 5, 3, 4, 4, 5, 3, 4, 4] });
    const short = parseTypedCard("45344534", 9);
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.problem).toContain("8 digits for 9 holes");
  });

  it("leaves a hole blank for a dash, and fills from the 1st when fewer are typed", () => {
    const r = parseTypedCard("4 - 3 x 5", 9);
    expect(r).toEqual({ ok: true, strokes: [4, null, 3, null, 5, null, null, null, null], filled: 3 });
  });

  it("keeps a double-figure score as one hole, not two", () => {
    expect(parseTypedCard("4 10 3", 3)).toMatchObject({ ok: true, strokes: [4, 10, 3] });
  });

  it("refuses more scores than holes rather than guessing which one is extra", () => {
    const r = parseTypedCard("4 5 3 4", 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain("4 scores for 3 holes");
  });

  it("refuses a word or an impossible number, and names the hole", () => {
    const word = parseTypedCard("4 five 3", 3);
    expect(word.ok).toBe(false);
    if (!word.ok) expect(word.problem).toContain("hole 2");
    const zero = parseTypedCard("4 0 3", 3);
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.problem).toContain("hole 2");
  });

  it("asks for something when nothing is typed", () => {
    expect(parseTypedCard("   ", 18).ok).toBe(false);
  });
});

const group: SpokenPlayer[] = [
  { id: "me", name: "Alex Rowan", isMe: true },
  { id: "mw", name: "Marcus Webb" },
  { id: "sn", name: "Síle Ní Bhraonáin" },
  { id: "sk", name: "Sang-woo Kim" },
];

describe("saying one hole's scores for the group", () => {
  it("gives scores in card order when nobody is named", () => {
    expect(parseHoleTranscript("four five three four", group, 4)).toEqual({ me: 4, mw: 5, sn: 3, sk: 4 });
  });

  it("gives a named score to that player, in any order", () => {
    expect(parseHoleTranscript("Marcus five, me four", group, 4)).toEqual({ mw: 5, me: 4 });
  });

  it("reads golf words against the hole's par", () => {
    expect(parseHoleTranscript("Síle birdie Marcus double bogey", group, 4)).toEqual({ sn: 3, mw: 6 });
  });

  it("fills an unnamed score into the next player who has not had one", () => {
    // Marcus is named first; the next two unnamed go to me, then Síle.
    expect(parseHoleTranscript("Marcus 6, 4, 5", group, 4)).toEqual({ mw: 6, me: 4, sn: 5 });
  });

  it("never writes to anybody outside the group, whatever name is said", () => {
    // "Tom" is in the field, perhaps, but not in this group: his score lands
    // on nobody, and the next number goes to the next player in order.
    const out = parseHoleTranscript("Tom three", group, 4);
    expect(Object.keys(out).every((id) => group.some((p) => p.id === id))).toBe(true);
    expect(out).toEqual({ me: 3 });
  });

  it("names nobody when two players share the first name said", () => {
    const twins: SpokenPlayer[] = [
      { id: "a", name: "Sam Jones", isMe: true },
      { id: "b", name: "Sam Patel" },
    ];
    // "Sam" is ambiguous, so the score falls to the next in order, not to a guess.
    expect(parseHoleTranscript("Sam five", twins, 4)).toEqual({ a: 5 });
  });

  it("returns only what was heard, so a partial dictation blanks nothing", () => {
    expect(parseHoleTranscript("Marcus five", group, 4)).toEqual({ mw: 5 });
    expect(parseHoleTranscript("mumble", group, 4)).toEqual({});
  });
});

describe("the whole-card dictation still reads as before", () => {
  it("reads numbers and golf words hole by hole against each par", () => {
    // Pinned because its word reader is now shared with the group dictation.
    expect(parseStrokesTranscript("par birdie double bogey 5 six", [4, 3, 5, 4, 4], 0)).toEqual([4, 2, 7, 5, 6]);
  });
});
