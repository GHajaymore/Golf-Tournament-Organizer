import { describe, it, expect } from "vitest";
import { matchLine } from "../match-line";
import { readSource } from "../../__tests__/source";
import type { HoleResult } from "../types";

/**
 * A one-off match's summary in golf's words. Cards are built from the Rules of
 * Golf, not from what the code returns: a match ends when one side is up by
 * more holes than remain (Rule 3.2a(3)), and "N&M" is N up with M to play.
 */
const card = (played: string, total = 18): HoleResult[] => {
  const holes: HoleResult[] = new Array(total).fill(null);
  [...played].forEach((c, i) => (holes[i] = c as HoleResult));
  return holes;
};
const line = (played: string, forfeitedBy = "") =>
  matchLine({ aId: "p-ann", bId: "p-bob", aName: "Ann", bName: "Bob", holes: card(played), forfeitedBy });

describe("matchLine", () => {
  it("says the match has not started on an empty card", () => {
    expect(line("")).toBe("Not started — no holes on the card yet");
  });

  it("names the leader and the holes played while it is live", () => {
    expect(line("AAH")).toBe("Ann 2 up through 3");
    expect(line("BHH")).toBe("Bob 1 up through 3");
    expect(line("AB")).toBe("All square through 2");
  });

  it("names the winner and the margin once it is closed out — 7&6", () => {
    // Bob wins seven of the first twelve and halves five: 7 up with 6 to play.
    expect(line("BBHBHBHBHBHB")).toBe("Bob won 7&6");
  });

  it("names a win on the last hole as N UP, and a halved match as halved", () => {
    expect(line("AHHHHHHHHHHHHHHHHH")).toBe("Ann won 1 UP");
    expect(line("ABHHHHHHHHHHHHHHHH")).toBe("Halved — all square after 18");
  });

  it("names a concession for what it is, whatever the card says — keyed on the PLAYER ID forfeitMatch stores", () => {
    expect(line("AAA", "p-bob")).toBe("Ann won — Bob conceded");
    expect(line("", "p-ann")).toBe("Bob won — Ann conceded");
    // A side letter is not what is stored, and an id from some other match is
    // not a concession here: the card decides.
    expect(line("AAH", "B")).toBe("Ann 2 up through 3");
    expect(line("AAH", "p-someone-else")).toBe("Ann 2 up through 3");
  });

  it("is what a casual singles match's summary shows, fed the stored forfeit", () => {
    const dash = readSource("src", "app", "(app)", "dashboard", "page.tsx");
    expect(dash).toContain("if (!casualMatch) return \"\";");
    expect(dash).toContain("forfeitedBy: only.forfeitedBy ?? \"\"");
    expect(dash).toContain("{oneMatchLine ? (");
  });
});
