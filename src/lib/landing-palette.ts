/**
 * The marketing page's palette, SOLVED rather than picked.
 *
 * `page.tsx` used to carry about thirty hex values chosen by eye, declared
 * twice — once for the dark ground and again inside a light-mode media query.
 * That is a second design system, and it is the one surface `themes.test.ts`
 * cannot reach, which is not a filing detail: it is why two contrast failures
 * shipped. `--ink-faint` measured 4.29:1 on the dark ground, which Lighthouse
 * caught, and 4.02:1 on the light one, which nothing caught, because an audit
 * grades whichever appearance the page happens to render in and this palette
 * has two.
 *
 * Both were fixed by hand. Hand-fixing a value that was hand-picked leaves the
 * next one exactly as likely, so the fix is here instead: every foreground on
 * this page now has its lightness solved against the background it will be
 * read on, by the same `solveLightness` the app's own accent ramp uses.
 *
 * WHAT IS NOT CHANGING is the look. The lacquer/paper/brass treatment and the
 * display serif are doing real work — a marketing page that reads differently
 * from the console is a decision, not a drift, and collapsing this onto the
 * app's `--color-*` tokens would delete it. So the page keeps its own hues and
 * its own weights. What it stops keeping is the claim that those weights are
 * legible; that is now solved, and a designed weight is only ever moved when
 * it fails, and only ever away from the background.
 *
 * THE STRUCTURE THAT FELL OUT OF MEASURING THE OLD PALETTE is worth stating,
 * because it is what collapses thirty tokens into two. The page has exactly
 * two surfaces — lacquer and cream — and the appearance flip SWAPS which one
 * is the page and which is the inverted band. The old values already agreed:
 * the dark ground's `--paper-accent` (#0E6E72) was character-for-character the
 * light ground's `--brass`, and its `--paper-soft` (#5C5343) was the light
 * ground's `--ink-soft` to within one unit of blue. They were the same solve
 * against the same surface, written out twice. So there is one palette per
 * SURFACE here, used once as the page and once as the band, and the light
 * block is not a second set of decisions — it is the same two palettes, the
 * other way round.
 */

import { contrastRatio, hslToHex, relativeLuminance, solveLightness } from "./themes";

/**
 * The page's hues, which are its identity and are not solved.
 *
 * Contrast is driven almost entirely by lightness, so the hue is exactly the
 * part a contrast rule has no business touching. These are the numbers a
 * redesign changes.
 */
const HUE = {
  /** Aged wood under lacquer — the warm near-black the dark page is built on. */
  lacquer: 18,
  /** Card stock: the cream the light page is built on, and the band on the dark one. */
  cream: 43,
  /** Warm neutral, a few degrees off both grounds so text never reads as a tint of them. */
  ink: 34,
  /**
   * Patina — verdigris on copper. IDENTITY: the marks, the rules, the buttons,
   * the last word of the headline.
   */
  patina: 182,
  /**
   * MEANING: live, under par, money coming your way. Never identity.
   *
   * The source note this replaces said these two were "174 degrees apart".
   * They are 31 — measured off the values that were actually shipping, and the
   * claim appears to predate a palette change nobody re-checked it against.
   * 31 degrees is still a clear separation at these saturations and the rule
   * it was defending is the real one, so the separation is now asserted by
   * test rather than asserted in prose.
   */
  flag: 151,
};

/** How far apart identity and meaning have to stay, in degrees of hue. */
export const MIN_LANDING_HUE_SEPARATION = 24;

/**
 * What each foreground owes, and why it is that number rather than 4.5.
 *
 * Only the FLOOR lives here. The designed weight lives on the surface, and the
 * solver keeps the weight unless the floor is unmet — so raising a number here
 * darkens or lightens exactly the tokens that were failing it and leaves every
 * other one alone.
 */
const FLOOR = {
  /** Headlines and the leader's name. Held well above AA because it is the page's loudest voice. */
  ink: 12,
  /** Ledes, body copy, the verbs. */
  inkSoft: 6,
  /**
   * The faintest text there is, and the one that failed twice. It carries the
   * footer meta at 12.5px, so it is small body text and owes plain AA — there
   * is no large-text exemption to reach for.
   */
  inkFaint: 4.5,
  /** Accent TEXT: the eyebrow, the step numbers, the feature icons. */
  accent: 4.5,
  /** "Live", "under par", the leader's position. Read as text, so text's bar. */
  flag: 4.5,
  /**
   * Accent FILL. Never a text colour on this page — `--brass-ui` and
   * `--brass-hi` appear only as `background:` — so these are judged as UI
   * components at WCAG 1.4.11's 3:1 and the label they carry is graded
   * separately, against the fill rather than against the page.
   */
  fill: 3,
  /** The button's own label, on the fill. */
  onAccent: 4.5,
};

/** A background. Nothing is solved against these, because they ARE the reference. */
interface Level {
  saturation: number;
  lightness: number;
  /** 0–255, for the one panel that is translucent over the page beneath it. */
  alpha?: number;
}

/** A foreground. The lightness is the designed weight; the solver may raise it. */
interface Shade {
  saturation: number;
  lightness: number;
}

/**
 * One of the two surfaces the page is made of.
 *
 * Every surface declares four backgrounds and eight foregrounds. The
 * backgrounds are designed values because there is nothing to solve them
 * against; the foregrounds are starting points.
 */
interface LandingSurface {
  key: "lacquer" | "cream";
  hue: number;
  /** Which way is away from this surface, for anything that has to be read on it. */
  away: "lighter" | "darker";

  /** The page ground itself. */
  page: Level;
  /**
   * A surface lifted off the page — and, when this surface is the BAND, the
   * band's own ground. Those measured as the same value in the old palette
   * (`--ground-2` and the other appearance's `--paper` agreed to a unit), so
   * they are one level rather than two.
   */
  raised: Level;
  /** A card inset into that band: `--paper-2`. */
  inset: Level;
  /** The leaderboard card standing on the page. */
  panel: Level;

  ink: Shade;
  inkSoft: Shade;
  inkFaint: Shade;
  accent: Shade;
  accentUi: Shade;
  accentHi: Shade;
  onAccent: Shade;
  flag: Shade;

  /** Hairlines, drawn as the surface's own ink at these two alphas. */
  lineAlpha: [number, number];
}

/**
 * Lacquer: the dark page, and the band on the light one.
 *
 * "Patina" — verdigris on lacquer, the two things a clubhouse is made of. The
 * ground is aged and the accent is not, and that split is the whole design. A
 * warm near-black with a single hot accent is the shape every dark product
 * page has; the previous attempt to escape it went the other way, to gold
 * leaf, which is handsome and entirely period and leaves nothing sharp on the
 * page at all.
 *
 * A cool accent on a warm ground is also the strongest pairing available, and
 * that is not a stylistic point: this page gets opened on a phone at a golf
 * course, and hue contrast survives sunlight in a way lightness alone does not.
 */
const LACQUER: LandingSurface = {
  key: "lacquer",
  hue: HUE.lacquer,
  away: "lighter",
  page: { saturation: 0.18, lightness: 0.076 },
  raised: { saturation: 0.21, lightness: 0.112 },
  inset: { saturation: 0.27, lightness: 0.08 },
  // The leaderboard card is the raised surface at 52%, so the hero's grid and
  // glow read through it. Graded as if it were opaque, which is the safe
  // direction: composited over the page it can only end up darker than this,
  // and darker is more contrast for light text.
  panel: { saturation: 0.21, lightness: 0.112, alpha: 0x85 },
  ink: { saturation: 0.31, lightness: 0.895 },
  inkSoft: { saturation: 0.15, lightness: 0.625 },
  inkFaint: { saturation: 0.13, lightness: 0.486 },
  // Accent TEXT and accent FILL are different weights, the way the app's own
  // ramp separates step 400 from 500. Held to one value the button and the
  // body text come out the same colour and the button stops reading as a
  // control at all.
  accent: { saturation: 0.68, lightness: 0.68 },
  accentUi: { saturation: 0.68, lightness: 0.567 },
  // Brighter patina on hover, not green: green is reserved for meaning on this
  // page, and a primary button that turns green spends that word on "you
  // moused over something".
  accentHi: { saturation: 0.73, lightness: 0.798 },
  onAccent: { saturation: 0.6, lightness: 0.078 },
  flag: { saturation: 0.34, lightness: 0.578 },
  lineAlpha: [0.12, 0.24],
};

/**
 * Cream: the light page, and the band on the dark one.
 *
 * Card stock rather than lacquer, and the patina cannot survive the swap
 * unchanged — a bright teal is a highlight on a dark ground and pale nothing
 * on a light one, so on cream it deepens to the teal of oxidised copper in
 * shadow, dark enough to carry a word. It also saturates as it deepens, which
 * is what keeps the hue legible down there rather than reading as a grey.
 *
 * Green darkens with it, because a board is only readable if under-par reads
 * instantly, and the dark ground's mint does not on cream.
 *
 * Accent text and accent fill collapse to ONE weight here. On lacquer they are
 * two steps apart because both have to clear the ground; on cream the darker
 * of the pair is already doing the work, and a second, deeper teal for the
 * button just read as a different colour.
 */
const CREAM: LandingSurface = {
  key: "cream",
  hue: HUE.cream,
  away: "darker",
  page: { saturation: 0.45, lightness: 0.922 },
  raised: { saturation: 0.45, lightness: 0.869 },
  inset: { saturation: 0.41, lightness: 0.822 },
  // On paper a card sits ABOVE the page rather than below it — the one
  // relationship that inverts between the two grounds, and the same call
  // `LIGHT_GROUND` makes in themes.ts. Nearly white, and warm rather than
  // clinical.
  panel: { saturation: 1, lightness: 0.984 },
  ink: { saturation: 0.31, lightness: 0.09 },
  inkSoft: { saturation: 0.16, lightness: 0.311 },
  inkFaint: { saturation: 0.17, lightness: 0.382 },
  accent: { saturation: 0.78, lightness: 0.251 },
  accentUi: { saturation: 0.78, lightness: 0.251 },
  accentHi: { saturation: 0.79, lightness: 0.19 },
  onAccent: { saturation: 1, lightness: 0.975 },
  flag: { saturation: 0.6, lightness: 0.3 },
  lineAlpha: [0.12, 0.22],
};

export const LANDING_SURFACES = { lacquer: LACQUER, cream: CREAM } as const;

/** Upper case, to match the brand tokens `page.tsx` still states by hand. */
function hex(h: number, s: number, l: number): string {
  return hslToHex(h, s, l).toUpperCase();
}

function levelHex(surface: LandingSurface, level: Level): string {
  return hex(surface.hue, level.saturation, level.lightness);
}

/**
 * The background on this surface that gives a foreground the LEAST contrast.
 *
 * Solving against the page ground alone is what the hand-picked palette
 * effectively did, and it is not enough: `--ink-faint` cleared 4.73:1 on the
 * dark page and about 4.45 on the feature card's hover state, which is the
 * same text one mouse movement later. So every foreground is solved against
 * the worst background its own surface presents, and the other three come out
 * with margin for free.
 *
 * Derived from the declared levels rather than naming one of them, so a
 * background added later cannot quietly weaken every foreground on the surface
 * while the table still says the right thing.
 */
function worstBackground(surface: LandingSurface): string {
  const levels = [surface.page, surface.raised, surface.inset, surface.panel].map((l) =>
    levelHex(surface, l),
  );
  // Least contrast for light text is the lightest ground; for dark text, the darkest.
  return levels.reduce((worst, hex) =>
    surface.away === "lighter"
      ? relativeLuminance(hex) > relativeLuminance(worst)
        ? hex
        : worst
      : relativeLuminance(hex) < relativeLuminance(worst)
        ? hex
        : worst,
  );
}

function solved(
  surface: LandingSurface,
  hue: number,
  shade: Shade,
  ratio: number,
  against: string,
  away: "lighter" | "darker" = surface.away,
): string {
  return hex(
    hue,
    shade.saturation,
    solveLightness(hue, shade.saturation, shade.lightness, against, ratio, away),
  );
}

export interface SurfacePalette {
  /** Backgrounds, as declared. */
  page: string;
  raised: string;
  inset: string;
  panel: string;
  /** Foregrounds, solved against `worstBackground`. */
  ink: string;
  inkSoft: string;
  inkFaint: string;
  accent: string;
  accentUi: string;
  accentHi: string;
  /** Solved against `accentUi` rather than against the surface. */
  onAccent: string;
  flag: string;
  line: string;
  line2: string;
}

/** Every colour one surface produces, backgrounds designed and foregrounds solved. */
export function paletteFor(surface: LandingSurface): SurfacePalette {
  const bg = worstBackground(surface);
  const ink = solved(surface, HUE.ink, surface.ink, FLOOR.ink, bg);
  const accentUi = solved(surface, HUE.patina, surface.accentUi, FLOOR.fill, bg);
  const rgb = (hex: string, alpha: number) =>
    `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",")},${alpha})`;

  return {
    page: levelHex(surface, surface.page),
    raised: levelHex(surface, surface.raised),
    inset: levelHex(surface, surface.inset),
    panel:
      levelHex(surface, surface.panel) +
      (surface.panel.alpha === undefined
        ? ""
        : surface.panel.alpha.toString(16).padStart(2, "0").toUpperCase()),
    ink,
    inkSoft: solved(surface, HUE.ink, surface.inkSoft, FLOOR.inkSoft, bg),
    inkFaint: solved(surface, HUE.ink, surface.inkFaint, FLOOR.inkFaint, bg),
    accent: solved(surface, HUE.patina, surface.accent, FLOOR.accent, bg),
    accentUi,
    accentHi: solved(surface, HUE.patina, surface.accentHi, FLOOR.fill, bg),
    // The label is read on the BUTTON, not on the page, so the button is what
    // it is solved against — and it moves toward the page rather than away
    // from it, which is the opposite direction to everything else here. The
    // old palette hard-coded a label colour against an accent that later
    // changed hue entirely; this pair cannot drift apart because one is
    // derived from the other.
    onAccent: solved(
      surface,
      HUE.patina,
      surface.onAccent,
      FLOOR.onAccent,
      accentUi,
      surface.away === "lighter" ? "darker" : "lighter",
    ),
    flag: solved(surface, HUE.flag, surface.flag, FLOOR.flag, bg),
    line: rgb(ink, surface.lineAlpha[0]),
    line2: rgb(ink, surface.lineAlpha[1]),
  };
}

/**
 * The two palettes an appearance renders: the page's own surface, and the
 * inverted band standing on it.
 */
export function landingPalette(appearance: "dark" | "light"): {
  page: SurfacePalette;
  band: SurfacePalette;
} {
  const [page, band] = appearance === "dark" ? [LACQUER, CREAM] : [CREAM, LACQUER];
  return { page: paletteFor(page), band: paletteFor(band) };
}

/**
 * The custom-property declarations for one appearance, ready to drop into the
 * page's stylesheet.
 *
 * `--paper-*` is the BAND, which is the other surface's palette — so the light
 * block is not a second set of decisions, it is these two the other way round.
 * The brand tokens are deliberately absent: a logo is a constant and does not
 * follow the page, so `page.tsx` states those as literal hex beside a note
 * saying why, and `brand-consistency.test.ts` pins the four values.
 */
export function landingTokens(appearance: "dark" | "light", indent: string): string {
  const { page, band } = landingPalette(appearance);
  const lines = [
    `--ground:${page.page}; --ground-2:${page.raised}; --panel:${page.panel};`,
    `--paper:${band.raised}; --paper-2:${band.inset}; --paper-ink:${band.ink}; --paper-soft:${band.inkSoft};`,
    `--paper-accent:${band.accent};`,
    `--ink:${page.ink}; --ink-soft:${page.inkSoft}; --ink-faint:${page.inkFaint};`,
    `--line:${page.line}; --line-2:${page.line2};`,
    `--flag:${page.flag}; --under:${page.flag};`,
    `--brass:${page.accent}; --brass-ui:${page.accentUi}; --brass-hi:${page.accentHi}; --on-accent:${page.onAccent};`,
  ];
  return lines.map((l) => indent + l).join("\n");
}

/** Degrees between two hues, the short way round the wheel. */
function hueGap(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/** Identity and meaning, and how far apart they are — asserted, not narrated. */
export const LANDING_HUES = {
  ...HUE,
  identityToMeaning: hueGap(HUE.patina, HUE.flag),
};

/** The floors, so a test grades what the palette was actually built to. */
export const LANDING_FLOORS = FLOOR;

/** Exported so a test can measure against the same reference the solver used. */
export function landingWorstBackground(surface: "lacquer" | "cream"): string {
  return worstBackground(LANDING_SURFACES[surface]);
}

/** Kept for the contrast test, which grades a colour against its own surface. */
export { contrastRatio };
