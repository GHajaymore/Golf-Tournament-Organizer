import { describe, it, expect } from "vitest";
import { movementStory, placeIn, type MovementRound } from "../report-movement";
import { movementBetween } from "../week-movement";

/**
 * HOW IT WAS WON, from three tables built the way the week sheet builds them
 * (`movementBetween`, points high to low). The story was written out by hand
 * from the tables before the code was run:
 *
 *            Round 1        Round 2         Round 3
 *   Ash      49  1          86  3  (-2)     120  4
 *   Bea      47  T2         80  4  (-2)     100  5
 *   Cy       47  T2         89  1  (+1)     135  T2
 *   Dee      40  4          87  2  (+2)     135  T2
 *   Eli      38  5          70  5           140  1  (+4)
 *
 * It is built so the obvious shortcuts give different sentences: the leader
 * changes every round, the round-two climber is not the leader, and the
 * biggest move of the tournament (Eli, four places) is a climb TO the top.
 */
const values = (v: Record<string, number>) => Object.entries(v).map(([id, value]) => ({ playerId: id, name: id, value }));
const r1 = values({ Ash: 49, Bea: 47, Cy: 47, Dee: 40, Eli: 38 });
const r2 = values({ Ash: 86, Bea: 80, Cy: 89, Dee: 87, Eli: 70 });
const r3 = values({ Ash: 120, Bea: 100, Cy: 135, Dee: 135, Eli: 140 });
const ROUNDS: MovementRound[] = [
  { label: "Round 1", rows: movementBetween(r1, [], "desc") },
  { label: "Round 2", rows: movementBetween(r2, r1, "desc") },
  { label: "Round 3", rows: movementBetween(r3, r2, "desc") },
];
const points = (v: number) => `${v} points`;

describe("how it was won", () => {
  const told = movementStory(ROUNDS, points);

  it("tells each round in one sentence or two, in play order", () => {
    expect(told.story).toEqual([
      { label: "Round 1", text: "Ash led after Round 1 on 49 points. Bea and Cy were next on 47 points." },
      { label: "Round 2", text: "Cy went top after Round 2 on 89 points, up from a share of 2nd. Dee climbed 2 places to 2nd." },
      { label: "Round 3", text: "Eli went top after Round 3 on 140 points, up from 5th." },
    ]);
  });

  it("names the biggest climb of the tournament, a climb to the top included", () => {
    expect(told.climb).toEqual({ names: ["Eli"], places: 4, round: "Round 3", place: "1" });
  });

  it("reads a place as the table prints it, shared where it is shared", () => {
    expect(placeIn(ROUNDS[2].rows, "Cy")).toBe("T2");
    expect(placeIn(ROUNDS[2].rows, "Eli")).toBe("1");
    expect(placeIn(ROUNDS[0].rows, "Bea")).toBe("T2");
    expect(placeIn(ROUNDS[0].rows, "Nobody")).toBe("");
  });

  it("says a shared lead as shared, and a lead kept as kept", () => {
    const a = values({ Ash: 10, Bea: 10, Cy: 8 });
    const b = values({ Ash: 20, Bea: 20, Cy: 9 });
    const t = movementStory(
      [
        { label: "Round 1", rows: movementBetween(a, [], "desc") },
        { label: "Round 2", rows: movementBetween(b, a, "desc") },
      ],
      points,
    );
    expect(t.story.map((s) => s.text)).toEqual([
      "Ash and Bea shared the lead after Round 1 on 10 points. Cy was next on 8 points.",
      "Ash and Bea were still level at the top after Round 2, on 20 points.",
    ]);
    expect(t.climb).toBeNull();
  });

  it("a stroke table ranks low to high, and somebody new to it has not climbed", () => {
    const a = values({ Ash: 72, Bea: 75 });
    const b = values({ Ash: 150, Bea: 146, Cy: 140 });
    const t = movementStory(
      [
        { label: "Round 1", rows: movementBetween(a, [], "asc") },
        { label: "Round 2", rows: movementBetween(b, a, "asc") },
      ],
      (v) => `net ${v}`,
    );
    // Cy is top and NEW: "went top", with no "up from" — and arriving is not a climb.
    expect(t.story[1].text).toBe("Cy went top after Round 2 on net 140.");
    expect(t.climb).toBeNull();
  });
});
