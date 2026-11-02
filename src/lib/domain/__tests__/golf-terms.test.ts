import { describe, it, expect } from "vitest";
import {
  GOLF_TERMS,
  GOLF_REGISTERS,
  golfRegister,
  golfTermsFor,
  inClubWords,
  tableInClubWords,
  type GolfRegister,
} from "../golf-terms";
import { countryCode } from "../country";

describe("which golf a club speaks", () => {
  it("follows the club's country", () => {
    for (const c of ["GB", "Scotland", "England", "Ireland", "FR", "DE"]) {
      expect(golfRegister(c), c).toBe("uk");
    }
    for (const c of ["Australia", "AU", "New Zealand", "NZ", "South Africa", "ZA"]) {
      expect(golfRegister(c), c).toBe("au");
    }
    for (const c of ["US", "USA", "United States", "Canada", "CA"]) {
      expect(golfRegister(c), c).toBe("us");
    }
  });

  it("defaults to US where the country is blank or unlisted (Ajay, 2026-09-27)", () => {
    expect(golfRegister("")).toBe("us");
    expect(golfRegister(null)).toBe("us");
    expect(golfRegister("Japan")).toBe("us");
  });

  it("lets the club's own choice win over its country, and ignores junk", () => {
    expect(golfRegister("Scotland", "us")).toBe("us");
    expect(golfRegister("US", "uk")).toBe("uk");
    expect(golfRegister("US", "au")).toBe("au");
    expect(golfRegister("Scotland", "")).toBe("uk");
    expect(golfRegister("Scotland", "klingon")).toBe("uk");
    expect(golfRegister("Scotland", " US ")).toBe("us");
  });

  it("reads the home nations as Britain", () => {
    expect(countryCode("Scotland")).toBe("GB");
    expect(countryCode("wales")).toBe("GB");
    expect(countryCode("Northern Ireland")).toBe("GB");
  });
});

/**
 * THE WORD TABLE, COUNTRY BY COUNTRY — `docs/country-words.md` as data.
 *
 * Typed out by hand from that table, not derived from `GOLF_TERMS`, so the
 * code and the document cannot agree by construction: change a word in one
 * and this goes red until the other says the same. Each row is what a
 * secretary in that country reads on a screen.
 */
const BY_COUNTRY: Record<string, {
  register: GolfRegister;
  community: string;
  golfGroup: string;
  outing: string;
  group: string;
  cart: string;
  organizer: string;
  charityDay: string;
  honoursBoard: string;
}> = {
  US: { register: "us", community: "league", golfGroup: "golf group", outing: "outing", group: "foursome", cart: "cart", organizer: "organizer", charityDay: "charity outing", honoursBoard: "honors board" },
  CA: { register: "us", community: "league", golfGroup: "golf group", outing: "outing", group: "foursome", cart: "cart", organizer: "organizer", charityDay: "charity outing", honoursBoard: "honors board" },
  GB: { register: "uk", community: "society", golfGroup: "society", outing: "society day", group: "fourball", cart: "buggy", organizer: "organiser", charityDay: "charity day", honoursBoard: "honours board" },
  IE: { register: "uk", community: "society", golfGroup: "society", outing: "society day", group: "fourball", cart: "buggy", organizer: "organiser", charityDay: "charity day", honoursBoard: "honours board" },
  AU: { register: "au", community: "society", golfGroup: "society", outing: "golf day", group: "fourball", cart: "cart", organizer: "organiser", charityDay: "charity golf day", honoursBoard: "honours board" },
  NZ: { register: "au", community: "society", golfGroup: "society", outing: "golf day", group: "fourball", cart: "cart", organizer: "organiser", charityDay: "charity golf day", honoursBoard: "honours board" },
  ZA: { register: "au", community: "society", golfGroup: "society", outing: "golf day", group: "fourball", cart: "cart", organizer: "organiser", charityDay: "charity golf day", honoursBoard: "honours board" },
};

describe("every country reads its own golf", () => {
  for (const [country, want] of Object.entries(BY_COUNTRY)) {
    it(`${country}`, () => {
      const r = golfRegister(country);
      expect(r).toBe(want.register);
      const words = golfTermsFor(r);
      for (const key of ["community", "golfGroup", "outing", "group", "cart", "organizer", "charityDay", "honoursBoard"] as const) {
        expect(words[key], `${country} ${key}`).toBe(want[key]);
      }
    });
  }

  it("CONTROL: the table above can tell the registers apart", () => {
    // Were every register the same, every row would pass on one set of words.
    const sets = new Set(Object.values(BY_COUNTRY).map((w) => JSON.stringify({ ...w, register: "" })));
    expect(sets.size).toBe(3);
  });
});

describe("the words", () => {
  it("names every concept in every register, and differently somewhere", () => {
    for (const [key, words] of Object.entries(GOLF_TERMS)) {
      for (const r of GOLF_REGISTERS) expect(words[r].trim(), `${key}.${r}`).not.toBe("");
      // A concept every register says the same way is not a term — it is a word.
      expect(new Set(GOLF_REGISTERS.map((r) => words[r])).size, `${key} is the same word everywhere`).toBeGreaterThan(1);
    }
  });

  it("keeps the third register small: au differs from uk in a handful of words", () => {
    const differ = Object.keys(GOLF_TERMS).filter((k) => {
      const w = GOLF_TERMS[k as keyof typeof GOLF_TERMS];
      return w.au !== w.uk;
    });
    // cart, carts, outing, outings, charityDay, strokeCompetition, strokeRound.
    expect(differ.length).toBeLessThanOrEqual(8);
    expect(differ).toContain("cart");
    expect(differ).toContain("outing");
  });

  it("never swaps a Rules of Golf format's name", () => {
    // UK "foursomes" is alternate shot; a US "foursome" is a group of four.
    // The table may use "foursome" for the GROUP, but never as a key for the
    // format, and never rename a format — those names are the Rules'.
    const keys = Object.keys(GOLF_TERMS).join(" ").toLowerCase();
    for (const format of ["foursomes", "fourball", "four-ball", "greensomes", "scramble", "stableford", "chapman"]) {
      expect(keys, `a format (${format}) is a term`).not.toContain(format);
    }
    // And no register's word for anything IS a format name with its capital.
    for (const words of Object.values(GOLF_TERMS)) {
      for (const r of GOLF_REGISTERS) expect(words[r], `${r}`).not.toMatch(/^(Foursomes|Four-Ball|Greensomes)$/);
    }
  });

  it("resolves a whole register at once", () => {
    expect(golfTermsFor("us").cart).toBe("cart");
    expect(golfTermsFor("uk").cart).toBe("buggy");
    expect(golfTermsFor("au").cart).toBe("cart");
    expect(golfTermsFor("uk").group).toBe("fourball");
    expect(golfTermsFor("us").organizer).toBe("organizer");
  });
});

describe("filling a sentence with the club's words", () => {
  it("fills a token, capitalises a capital one, and leaves a non-term alone", () => {
    const uk = golfTermsFor("uk");
    expect(inClubWords("Leagues and {golfGroups}", uk)).toBe("Leagues and societies");
    expect(inClubWords("{Outing} result", uk)).toBe("Society day result");
    expect(inClubWords("{Outing} result", golfTermsFor("us"))).toBe("Outing result");
    expect(inClubWords("a {nonsense} here", uk)).toBe("a {nonsense} here");
    expect(inClubWords("no tokens", uk)).toBe("no tokens");
  });

  it("fills every string of a table and leaves its shape", () => {
    const table = { id: "x", lines: ["Ask your {organizer}", "In every {cart}"], n: 3 };
    expect(tableInClubWords(table, golfTermsFor("uk"))).toEqual({ id: "x", lines: ["Ask your organiser", "In every buggy"], n: 3 });
    expect(tableInClubWords(table, golfTermsFor("au"))).toEqual({ id: "x", lines: ["Ask your organiser", "In every cart"], n: 3 });
  });
});
