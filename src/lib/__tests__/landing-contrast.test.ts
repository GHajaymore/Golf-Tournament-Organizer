import { describe, it, expect } from "vitest";
import { contrastRatio } from "@/lib/themes";
import { LANDING_HUES, MIN_LANDING_HUE_SEPARATION, landingTokens } from "@/lib/landing-palette";
import { readSource } from "./source";

/**
 * The marketing page's own palette clears the same contrast floor the app's
 * themes do.
 *
 * `themes.test.ts` proves every accent and neutral ramp on both grounds, and
 * the landing page is not in it: it carries a SEPARATE set of tokens with its
 * own dark and light values. So the one page every visitor sees first was the
 * one surface with no contrast test at all, and it had failures on both
 * grounds.
 *
 * Lighthouse found `--ink-faint` at 4.29:1 on the dark ground, in the footer
 * at 12.5px. It could not find the LIGHT one, because it grades whichever
 * ground the page actually renders in and it rendered dark — that value sat at
 * about 4.0:1, worse than the one that was reported.
 *
 * THAT REMAINS THE REASON THIS FILE EXISTS, and it is worth restating now that
 * the palette is generated: an audit run in one appearance says nothing at all
 * about the other, and this palette has two. No amount of Lighthouse on
 * production substitutes for grading both here. If a third ground is ever
 * added it needs a row in this file the same day.
 *
 * WHAT CHANGED is where the values come from. They used to be about thirty hex
 * values picked by eye, and this test caught a bad one AFTER it was picked.
 * `landing-palette.ts` now solves each foreground's lightness against the
 * background it is read on, so the failures this file was written for cannot
 * be authored any more. That makes most of what follows redundant — which is
 * the point of it, not an argument for deleting it. It is the backstop for the
 * two ways generation can still go wrong: a floor set too low in that module,
 * and someone reaching past it to write a colour by hand. The second is
 * checked explicitly further down.
 */

/**
 * The declarations the page actually receives, parsed the way the cascade
 * resolves them — last one wins.
 *
 * Read out of the generator rather than duplicated here, so a retune is graded
 * automatically rather than graded against a stale copy of itself.
 */
function tokens(ground: "dark" | "light"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of landingTokens(ground, "").matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

/**
 * `--panel` on the dark ground is translucent — the raised surface at 52%, so
 * the hero's grid and glow read through it. Graded as if it were opaque, which
 * is the safe direction: composited over the page beneath it can only end up
 * further from the text, never closer.
 */
const opaque = (v: string) => v.slice(0, 7);

/**
 * Every background a foreground can land on, per role.
 *
 * The page's own text is read on the page, on the feature card's hover state,
 * and on the leaderboard panel. The band's text is read on the band and on the
 * card inset into it. Grading against `--ground` alone is what the hand-picked
 * palette effectively did, and it is how `--ink-faint` came to clear 4.73:1 on
 * the page and about 4.45 on a hover state one mouse movement later.
 */
const PAGE_BG = ["ground", "ground-2", "panel"];
const BAND_BG = ["paper", "paper-2"];

/** Text tokens, the backgrounds they are read on, and the ratio each owes. */
const TEXT: Array<[token: string, on: string[], floor: number]> = [
  ["ink", PAGE_BG, 12],
  ["ink-soft", PAGE_BG, 6],
  // The footer meta this carries is 12.5px, so plain AA — there is no
  // large-text exemption to reach for, and reaching for one is how it shipped.
  ["ink-faint", PAGE_BG, 4.5],
  ["brass", PAGE_BG, 4.5],
  ["flag", PAGE_BG, 4.5],
  ["under", PAGE_BG, 4.5],
  ["paper-ink", BAND_BG, 12],
  ["paper-soft", BAND_BG, 4.5],
  ["paper-accent", BAND_BG, 4.5],
];

/**
 * Fills, judged as UI components rather than as text.
 *
 * `--brass-ui` and `--brass-hi` appear only as `background:` on this page, so
 * WCAG 1.4.11's 3:1 is the honest bar for them and the label they carry is
 * graded separately, against the fill rather than against the page.
 */
const FILL: Array<[token: string, on: string[], floor: number]> = [
  ["brass-ui", PAGE_BG, 3],
  ["brass-hi", PAGE_BG, 3],
];

describe("the landing palette can be read", () => {
  it("found the palette at all", () => {
    // A generator that emitted nothing would make every assertion below vacuous.
    const dark = tokens("dark");
    const light = tokens("light");
    expect(Object.keys(dark).length).toBeGreaterThanOrEqual(15);
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    // And the two grounds are genuinely different, rather than one emitted twice.
    expect(dark.ground).not.toBe(light.ground);
    expect(dark.ink).not.toBe(light.ink);
    // The band inverts the page: the dark ground's band is the light ground's
    // page surface and the other way round. This is the structural claim the
    // generator makes, and it is what collapses two hand-written blocks into
    // two palettes used twice.
    expect(dark["paper-accent"]).toBe(light.brass);
    expect(light["paper-accent"]).toBe(dark.brass);
    expect(dark["paper-soft"]).toBe(light["ink-soft"]);
  });

  for (const ground of ["dark", "light"] as const) {
    for (const [name, backgrounds, floor] of [...TEXT, ...FILL]) {
      for (const bg of backgrounds) {
        it(`${ground}: --${name} clears ${floor}:1 on --${bg}`, () => {
          const t = tokens(ground);
          const fg = t[name];
          const back = t[bg];
          expect(fg, `--${name} was not emitted for the ${ground} ground`).toBeTruthy();
          expect(back, `--${bg} was not emitted for the ${ground} ground`).toBeTruthy();
          const ratio = contrastRatio(opaque(fg), opaque(back));
          expect(
            Number(ratio.toFixed(2)),
            `--${name} ${fg} on --${bg} ${back} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(floor);
        });
      }
    }

    it(`${ground}: the button label can be read on the button`, () => {
      const t = tokens(ground);
      const ratio = contrastRatio(opaque(t["on-accent"]), opaque(t["brass-ui"]));
      expect(
        Number(ratio.toFixed(2)),
        `--on-accent ${t["on-accent"]} on --brass-ui ${t["brass-ui"]} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});

/**
 * IDENTITY AND MEANING STAY APART.
 *
 * Teal is identity on this page — the marks, the headline's last word, the
 * rules, the buttons. Green is meaning — live, under par, money coming your
 * way. Never the reverse: the moment teal says "winning" the page has two
 * words for one idea and neither is legible.
 *
 * This replaces a source comment claiming the two were "174 degrees apart".
 * They are 31, measured off the values that were actually shipping, and the
 * claim appears to have outlived a palette change nobody re-checked it
 * against. 31 degrees is a real separation at these saturations and the rule
 * was right; only the number was wrong. A number in prose cannot be wrong
 * here, because nothing reads it — so it is asserted instead.
 */
describe("identity and meaning are different colours", () => {
  it("keeps the accent and the green far enough apart", () => {
    expect(LANDING_HUES.identityToMeaning).toBeGreaterThanOrEqual(MIN_LANDING_HUE_SEPARATION);
  });
});

/**
 * GENERATION CANNOT BE BYPASSED.
 *
 * The block above grades what `landing-palette.ts` produces. That proves
 * nothing at all if the page stops using it, or if somebody adds one more
 * colour by hand beside the generated ones — which is precisely how the
 * palette got into this state the first time, one reasonable-looking value at
 * a time.
 *
 * So the page is read as source and held to two rules: it interpolates the
 * generator for both grounds, and the only colours written into it by hand are
 * the brand's own, which are hand-written deliberately because a logo must not
 * be exposed to a solver that is free to move a colour.
 */
describe("the page cannot hand-write a colour", () => {
  const PAGE = readSource("src/app/page.tsx");

  /**
   * The wordmark's orange and green, on each ground. These four values are
   * pinned by name in `brand-consistency.test.ts`; here they are only the
   * permitted exceptions to "no hex in this file".
   */
  const BRAND = ["#E8A33D", "#4FA97C", "#63BE90", "#A8701A", "#1F7A50", "#186541"];

  it("interpolates the generated palette on both grounds", () => {
    for (const ground of ["dark", "light"]) {
      expect(
        PAGE,
        `the ${ground} ground no longer reads landingTokens; its colours are not graded by anything`,
      ).toMatch(new RegExp(`landingTokens\\(\\s*"${ground}"`));
    }
  });

  it("writes no colour of its own except the brand's", () => {
    const strays = [...PAGE.matchAll(/#[0-9A-Fa-f]{6}\b/g)]
      .map((m) => m[0].toUpperCase())
      .filter((hex) => !BRAND.includes(hex));

    // A hex in PROSE trips this too, and that is deliberate rather than a
    // false positive: `readSource` strips TypeScript comments but the
    // stylesheet is a template literal, so its own /* */ blocks survive. The
    // remedy is the same either way — describe a colour by its token, not by
    // its value, because a value quoted in prose is a copy that goes stale the
    // first time the palette is retuned.
    expect(
      strays,
      `page.tsx writes ${strays.join(", ")} by hand; landing colours come from landing-palette.ts`,
    ).toEqual([]);
  });
});
