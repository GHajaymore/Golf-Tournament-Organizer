import { describe, it, expect } from "vitest";
import { nothingDrawnWords } from "../nothing-drawn";
import { readSource } from "../../__tests__/source";

/**
 * J06 (state machine PR 3): the dashboard's tile over a round robin with
 * nothing drawn says WHY, in plain words, with the way forward — where it read
 * "Matches complete 0/0 · 0% of this round".
 *
 * A round robin's fixtures are drawn inside its flights (every player meets
 * everyone in their flight), so with no flights there is nobody to play; with
 * flights and no draw, the pairings are owed; a round fed by a cut is drawn
 * once the round before it closes.
 */
const screens = { flightsScreen: "Flights", roundsScreen: "Rounds & formats" };

describe("why a round robin has no matches yet", () => {
  it("no flights: says so, and sends the organizer to make them", () => {
    const w = nothingDrawnWords({ groups: 0, roundLabel: "Round 1", cutFed: false, ...screens });
    expect(w.value).toBe("No flights yet");
    expect(w.why).toBe("A round robin is played inside flights, and none are made yet, so nobody has anyone to play.");
    expect(w.wayOut).toEqual({ says: "Make the flights on Flights", href: "/grouping" });
  });

  it("flights made, nothing drawn: the pairings are owed, on Rounds & formats", () => {
    const w = nothingDrawnWords({ groups: 3, roundLabel: "Round 2", cutFed: false, ...screens });
    expect(w.why).toBe("The flights are made, but Round 2's pairings have not been generated.");
    expect(w.wayOut).toEqual({ says: "Generate them on Rounds & formats", href: "/stages" });
  });

  it("a cut-fed round waits for the round before it, whatever the flights", () => {
    for (const groups of [0, 2]) {
      const w = nothingDrawnWords({ groups, roundLabel: "Round 2", cutFed: true, ...screens });
      expect(w.why).toContain("make the cut");
      expect(w.wayOut.href).toBe("/stages");
    }
  });

  it("never prints the fraction it replaces", () => {
    for (const groups of [0, 2]) for (const cutFed of [false, true]) {
      const w = nothingDrawnWords({ groups, roundLabel: "Round 1", cutFed, ...screens });
      expect(`${w.value} ${w.why}`).not.toMatch(/0\/0|0%/);
    }
  });

  it("the dashboard draws it for a round robin with nothing drawn — and keeps the tile otherwise", () => {
    const src = readSource("src/app/(app)/dashboard/page.tsx");
    expect(src).toMatch(/isStaff && state\.boardStage\?\.type === "Round Robin" && state\.boardProgress\.total === 0\s*\?\s*nothingDrawnWords\(/);
    // Both places that printed "0/0" over it: the Matches tile and the Current round card.
    expect(src.match(/: nothingDrawn \?/g)?.length ?? 0).toBe(2);
    // CONTROL: the ordinary tile is still there for a round robin under way.
    expect(src).toContain('label="Matches complete"');
  });
});
