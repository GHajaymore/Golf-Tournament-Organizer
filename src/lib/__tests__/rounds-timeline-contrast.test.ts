import { describe, it, expect } from "vitest";
import { readSource } from "./source";
import { DARK_GROUND, SUNLIGHT_RATIO, themeVarsFor } from "@/lib/themes";
import { SCHEMES, declarationsOf, markContrast, themeOf } from "./token-contrast";

/**
 * THE TIMELINE'S CHIPS AND MARKS READ ON EVERY THEME (Rounds & formats step 2, 2 Nov).
 *
 * Step 2 brought new colour: the state chips ("No date", "Set up", "In play"), the recipe tiles,
 * the par 3 and par 5 marks on the course's scorecard strip, the "Needs you" count, the effect
 * line, the link between rounds. Each is a fill mixed from the club's tokens with words on it, and
 * a fill mixed at 70% over a card is not a colour anybody checked by eye.
 *
 * So this reads the RULES THEMSELVES out of the stylesheets — the `background` and `color` each
 * one declares — resolves them against the club's real tokens (`themeVarsFor`) on four schemes
 * (Tournament and Desert on the dark ground, Championship and Coastal on the light), composites
 * every translucent mix over each ground it can sit on (page, card, the card one step up), and
 * holds the words to SUNLIGHT_RATIO on dark and 4.5:1 on light. A rule that names a raw colour
 * instead of a `--color-*` token fails too: it would not follow the club's theme at all.
 *
 * Worked by a route the stylesheet does not take: plain sRGB arithmetic, the way `color-mix(in
 * srgb, …)` is defined, then WCAG's ratio (`contrastRatio`).
 */

// The shared rules (`.tag-*`, `.round-link-chip`) are design-system.css's; the timeline's own are in
// the Rounds screen's sheet, which only that route loads. Shared first, so an override reads after it.
const CSS = readSource("src", "app", "design-system.css") + "\n" + readSource("src", "app", "(app)", "stages", "rounds-timeline.css");
// Built from parts so the token sweeps do not read the control as a real reference.
const UNDECLARED = ["--color", "nope"].join("-");

/**
 * The chips and marks step 2 draws words on. "A | B" is a shared rule and the timeline's own
 * override of it, read in that order (the chips are the app's `.tag`, adjusted on the timeline).
 */
const MARKS = [
  ".tag-accent",
  ".tag-accent-2 | .rounds-timeline .tag-accent-2",
  ".tag-neutral | .rounds-timeline .tag-neutral",
  ".rt-tile",
  ".rt-tile-format",
  ".rt-hole",
  '.rt-hole[data-par="3"]',
  '.rt-hole[data-par="5"]',
  ".rt-needs-count",
  ".rt-effect",
  ".round-link-chip",
];

describe("the timeline's chips and par marks read on every theme", () => {
  for (const s of SCHEMES) {
    const vars = themeVarsFor(themeOf(s.pair, s.ground), s.ground);
    it(`${s.pair} on the ${s.ground.key} ground: every mark's words reach ${s.floor}:1`, () => {
      const low = MARKS.map((m) => ({ m, ...markContrast(CSS, m, vars) }))
        .filter((x) => x.ratio < s.floor)
        .map((x) => `${x.m}: ${x.ratio.toFixed(2)}:1 on ${x.on}`);
      expect(low, low.join("\n")).toEqual([]);
    });
  }

  it("every mark's colours are the club's tokens, never a colour of its own", () => {
    const raw = MARKS.flatMap((m) => {
      const d = declarationsOf(CSS, m);
      return [d.background, d.color].filter((v): v is string => !!v && /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(v)).map((v) => `${m}: ${v}`);
    });
    expect(raw, raw.join("\n")).toEqual([]);
  });

  it("CONTROL: a mark at a weak step, or a raw colour, is caught", () => {
    const vars = themeVarsFor(themeOf("desert", DARK_GROUND), DARK_GROUND);
    // The par-5 mark's words at the accent's UI step instead of its text step.
    const weak = `.x { background: color-mix(in srgb, var(--color-accent-2-800) 70%, transparent); color: var(--color-accent-2-500); }`;
    expect(markContrast(weak, ".x", vars).ratio).toBeLessThan(SUNLIGHT_RATIO);
    expect(() => markContrast(`.y { color: #777777; background: rgb(1, 2, 3); }`, ".y", vars)).toThrow(/not a --color-\* token/);
    expect(() => markContrast(`.z { color: var(${UNDECLARED}); }`, ".z", vars)).toThrow(/not a token/);
    expect(() => markContrast(CSS, ".tag-neutral | .rounds-timelin .tag-neutral", vars), "a misspelt override is measured as the shared rule").toThrow(/has no rule/);
  });
});
