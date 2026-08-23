import { describe, it, expect } from "vitest";
import { parseGroupCardReading, groupCardPrompt } from "../group-card-reading";

/**
 * Reading a whole card — every player on it — from one photograph.
 *
 * The tests are lopsided on purpose, and so is the code. A misread DIGIT is
 * bounded: one hole, one player, and the player certifying is looking straight
 * at the number. A row given to the WRONG PLAYER is unbounded: two complete
 * rounds swapped, both plausible, and certification cannot catch it because
 * the card in front of the player is not theirs.
 *
 * So most of what follows is about names.
 */

const GROUP = [
  { playerId: "p1", name: "zz Alex Vaughn" },
  { playerId: "p2", name: "zz Sam Okafor" },
  { playerId: "p3", name: "zz Priya Nair" },
  { playerId: "p4", name: "zz Marco Diaz" },
];

const nine = (n: number) => new Array(9).fill(n);
const row = (name: string, strokes: unknown[] = nine(4)) => ({ name, strokes });

describe("reading four rows from one card", () => {
  it("matches every player and keeps their own strokes", () => {
    const r = parseGroupCardReading(
      [row("zz Alex Vaughn", nine(4)), row("zz Sam Okafor", nine(5)), row("zz Priya Nair", nine(6)), row("zz Marco Diaz", nine(7))],
      9,
      GROUP,
    );
    expect(r.rows).toHaveLength(4);
    expect(r.unmatched).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(r.rows.find((x) => x.playerId === "p2")!.reading.strokes).toEqual(nine(5));
  });

  it("does not care what order the rows come back in", () => {
    // The row order on a card will not match the tee sheet's, which is exactly
    // why rows are matched by name rather than taken by position.
    const r = parseGroupCardReading(
      [row("zz Marco Diaz", nine(7)), row("zz Alex Vaughn", nine(4))],
      9,
      GROUP,
    );
    expect(r.rows.find((x) => x.playerId === "p4")!.reading.strokes).toEqual(nine(7));
    expect(r.rows.find((x) => x.playerId === "p1")!.reading.strokes).toEqual(nine(4));
  });

  it("reads the names a card is actually written with", () => {
    // Biro, at speed, on a windy first tee.
    for (const written of ["A. Vaughn", "vaughn", "ALEX VAUGHN", "Alex  Vaughn"]) {
      const r = parseGroupCardReading([row(`zz ${written}`)], 9, GROUP);
      expect(r.rows[0]?.playerId, written).toBe("p1");
    }
  });
});

describe("a name it cannot place", () => {
  it("reports the row rather than giving it to whoever is left", () => {
    // The failure this module exists to prevent. Three matched rows and a
    // fourth nobody recognises must NOT become the fourth player's round.
    const r = parseGroupCardReading(
      [row("zz Alex Vaughn"), row("zz Sam Okafor"), row("zz Priya Nair"), row("A Stranger", nine(3))],
      9,
      GROUP,
    );
    expect(r.rows).toHaveLength(3);
    expect(r.unmatched).toEqual(["A Stranger"]);
    // Marco is reported as having no row, not handed the stranger's scores.
    expect(r.missing.map((m) => m.playerId)).toEqual(["p4"]);
  });

  it("refuses an ambiguous first name instead of picking one", () => {
    // A card that says "Sam" in a group with two Sams genuinely does not say
    // whose row it is, and the app must not decide.
    const twoSams = [
      { playerId: "a", name: "zz Sam Okafor" },
      { playerId: "b", name: "zz Sam Whitfield" },
    ];
    const r = parseGroupCardReading([row("zz Sam", nine(5))], 9, twoSams);
    expect(r.rows).toEqual([]);
    expect(r.unmatched).toEqual(["zz Sam"]);
  });

  it("takes a surname when it is unique, because that is what people write", () => {
    const twoSams = [
      { playerId: "a", name: "zz Sam Okafor" },
      { playerId: "b", name: "zz Sam Whitfield" },
    ];
    const r = parseGroupCardReading([row("Okafor", nine(5))], 9, twoSams);
    expect(r.rows[0]?.playerId).toBe("a");
  });

  it("gives a player at most one row", () => {
    // A model returning the same person twice must not overwrite the card it
    // already produced for them.
    const r = parseGroupCardReading(
      [row("zz Alex Vaughn", nine(4)), row("zz Alex Vaughn", nine(9))],
      9,
      GROUP,
    );
    expect(r.rows.filter((x) => x.playerId === "p1")).toHaveLength(1);
    expect(r.rows[0].reading.strokes).toEqual(nine(4));
    expect(r.unmatched).toEqual(["zz Alex Vaughn"]);
  });
});

describe("digits, where the rule is relaxed", () => {
  it("returns null for a hole it cannot read, and says which", () => {
    const strokes: unknown[] = [4, null, 5, "6", "?", 4, 4, 4, 4];
    const r = parseGroupCardReading([row("zz Alex Vaughn", strokes)], 9, GROUP);
    expect(r.rows[0].reading.strokes).toEqual([4, null, 5, 6, null, 4, 4, 4, 4]);
    expect(r.rows[0].reading.unreadable).toEqual([2, 5]);
  });

  it("throws out a score no golfer records", () => {
    // Range-checked like the single-player reader: a 41 is a misread, not a
    // hole somebody played.
    const r = parseGroupCardReading([row("zz Alex Vaughn", [41, 0, -3, 4, 4, 4, 4, 4, 4])], 9, GROUP);
    expect(r.rows[0].reading.strokes.slice(0, 3)).toEqual([null, null, null]);
  });

  it("drops a row with nothing readable on it at all", () => {
    // Not evidence of anybody, so not worth reporting as a missing player
    // either — it is a blank line on the card.
    const r = parseGroupCardReading([row("zz Alex Vaughn", new Array(9).fill(null))], 9, GROUP);
    expect(r.rows).toEqual([]);
    expect(r.unmatched).toEqual([]);
  });
});

describe("whatever the model actually returns", () => {
  it("survives every wrapper and every kind of rubbish", () => {
    for (const junk of [null, undefined, "nope", 42, {}, [], { rows: "no" }]) {
      const r = parseGroupCardReading(junk, 9, GROUP);
      expect(r.empty, String(junk)).toBe(true);
      expect(r.missing, String(junk)).toHaveLength(4);
    }
  });

  it("accepts the common wrappers a model puts round an array", () => {
    const wrapped = { rows: [row("zz Alex Vaughn", nine(4))] };
    expect(parseGroupCardReading(wrapped, 9, GROUP).rows).toHaveLength(1);
    expect(parseGroupCardReading({ players: [row("zz Sam Okafor", nine(5))] }, 9, GROUP).rows).toHaveLength(1);
  });
});

describe("what is asked for", () => {
  it("names who the app expects, turning identification into verification", () => {
    // The app already knows the tee group, so the model is verifying rather
    // than guessing — which is what makes reading the app's own printed card
    // straightforward.
    const prompt = groupCardPrompt(18, ["zz Alex Vaughn", "zz Sam Okafor"]);
    expect(prompt).toContain("zz Alex Vaughn, zz Sam Okafor");
    expect(prompt).toContain("18");
  });

  it("still asks for the name actually read", () => {
    // Otherwise a card carrying somebody else entirely gets quietly mapped
    // onto an expected player.
    expect(groupCardPrompt(18, ["zz Alex Vaughn"])).toContain("name you actually READ");
  });

  it("asks for null rather than a guess", () => {
    expect(groupCardPrompt(9, [])).toContain("null");
  });
});
