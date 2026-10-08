import { describe, it, expect } from "vitest";
import { stablefordPickUp } from "../card-points";
import { stablefordPointsForHole } from "../stroke";
import { netDoubleBogey } from "../handicap-record";

/**
 * A STABLEFORD PICK-UP SCORES ZERO, AND IS THE HANDICAP SYSTEM'S OWN FIGURE
 * (Rule 21.1b; WHS net double bogey) — 2026-10-08.
 *
 * Asserted across the axis rather than on one hole: every par a card holds
 * (3, 4, 5), and every number of strokes received from none to two, since a
 * high handicap gets two on the hardest holes. If the recorded figure were one
 * stroke kinder it would earn a point the player never played for; one
 * crueller and it would wreck the handicap record for nothing.
 */
describe("a Stableford pick-up", () => {
  for (const par of [3, 4, 5]) {
    for (const received of [0, 1, 2]) {
      it(`scores zero on a par ${par} with ${received} received`, () => {
        const recorded = stablefordPickUp(par, received);
        expect(stablefordPointsForHole(recorded, par, received)).toBe(0);
        // And one stroke fewer would have been worth a point — so this is the
        // highest score that is still zero, not merely some zero.
        expect(stablefordPointsForHole(recorded - 1, par, received)).toBe(1);
        expect(recorded).toBe(netDoubleBogey(par, received));
      });
    }
  }
});
