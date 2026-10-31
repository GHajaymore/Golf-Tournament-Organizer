import { describe, it, expect } from "vitest";
import { CARD_MM, FOLDOUT_MM, SHEET_SLOTS, cardFormat, cardName, docTitle, sheetsFor, twoUp, type PaperUnit } from "../print-kit";
import { golfTermsFor } from "../golf-terms";

/**
 * THE NORMAL SCORECARD (panel ruling of 30 Oct 2026; Ajay: "any card is the card
 * size", with exceptions only "where we cant meet the normal scorecard").
 * Worked from the ruling's own tables, not from the code: 9.5 × 3.75 in, two to a
 * sheet, the slot positions on Letter and A4, and the fold-out only for X1–X3.
 */
const IN = 25.4;

describe("the normal card", () => {
  it("is 9.5 × 3.75 inches, with a 4 mm safe box", () => {
    expect(CARD_MM.w).toBeCloseTo(9.5 * IN, 6);
    expect(CARD_MM.h).toBeCloseTo(3.75 * IN, 6);
    expect(CARD_MM.safe).toBe(4);
    // The fold-out is twice as tall and folds once to it.
    expect(FOLDOUT_MM).toEqual({ w: CARD_MM.w, h: 2 * CARD_MM.h });
  });

  it("sits two-up on both papers at the ruling's positions, inside the sheet, with no ink within 5 mm of an edge", () => {
    // From the ruling's table (3.3).
    expect(SHEET_SLOTS.letter).toMatchObject({ x: 19.05, cards: [9.5, 111.1] });
    expect(SHEET_SLOTS.letter.w).toBeCloseTo(11 * IN, 6);
    expect(SHEET_SLOTS.letter.h).toBeCloseTo(8.5 * IN, 6);
    expect(SHEET_SLOTS.a4).toMatchObject({ w: 297, h: 210, x: 27.85, cards: [6.5, 108.25] });
    for (const s of Object.values(SHEET_SLOTS)) {
      // Centred across: the two side margins agree.
      expect(s.x * 2 + CARD_MM.w).toBeCloseTo(s.w, 1);
      // The two cards and the gutter between them fit the sheet, and the gutter is real.
      const gutter = s.cards[1] - (s.cards[0] + CARD_MM.h);
      expect(gutter).toBeGreaterThan(6);
      expect(s.cards[1] + CARD_MM.h).toBeLessThanOrEqual(s.h - 6);
      // A fold-out fits one to a sheet.
      expect(s.foldout + FOLDOUT_MM.h).toBeLessThanOrEqual(s.h - 6);
      // Crop marks sit 2..7 mm off the trim in the side margin, so the margin must be at least 12.
      expect(s.x - 7).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("where a card folds out — X1–X3 and nowhere else", () => {
  it("CONTROL: a 4-row card is a normal card; a 5-row group card is a fold-out (X2)", () => {
    expect(cardFormat({ kind: "scorecard", rows: 4, tees: 2 }).format).toBe("card");
    const five = cardFormat({ kind: "scorecard", rows: 5, tees: 1 });
    expect(five.format).toBe("fold-out");
    expect(five.reason).toContain("5 players");
  });

  it("a one-player card and a four-ball side (two partners and the side's row) are normal cards", () => {
    expect(cardFormat({ kind: "scorecard", rows: 1, tees: 1 }).format).toBe("card");
    expect(cardFormat({ kind: "scorecard", rows: 3, tees: 2 }).format).toBe("card");
  });

  it("a cup day with both formats on one card folds out (X1); one format does not", () => {
    expect(cardFormat({ kind: "cup", sections: 2, rows: 6 }).format).toBe("fold-out");
    expect(cardFormat({ kind: "cup", sections: 1, rows: 6 }).format).toBe("card");
    expect(cardFormat({ kind: "cup", sections: 1, rows: 3 }).format).toBe("card");
  });

  it("a shared-ball card folds out only with three sets of tees AND names too long for two lines (X3)", () => {
    const long = "Wilhelmina Fotheringay-Pemberton & Bartholomew Featherstonehaugh-Worthington & Al & Bo".length;
    expect(cardFormat({ kind: "scorecard", rows: 1, tees: 3, sharedBallNames: long }).format).toBe("fold-out");
    expect(cardFormat({ kind: "scorecard", rows: 1, tees: 2, sharedBallNames: long }).format).toBe("card");
    expect(cardFormat({ kind: "scorecard", rows: 1, tees: 3, sharedBallNames: 40 }).format).toBe("card");
  });

  it("a sign, a spare sign and a result slip are always normal cards", () => {
    expect(cardFormat({ kind: "fixed" })).toEqual({ format: "card", reason: "" });
  });
});

describe("a name as a card holds it", () => {
  it("keeps a name that fits, whole", () => {
    expect(cardName("Ann Teesdale", 30)).toBe("Ann Teesdale");
  });
  it("gives the initial and the rest, then the initial and the hyphenated surname — never a silent cut", () => {
    const long = "Wilhelmina Fotheringay-Pemberton-Ashcombe of Lower Hadleigh";
    expect(long).toHaveLength(59);
    expect(cardName(long, 30)).toBe("W. Fotheringay-Pemberton-Ashcombe");
    expect(cardName("Bartholomew Maximilian Ashworth", 30)).toBe("B. Maximilian Ashworth");
    expect(cardName("Bartholomew Maximilian Montgomery-Ashworthington", 30)).toBe("B. Montgomery-Ashworthington");
    // Nothing is ever cut mid-word: what is printed is a word of the name.
    for (const n of [long, "Bartholomew Maximilian Ashworth"]) {
      for (const w of cardName(n, 20).split(" ").slice(1)) expect(n).toContain(w);
    }
  });
});

describe("the sheets a press of Print makes", () => {
  const u = (doc: PaperUnit["doc"], format: PaperUnit["format"], n: number): PaperUnit[] => Array.from({ length: n }, () => ({ doc, format }));
  it("is cards two to a sheet, a fold-out one, a page one — counted within each document", () => {
    // Florida's day (the ruling's 3.9): 18 team cards, 36 cart signs, 2 spares, a 2-page starting sheet.
    expect(sheetsFor([...u("cards", "card", 18), ...u("signs", "card", 36), ...u("spare", "card", 2), ...u("start", "page", 2)])).toBe(9 + 18 + 1 + 2);
    // An odd count leaves half a sheet; a fold-out is a sheet of its own.
    expect(sheetsFor([...u("cards", "card", 3), ...u("cards", "fold-out", 1)])).toBe(2 + 1);
    // Two documents never share a sheet: the cut cards stay with their kind.
    expect(sheetsFor([...u("cards", "card", 1), ...u("signs", "card", 1)])).toBe(2);
    expect(sheetsFor([])).toBe(0);
  });

  it("lays the cards out so that, cut and stacked, they come out in order", () => {
    expect(twoUp([1, 2, 3, 4, 5])).toEqual([
      [1, 4],
      [2, 5],
      [3, null],
    ]);
    const cut = twoUp([1, 2, 3, 4, 5]);
    const tops = cut.map(([t]) => t);
    const bottoms = cut.map(([, b]) => b).filter((b) => b !== null);
    expect([...tops, ...bottoms]).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("the documents' names are the club's golf words", () => {
  it("says cart signs to an American club and buggy signs to a British one", () => {
    expect(docTitle("signs", golfTermsFor("us"))).toBe("Cart signs");
    expect(docTitle("signs", golfTermsFor("uk"))).toBe("Buggy signs");
    expect(docTitle("cards", golfTermsFor("uk"))).toBe("Scorecards");
  });
});
