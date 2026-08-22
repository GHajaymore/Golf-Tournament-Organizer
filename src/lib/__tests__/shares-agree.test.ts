import { describe, it, expect } from "vitest";
import { GOLF_FORMATS, findFormat, needsTeams, sideSizeRange } from "@/lib/formats";
import { sidePlayingHandicap } from "@/lib/services/teams";
import { sideHandicap } from "@/lib/domain/team";

/**
 * The screen and the scorer price a side the same way.
 *
 * `sidePlayingHandicap` decides what a side actually plays off. The Rounds &
 * formats screen shows the organizer `weightsBySideSize` as "recommended
 * shares". Those are two readers of one rule, and they disagreed.
 *
 * A scramble's descending table was reachable only through a regex on the
 * format's NAME inside the scorer:
 *
 *     if (/scramble/i.test(f.name)) { ... SCRAMBLE_WEIGHTS_4 ... }
 *
 * so the screen read `weightsBySideSize`, found nothing, and showed a flat 25%
 * of the combined handicaps. For a side off 6/14/22/31 the screen implied 18
 * shots and the scorer used 11. Nothing on either screen said the other
 * existed, and the format catalogue's own header promises that adding an entry
 * makes it work "everywhere the format picker is used" — which a name match
 * quietly breaks for anything called anything else.
 *
 * Swept across every team format and every side size it allows, so a format
 * added later is checked the day it is added.
 */

/** Four real course handicaps, spread wide enough that the two schemes differ. */
const HANDICAPS = [6, 14, 22, 31];

describe("what the screen shows is what the scorer uses", () => {
  const teamFormats = GOLF_FORMATS.filter((f) => needsTeams(f.name));

  it("covers every team format, so this cannot silently test nothing", () => {
    expect(teamFormats.length).toBeGreaterThan(5);
  });

  for (const format of teamFormats) {
    const { min, max } = sideSizeRange(format.name);
    for (let size = Math.max(2, min); size <= max; size += 1) {
      it(`${format.name}, sides of ${size}`, () => {
        const hcps = HANDICAPS.slice(0, size);
        const scorer = sidePlayingHandicap(hcps, format.name);

        // What the screen offers as this round's shares.
        const shown = findFormat(format.name).weightsBySideSize?.[size] ?? null;
        const screen = shown
          ? sideHandicap(hcps, 0, shown)
          : sideHandicap(hcps, findFormat(format.name).allowance);

        expect(
          screen,
          `${format.name} at ${size} a side: the screen prices this at ${screen} and the ` +
            `scorer at ${scorer}. One of them is what the field will be told.`,
        ).toBe(scorer);
      });
    }
  }
});
