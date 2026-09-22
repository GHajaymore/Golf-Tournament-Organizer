import { describe, it, expect } from "vitest";
import {
  THEME_PAIRS,
  ACCENT_PRESETS,
  SECONDARY_PRESETS,
  RECOMMENDED_SCHEME,
  darkGroundMargin,
  DEFAULT_CLUB_THEME,
  DARK_GROUND,
  LIGHT_GROUND,
  MIN_HUE_SEPARATION,
  hueDistance,
  sunlightCheck,
  resolveTheme,
  resolveSecondary,
  SUNLIGHT_RATIO,
} from "@/lib/themes";

/**
 * THE RECOMMENDED SCHEME IS EARNED, AND THE REASON IS NOT ONLY CONTRAST.
 *
 * Ajay, 2026-09-21: "the preferred theme should be really good and tested for
 * both desktop and mobile", then "I just want best experience."
 *
 * The first version of this file asserted "highest contrast across both
 * grounds" and FAILED, which is the useful part of its history:
 *
 *   - the light ground is flat by construction (4.50-4.53 for every scheme),
 *     so a both-grounds score is the light number with noise on it and put
 *     nine schemes ahead of the recommended one by 0.01;
 *   - on dark, where the spread is real, the highest contrast is Floodlit at
 *     12.07 and not Tournament at 10.09.
 *
 * Floodlit still is not the recommendation, because `--color-accent-2` is the
 * SEMANTIC colour — birdies, the live dot, money owed to you — and Floodlit
 * leads with Signal, a bright green, so its brand accent competes with the
 * green that already means "good". That rule predates this work and is
 * written at DEFAULT_THEME.
 *
 * So these assert the PROPERTIES that make a recommendation defensible, not a
 * league table. Keeping the Floodlit comparison here is deliberate: it is the
 * thing somebody re-deriving this in six months would otherwise "fix".
 */

const presetOf = (key: string, from: typeof ACCENT_PRESETS) => {
  const p = from.find((x) => x.key === key);
  if (!p) throw new Error(`no preset ${key}`);
  return p;
};

const schemeOf = (key: string) => {
  const pair = THEME_PAIRS.find((p) => p.key === key);
  if (!pair) throw new Error(`no scheme ${key}`);
  return {
    pair,
    accent: presetOf(pair.accentKey, ACCENT_PRESETS),
    secondary: presetOf(pair.secondaryKey, SECONDARY_PRESETS),
  };
};

/** Hues that mean "good" in this app, which a brand accent must stay clear of. */
const SEMANTIC_GREEN_HUES = [
  presetOf("fairway", SECONDARY_PRESETS).hue,
  presetOf("signal", SECONDARY_PRESETS).hue,
];

describe("the recommended scheme", () => {
  it("exists in the list it is recommending from", () => {
    expect(THEME_PAIRS.some((p) => p.key === RECOMMENDED_SCHEME)).toBe(true);
  });

  it("is what a club gets when it has chosen nothing", () => {
    // The badge would be a lie if the default landed elsewhere: a club that
    // never opens this screen must already be on the recommended look.
    const { pair } = schemeOf(RECOMMENDED_SCHEME);
    expect(pair.accentKey).toBe(DEFAULT_CLUB_THEME.accentKey);
    expect(pair.secondaryKey).toBe(DEFAULT_CLUB_THEME.secondaryKey);
  });

  it("clears the outdoor bar on the dark ground with real headroom", () => {
    // Not merely passing. This is the scheme a phone reads on the 14th in
    // July, and 7.01:1 would pass while being nobody's recommendation.
    const accent = resolveTheme(DEFAULT_CLUB_THEME.accentKey, "");
    const secondary = resolveSecondary(DEFAULT_CLUB_THEME.secondaryKey, "");
    for (const p of [accent, secondary]) {
      expect(sunlightCheck(p, DARK_GROUND).worstRatio).toBeGreaterThan(SUNLIGHT_RATIO * 1.3);
    }
  });

  it("passes on the light ground too, because auto sends some members there", () => {
    // While `auto` exists a club is not choosing a ground — each member's
    // device chooses, so one club theme renders dark on one phone and light
    // on another. A recommendation good on only one of them is a
    // recommendation for an unknown share of the membership.
    const accent = resolveTheme(DEFAULT_CLUB_THEME.accentKey, "");
    const secondary = resolveSecondary(DEFAULT_CLUB_THEME.secondaryKey, "");
    for (const p of [accent, secondary]) {
      expect(sunlightCheck(p, LIGHT_GROUND).ok).toBe(true);
    }
  });

  it("keeps its brand accent clear of the green that already means good", () => {
    const { accent } = schemeOf(RECOMMENDED_SCHEME);
    for (const hue of SEMANTIC_GREEN_HUES) {
      expect(
        hueDistance(accent.hue, hue),
        `the recommended accent must not compete with the semantic green at ${hue}`,
      ).toBeGreaterThanOrEqual(MIN_HUE_SEPARATION);
    }
  });

  it("is beaten on raw dark contrast only by schemes that break that rule", () => {
    // The assertion that keeps the recommendation honest. Anything out-scoring
    // it on the axis that actually varies must be disqualified for a stated
    // reason — today that is Floodlit and the semantic green. A NEW scheme
    // that beats it AND keeps its accent clear should take the badge, and this
    // fails and names it.
    const mine = darkGroundMargin(
      schemeOf(RECOMMENDED_SCHEME).accent,
      schemeOf(RECOMMENDED_SCHEME).secondary,
    );
    const betterAndClean = THEME_PAIRS.filter((p) => {
      if (p.key === RECOMMENDED_SCHEME) return false;
      const s = schemeOf(p.key);
      if (darkGroundMargin(s.accent, s.secondary) <= mine) return false;
      return SEMANTIC_GREEN_HUES.every((h) => hueDistance(s.accent.hue, h) >= MIN_HUE_SEPARATION);
    }).map((p) => p.name);

    expect(
      betterAndClean,
      `these beat the recommended scheme on dark AND keep their accent clear of the semantic green — move RECOMMENDED_SCHEME: ${betterAndClean.join(", ")}`,
    ).toEqual([]);
  });

  it("records that Floodlit scores higher and why it is not recommended", () => {
    // Pinned so the comparison cannot quietly stop being true. If Floodlit
    // ever drops below, the reasoning above needs rewriting rather than the
    // badge moving.
    const f = schemeOf("floodlit");
    const t = schemeOf(RECOMMENDED_SCHEME);
    expect(darkGroundMargin(f.accent, f.secondary)).toBeGreaterThan(
      darkGroundMargin(t.accent, t.secondary),
    );
    // And that it is disqualified for the stated reason, not for taste.
    expect(Math.min(...SEMANTIC_GREEN_HUES.map((h) => hueDistance(f.accent.hue, h)))).toBeLessThan(
      MIN_HUE_SEPARATION,
    );
  });
});
