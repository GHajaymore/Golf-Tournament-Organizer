import { describe, it, expect } from "vitest";
import {
  THEME_PRESETS,
  SECONDARY_PRESETS,
  DARK_GROUND,
  LIGHT_GROUND,
  themeScale,
  resolveTheme,
  resolveSecondary,
  contrastRatio,
  type Ground,
} from "../themes";

/**
 * `--color-accent` IS STEP 500, AND STEP 500 IS NOT A TEXT COLOUR.
 *
 * `contrastFloors` has already had this argument once and won half of it. The
 * comment there is worth re-reading: step 500 "was held to 3:1 as a 'buttons
 * and borders' colour. It isn't one: .btn-primary and .btn-ghost both render
 * label text in it at normal size, so it is read as text and owes the text
 * ratio." Its floor was raised to 4.5 — **against `ground.bg`**.
 *
 * That is the half that was missed. The app does not paint accent text on the
 * ground. It paints it on a CARD, and very often on a TINT OF THE ACCENT
 * ITSELF: `color-mix(in srgb, var(--color-accent) 16%, transparent)` appears
 * thirteen times and the 12% version sixteen, because a tinted tile in the
 * accent's own hue is this design system's signature. A tint darkens a light
 * ground and lightens a dark one, moving the background toward the very colour
 * being read against it — so the surface the floor was measured on is the one
 * surface the text is not on.
 *
 * Measured across all 11 accents and 12 secondaries, worst case, both grounds:
 *
 *              plain card        12% tint        16% tint
 *   step 500   3.48  FAIL        3.05  FAIL      2.94  FAIL
 *   step 400   4.92  ok          4.27  FAIL      4.05  FAIL
 *   step 300   6.87  ok          5.96  ok        5.66  ok
 *
 * Two things follow that are easy to get wrong.
 *
 * FIRST, this is NOT a light-ground bug, though that is where it was found.
 * Step 500 as text on a plain card measures 4.01 for claret and 3.48 for the
 * fairway secondary ON THE DARK GROUND. The reason nobody had seen it is that
 * the e2e fixture's club runs Verdigris, which is one of the accents that
 * happens to clear — so a rendered sweep with one club theme cannot find this
 * class however many screens it walks. Only the arithmetic can, which is why
 * this test is here and not in a spec.
 *
 * SECOND, step 400 is not the fix even though it looks like the smaller
 * change. It clears on paper and fails on the dark ground's tints.
 *
 * So `--color-accent-300` is the accent's text colour — which is exactly what
 * `contrastFloors` already says it is: "300: text, on the card surface".
 */

/** The tint strengths this app actually paints accent text on. */
const TINTS = [0, 0.08, 0.1, 0.12, 0.14, 0.16];

const hex = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const toHex = (c: number[]) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** The accent at `a` over `bg` — what a tinted tile actually paints. */
function tintOver(accent: string, bg: string, a: number): string {
  const f = hex(accent);
  const b = hex(bg);
  return toHex([0, 1, 2].map((i) => f[i] * a + b[i] * (1 - a)));
}

/** Every ramp a club can end up with, accent and secondary alike. */
function everyRamp(ground: Ground): { label: string; scale: Record<number, string> }[] {
  return [
    ...THEME_PRESETS.map((p) => ({
      label: `accent:${p.key}`,
      scale: themeScale(resolveTheme(p.key, ""), ground),
    })),
    ...SECONDARY_PRESETS.map((p) => ({
      label: `secondary:${p.key}`,
      scale: themeScale(resolveSecondary(p.key, ""), ground),
    })),
  ];
}

/** The worst ratio any club could see for `step`, and which club sees it. */
function worst(ground: Ground, step: number, tint: number): { ratio: number; label: string } {
  let out = { ratio: Infinity, label: "" };
  for (const { label, scale } of everyRamp(ground)) {
    const bg = tint ? tintOver(scale[500], ground.surface, tint) : ground.surface;
    const ratio = contrastRatio(scale[step], bg);
    if (ratio < out.ratio) out = { ratio, label };
  }
  return out;
}

describe("the accent's text step is legible on every surface it is used on", () => {
  for (const ground of [DARK_GROUND, LIGHT_GROUND]) {
    for (const tint of TINTS) {
      const where = tint ? `a ${Math.round(tint * 100)}% tint of itself` : "the card surface";

      it(`step 300 clears 4.5 on ${where}, ${ground.key} ground`, () => {
        const { ratio, label } = worst(ground, 300, tint);
        expect(ratio, `${label} reads ${ratio.toFixed(2)}:1 on ${where}`).toBeGreaterThanOrEqual(
          4.5,
        );
      });
    }
  }

  it("is measuring something — step 500 fails where step 300 passes", () => {
    /**
     * The control, and the reason this file exists rather than a note in
     * `themes.test.ts`. If the arithmetic above ever passes for every step,
     * the measurement has stopped discriminating and its greens mean nothing
     * — which is the failure mode CLAUDE.md records three sweeps shipping
     * with.
     *
     * It also pins the FINDING: while this assertion holds, `--color-accent`
     * is demonstrably not safe to render text in, and any change making it
     * safe should come here and say so deliberately.
     */
    const failures = [];
    for (const ground of [DARK_GROUND, LIGHT_GROUND]) {
      for (const tint of TINTS) {
        if (worst(ground, 500, tint).ratio < 4.5) failures.push(`${ground.key}@${tint}`);
      }
    }
    expect(failures.length, "step 500 now clears everywhere — re-read this file").toBeGreaterThan(0);
  });

  it("covers every preset a club can pick, not just the default", () => {
    // A sweep over one ramp is what hid this: the e2e fixture runs Verdigris,
    // which clears on the dark ground, so every rendered screen looked fine.
    const ramps = everyRamp(LIGHT_GROUND);
    expect(ramps.length, "the preset list came back short").toBeGreaterThanOrEqual(20);
    const distinct = new Set(ramps.map((r) => r.scale[500]));
    expect(distinct.size, "every preset resolved to the same ramp").toBeGreaterThan(5);
  });
});
