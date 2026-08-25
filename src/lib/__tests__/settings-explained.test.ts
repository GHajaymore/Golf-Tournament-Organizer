import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as settings from "@/lib/tournament-settings";

/**
 * Every setting a club can change must SAY WHAT IT DOES.
 *
 * These are not preferences. Each one changes who may enter a score, who may
 * see a result, or which tees a field is scored off — and an organizer
 * choosing between two labels they do not understand is choosing at random.
 * The consequence lands on players, weeks later, as strokes or a board that
 * was blind when it should not have been.
 *
 * Help WAS the thing most likely to be skipped, because nothing failed when
 * it was: seven settings carried a label, four carried an explanation, and
 * the three without were among the most consequential — who may enter a
 * score, whether the board moves live, and how a player gets in at all.
 * A coverage rule you have to remember is a coverage rule that will be
 * forgotten, so it is enforced here rather than written down somewhere.
 *
 * Derived from the module's own exports rather than a list kept here. A list
 * would be one more thing to update, and the update it missed would be the
 * new setting nobody explained.
 */
describe("every setting explains itself", () => {
  const labelMaps = Object.keys(settings).filter((k) => k.endsWith("_LABEL"));

  it("finds the settings by their own exports, not a list to maintain", () => {
    // If this drops to nothing the sweep below is vacuously green, which is
    // the failure mode of every guard that enumerates something.
    expect(labelMaps.length).toBeGreaterThanOrEqual(7);
  });

  for (const labelKey of labelMaps) {
    const base = labelKey.replace(/_LABEL$/, "");
    const helpKey = `${base}_HELP`;

    it(`${base} has an explanation for every option`, () => {
      const labels = (settings as Record<string, unknown>)[labelKey] as Record<string, string>;
      const help = (settings as Record<string, unknown>)[helpKey] as Record<string, string> | undefined;

      expect(
        help,
        `${base} offers choices with no explanation. Add ${helpKey} — an organizer picking between labels they do not understand is picking at random, and the cost lands on players.`,
      ).toBeTruthy();
      if (!help) return;

      // Every option, not most of them. The unexplained one is the one
      // somebody will choose by mistake.
      for (const option of Object.keys(labels)) {
        expect(help[option], `${base}.${option} has a label but no explanation`).toBeTruthy();
      }
      // And nothing explaining an option that no longer exists — a stale
      // paragraph describing a removed choice is worse than none.
      for (const option of Object.keys(help)) {
        expect(labels[option], `${helpKey}.${option} explains an option that is not offered`).toBeTruthy();
      }
    });

    it(`${base}'s explanation is actually put on the screen`, () => {
      /**
       * A map nobody renders is the same as no help at all.
       *
       * This was written after the first version of this guard passed while
       * three settings had explanations that reached no screen: the maps
       * existed, `PlaySettings` never passed them, and the organizer saw two
       * bare labels exactly as before. Existing and being shown are different
       * claims and both have to be made.
       */
      const help = (settings as Record<string, unknown>)[helpKey];
      if (!help) return;
      const ui = readFileSync(join(process.cwd(), "src/components/PlaySettings.tsx"), "utf8");
      // `help={X_HELP}`, not merely the name appearing somewhere. The first
      // version looked for the name and an IMPORT satisfied it — so deleting
      // the one line that put the text on screen left the guard green. A
      // guard that a no-op passes is not a guard.
      expect(
        new RegExp(`help=\\{${helpKey}\\}`).test(ui),
        `${helpKey} is written but never passed to a control, so nobody reads it`,
      ).toBe(true);
    });

    it(`${base} explanations say something worth reading`, () => {
      const help = (settings as Record<string, unknown>)[helpKey] as Record<string, string> | undefined;
      if (!help) return;
      for (const [option, text] of Object.entries(help)) {
        // A one-word "help" is the box being ticked rather than the question
        // being answered. The bar is deliberately low but not absent.
        expect(text.trim().length, `${helpKey}.${option} is too short to explain anything`).toBeGreaterThan(30);
        // Not just the label again in a different font.
        const labels = (settings as Record<string, unknown>)[labelKey] as Record<string, string>;
        expect(text.trim().toLowerCase()).not.toBe(labels[option]?.trim().toLowerCase());
      }
    });
  }
});
