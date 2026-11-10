import { describe, expect, it } from "vitest";
import { GOLF_REGISTERS, GOLF_TERMS, countryRegister, type GolfRegister } from "../golf-terms";
import { playKindsFor } from "../play-kind";
import { eventWords } from "../event-words";

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/**
 * WORKED FROM THE TABLE (`GOLF_TERMS`), not from the code under test: each
 * expectation reads the table's own entry for the register.
 */
describe("the words of an event, in the club's country", () => {
  it("names an outing, a charity day and a stroke-play day with the country's table word", () => {
    for (const r of GOLF_REGISTERS) {
      expect(eventWords("outing", r).kind, r).toBe(cap(GOLF_TERMS.outing[r]));
      expect(eventWords("charity", r).kind, r).toBe(cap(GOLF_TERMS.charityDay[r]));
      expect(eventWords("medal", r).kind, r).toBe(cap(GOLF_TERMS.strokeCompetition[r]));
      expect(eventWords("outing", r).kindLower, r).toBe(GOLF_TERMS.outing[r]);
      expect(eventWords("charity", r).resultHeading, r).toBe(`${cap(GOLF_TERMS.charityDay[r])} result`);
    }
  });

  it("reads the same word in every country for a kind the table has no word for", () => {
    for (const r of GOLF_REGISTERS) {
      expect(eventWords("league", r).kind).toBe("League");
      expect(eventWords("tournament", r).resultHeading).toBe("Tournament result");
    }
  });

  it("falls back to a tournament for a kind it does not know", () => {
    for (const bad of ["", "casual", "zz-nonsense", "Outing"]) {
      expect(eventWords(bad, "us").kind, bad).toBe("Tournament");
      expect(eventWords(bad, "us").resultHeading, bad).toBe("Tournament result");
    }
  });

  it("follows the country: GB and IE British, AU and ZA Australian, US American", () => {
    expect(eventWords("outing", countryRegister("US")).kind).toBe("Outing");
    expect(eventWords("outing", countryRegister("GB")).kind).toBe("Society day");
    expect(eventWords("outing", countryRegister("IE")).kind).toBe("Society day");
    expect(eventWords("outing", countryRegister("AU")).kind).toBe("Golf day");
    expect(eventWords("outing", countryRegister("ZA")).kind).toBe("Golf day");
  });
});

describe("the kinds a club is offered", () => {
  const labels = (r: GolfRegister) => playKindsFor(r).map((o) => o.label);

  it("offers a US club no British word", () => {
    expect(labels("us")).toEqual(["Tournament", "Competition", "Outing", "Charity outing", "League", "Championship", "Stroke play"]);
  });

  it("offers GB and IE their own", () => {
    expect(labels("uk")).toEqual([
      "Tournament", "Competition", "Society day", "Charity day", "League", "Championship", "Medal", "Roll-up",
    ]);
  });

  it("offers AU and ZA their own, with nothing British in it", () => {
    expect(labels("au")).toEqual(["Tournament", "Competition", "Golf day", "Charity golf day", "League", "Championship", "Stroke"]);
  });

  it("never lists one word twice, and every option's heading is its label", () => {
    for (const r of GOLF_REGISTERS) {
      const l = labels(r);
      expect(new Set(l).size, r).toBe(l.length);
      for (const o of playKindsFor(r)) expect(o.result, `${r} ${o.key}`).toBe(`${o.label} result`);
    }
  });

  it("lists a word once when a saved kind shares it: a GB event saved as society", () => {
    const options = playKindsFor("uk", "society");
    expect(options.filter((o) => o.label === "Society day")).toHaveLength(1);
    // The picker still carries the saved value, so it shows what is stored.
    expect(options.find((o) => o.label === "Society day")?.key).toBe("society");
    expect(new Set(options.map((o) => o.label)).size).toBe(options.length);
    // An unsaved GB event offers the same word under the outing key.
    expect(playKindsFor("uk").find((o) => o.label === "Society day")?.key).toBe("outing");
  });

  it("keeps a kind already saved on the event, even where the country is not offered it", () => {
    expect(labels("us")).not.toContain("Roll-up");
    const withSaved = playKindsFor("us", "rollup");
    expect(withSaved.map((o) => o.key)).toContain("rollup");
    // And it still reads, in its own word, on every screen that shows the kind.
    expect(eventWords("rollup", "us").kind).toBe("Roll-up");
    expect(eventWords("society", "us").kind).toBe("Society day");
    expect(eventWords("medal", "us").kind).toBe("Stroke play");
  });
});
