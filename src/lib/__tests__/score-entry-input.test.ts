import { describe, it, expect } from "vitest";
import { parseHoleTranscript, type SpokenPlayer } from "@/lib/domain/score-entry-input";
import { parseStrokesTranscript } from "@/lib/domain/stroke";

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
