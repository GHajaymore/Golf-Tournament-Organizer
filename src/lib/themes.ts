/**
 * Club accent colours.
 *
 * Presets rather than a colour picker, and that is the whole design decision.
 * A free hex field asks a golf secretary to solve contrast: they pick the pale
 * yellow from the club crest, and the accent text vanishes against the card it
 * sits on. Every preset here is generated on the same lightness curve as the
 * original orange and checked against the app's dark surfaces by test, so
 * whichever a club picks, the app stays readable.
 *
 * Only the primary accent changes. The fairway green stays: it is the colour
 * of the game rather than of any one club, and it carries meanings — advancing
 * rows, positive deltas — that shouldn't shift underneath a rebrand.
 */

/** Lightness stops, matched to the original orange ramp so every preset has
 *  the same weight at the same step. */
// Declared before contrastRatio is used by lightnessFor; hoisted function
// declarations below make the ordering safe.
const LIGHTNESS = [0.96, 0.89, 0.8, 0.68, 0.565, 0.48, 0.38, 0.26, 0.14];
const STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

export interface ThemePreset {
  key: string;
  name: string;
  /** Where the name comes from, so the list reads like golf and not like CSS. */
  blurb: string;
  hue: number;
  saturation: number;
}

export const THEME_PRESETS: ThemePreset[] = [
  { key: "sunset", name: "Sunset", blurb: "Warm orange — the default.", hue: 27, saturation: 0.88 },
  { key: "claret", name: "Claret", blurb: "Deep red, after the jug.", hue: 352, saturation: 0.62 },
  { key: "links", name: "Links", blurb: "Cool coastal blue.", hue: 205, saturation: 0.7 },
  { key: "heather", name: "Heather", blurb: "Purple, like the rough at Gleneagles.", hue: 280, saturation: 0.45 },
  { key: "bunker", name: "Bunker", blurb: "Soft sand gold.", hue: 42, saturation: 0.72 },
  { key: "ivy", name: "Ivy", blurb: "Clubhouse green, deeper than the fairway.", hue: 158, saturation: 0.5 },
];

export const DEFAULT_THEME = "sunset";

export function isThemeKey(v: string): boolean {
  return THEME_PRESETS.some((t) => t.key === v);
}

export function themeFor(key: string | null | undefined): ThemePreset {
  return THEME_PRESETS.find((t) => t.key === key) ?? THEME_PRESETS[0];
}

/** HSL to #rrggbb. Kept here rather than pulled in, so the palette has no
 *  dependency that could change its output between versions. */
export function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const to = (v: number) =>
    Math.round(Math.min(255, Math.max(0, (v + m) * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Minimum contrast each step has to clear, and against what.
 *
 * Only the shades used as foreground carry a requirement. 100 and 200 are
 * lighter than anything asked of them, and 600–900 are backgrounds.
 */
const CONTRAST_FLOOR: Record<number, { ratio: number; against: string }> = {
  300: { ratio: 4.5, against: "#1d2022" }, // text, on the lighter card surface
  400: { ratio: 4.5, against: "#16181a" },
  500: { ratio: 3, against: "#16181a" }, // buttons, borders, large text
};

/**
 * The lightness a hue needs to clear its contrast floor.
 *
 * A fixed lightness ramp does *not* guarantee contrast, which is the thing a
 * hue sweep found and intuition missed: blue contributes only 7% of perceived
 * luminance, so pure blue at the orange's lightness lands at 2.3:1 — nowhere
 * near the 3:1 a button needs. Raising lightness globally doesn't fix it
 * either; it washes out every other hue to rescue one band.
 *
 * So lightness is solved per hue instead, and only ever upward: hues that
 * already clear the floor keep the designed ramp exactly, and the blues get
 * lifted until they're legible. Consistency yields to readability precisely
 * where the two disagree.
 */
function lightnessFor(hue: number, saturation: number, step: number, base: number): number {
  const floor = CONTRAST_FLOOR[step];
  if (!floor) return base;
  if (contrastRatio(hslToHex(hue, saturation, base), floor.against) >= floor.ratio) return base;

  // Binary search upward. 24 iterations resolves far finer than 8-bit colour.
  let lo = base;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(hslToHex(hue, saturation, mid), floor.against) >= floor.ratio) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** The full 100–900 ramp for a preset, keyed by step. */
export function themeScale(preset: ThemePreset): Record<number, string> {
  const out: Record<number, string> = {};
  STEPS.forEach((step, i) => {
    const l = lightnessFor(preset.hue, preset.saturation, step, LIGHTNESS[i]);
    out[step] = hslToHex(preset.hue, preset.saturation, l);
  });
  return out;
}

/**
 * CSS custom properties for a theme, ready to drop on a wrapping element.
 *
 * Returned as a style object rather than injected as a stylesheet so it lands
 * with the server-rendered HTML — a theme that arrives a frame late is a
 * visible flash of the wrong club's colours.
 */
export function themeVars(key: string | null | undefined): Record<string, string> {
  const preset = themeFor(key);
  const scale = themeScale(preset);
  const vars: Record<string, string> = { "--color-accent": scale[500] };
  for (const step of STEPS) vars[`--color-accent-${step}`] = scale[step];
  return vars;
}

/* ── Contrast, so the presets can be proven rather than eyeballed ────────── */

export function relativeLuminance(hex: string): number {
  const v = hex.replace("#", "");
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(v.slice(0, 2), 16));
  const g = channel(parseInt(v.slice(2, 4), 16));
  const b = channel(parseInt(v.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The app's dark page background, which accent text has to survive. */
export const APP_BG = "#16181a";
/** Card surfaces sit slightly lighter than the page. */
export const APP_SURFACE = "#1d2022";

/* ── A club's own colour ─────────────────────────────────────────────────── */

/** #rgb or #rrggbb to HSL. Null for anything that isn't a colour. */
export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const raw = hex.trim().replace(/^#/, "");
  const full =
    raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw.length === 6 ? raw : null;
  if (!full || !/^[0-9a-fA-F]{6}$/.test(full)) return null;

  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return { h: ((h % 360) + 360) % 360, s: Math.min(1, s), l };
}

/**
 * A club's own colour, rebuilt as a usable ramp.
 *
 * Takes the hue and saturation the club chose and discards the lightness,
 * replacing it with the same curve every preset uses. That is what makes an
 * open colour field safe: contrast is driven almost entirely by lightness, so
 * fixing the ramp keeps every shade legible whatever hue arrives. A club that
 * enters its pale crest yellow gets that yellow's hue at a workable weight,
 * rather than accent text that vanishes into the card behind it.
 *
 * Saturation is floored so a near-grey brand colour still reads as an accent
 * rather than disappearing into the interface chrome.
 */
export function customPreset(hex: string): ThemePreset | null {
  const hsl = hexToHsl(hex);
  if (!hsl) return null;
  return {
    key: "custom",
    name: "Custom",
    blurb: "Your club's own colour.",
    hue: hsl.h,
    saturation: Math.max(0.25, Math.min(0.95, hsl.s)),
  };
}

/** Resolve a stored theme, honouring a club's custom colour when set. */
export function resolveTheme(themeKey: string | null | undefined, customHex: string): ThemePreset {
  if (themeKey === "custom") {
    const p = customPreset(customHex);
    if (p) return p;
  }
  return themeFor(themeKey);
}

/** CSS variables for a resolved theme, custom or preset. */
export function resolvedThemeVars(
  themeKey: string | null | undefined,
  customHex: string,
): Record<string, string> {
  const preset = resolveTheme(themeKey, customHex);
  const scale = themeScale(preset);
  const vars: Record<string, string> = { "--color-accent": scale[500] };
  for (const step of STEPS) vars[`--color-accent-${step}`] = scale[step];
  return vars;
}

/* ── Readability on a phone, in the sun, on the 14th tee ─────────────────── */

/**
 * Contrast that holds up outdoors.
 *
 * WCAG's 4.5:1 is an indoor number — it assumes an office, not a phone held at
 * arm's length in direct sun with the screen half mirror. Sunlight raises the
 * effective black level enormously, which compresses every ratio: a colour
 * that clears 4.5:1 on a desk can be genuinely unreadable on the 14th tee.
 *
 * 7:1 is WCAG's own enhanced threshold and the closest published bar to the
 * conditions this app is actually used in, so it's what the outdoor check
 * asks for. Below it the app still works; it just warns, because a club that
 * picks its colours indoors deserves to know how they'll behave outdoors.
 */
export const SUNLIGHT_RATIO = 7;

export interface SunlightCheck {
  ok: boolean;
  /** The weakest of the shades players actually read. */
  worstRatio: number;
  /** Which shade was weakest, for a precise message. */
  worstStep: number;
  warning: string | null;
}

/**
 * Whether a colour will survive being looked at outdoors.
 *
 * Checks the shades a player sees rather than every step: 500 carries the
 * buttons they tap, 300 and 400 the text they read. The darker steps are
 * backgrounds and the lighter ones are already bright.
 */
export function sunlightCheck(preset: ThemePreset): SunlightCheck {
  const scale = themeScale(preset);
  let worstRatio = Infinity;
  let worstStep = 500;
  for (const step of [300, 400, 500]) {
    const ratio = contrastRatio(scale[step], APP_BG);
    if (ratio < worstRatio) {
      worstRatio = ratio;
      worstStep = step;
    }
  }
  const ok = worstRatio >= SUNLIGHT_RATIO;
  return {
    ok,
    worstRatio,
    worstStep,
    warning: ok
      ? null
      : `This colour is readable indoors but dim in sunlight (${worstRatio.toFixed(1)}:1, where ${SUNLIGHT_RATIO}:1 holds up outdoors). Players entering scores on a bright day may struggle — a lighter or more saturated shade reads better on the course.`,
  };
}

/** The same check for a stored theme, preset or custom. */
export function sunlightCheckFor(themeKey: string | null | undefined, customHex: string): SunlightCheck {
  return sunlightCheck(resolveTheme(themeKey, customHex));
}
