import { describe, it, expect } from "vitest";
import { playersOnScratchByDefault, scratchNote } from "@/components/NewMatchForm";
import { inheritedLabel } from "@/components/RoundVenue";
import { progressLine } from "@/components/StrokePlayEntry";
import { readSource } from "./source";

/**
 * A CASUAL ROUND SAYS WHAT IT HAS ASSUMED — walked as a member on a 393px
 * phone, 2026-09-27.
 *
 * Two things a two-ball with a guest was told nothing about:
 *
 *   - a guest whose handicap box was left empty started the card on "hcp 0",
 *     on a NET round, which gives their whole handicap away without anybody
 *     having decided to;
 *   - the tee picker offered "Blue (the tournament's)" on a round that has no
 *     tournament;
 *   - a finished nine read "Front 40 · Back —" under the card, as if half of
 *     it were missing.
 *
 * And the handicap boxes had no name: the caption was never attached, so a
 * screen reader announced the placeholder, "12.4", for every player.
 */
describe("who plays off scratch because the box was empty", () => {
  it("names the named players with an empty box, and nobody else", () => {
    expect(
      playersOnScratchByDefault([
        { name: "Sam Okafor", hcp: "8.4" },
        { name: " Guest Golfer ", hcp: "" },
        { name: "", hcp: "" }, // an unused row is not a player
        { name: "Ana Ferreira", hcp: "  " },
        { name: "Plus Man", hcp: "+1.2" },
      ]),
    ).toEqual(["Guest Golfer", "Ana Ferreira"]);
  });

  it("says it in a sentence that agrees with its subject", () => {
    expect(scratchNote([])).toBeNull();
    expect(scratchNote(["Guest Golfer"])).toBe(
      "Guest Golfer has no handicap here, so plays off scratch (0). Add it if they have one.",
    );
    expect(scratchNote(["A", "B"])).toBe("A and B have no handicap here, so play off scratch (0). Add it if they have one.");
    expect(scratchNote(["A", "B", "C"])).toMatch(/^A, B and C have/);
  });

  it("is shown only when shots are being given, and every handicap box is named for its player", () => {
    const src = readSource("src", "components", "NewMatchForm.tsx");
    expect(src).toMatch(/\{useHandicaps && scratchByDefault && \(/);
    expect(src).toMatch(/aria-label=\{`Handicap for \$\{p\.name\.trim\(\) \|\| `player \$\{i \+ 1\}`\}`\}/);
  });
});

describe("the line under a card counts the holes the round has", () => {
  it("an eighteen reads by nines", () => {
    expect(progressLine({ front: 37, back: 0, played: 9 }, 18)).toBe("Front 37 · Back — · 9/18 holes");
    expect(progressLine({ front: 37, back: 38, played: 18 }, 18)).toBe("Front 37 · Back 38 · 18/18 holes");
  });

  it("a nine has no other half to be missing", () => {
    // Walked: "Front 40 · Back — · 9/9 holes" on a finished nine.
    expect(progressLine({ front: 40, back: 0, played: 9 }, 9)).toBe("9/9 holes");
    expect(progressLine({ front: 0, back: 0, played: 0 }, 9)).not.toMatch(/Front|Back/);
  });
});

describe("the tees a round inherits, named for what it inherits from", () => {
  it("a tournament round inherits the tournament's", () => {
    expect(inheritedLabel("Whites", false)).toBe("Whites (the tournament's)");
    expect(inheritedLabel("", false)).toBe("The tournament's");
  });

  it("a casual round has no tournament, so it keeps what it was set up with", () => {
    expect(inheritedLabel("Blue", true)).toBe("Blue (as set up)");
    expect(inheritedLabel("", true)).toBe("As set up");
    expect(inheritedLabel("Blue", true)).not.toContain("tournament");
  });

  it("score entry tells the picker which it is", () => {
    const src = readSource("src", "components", "EntryModes.tsx");
    expect(src).toMatch(/<RoundVenue[\s\S]*?casual=\{casual\}/);
  });
});
