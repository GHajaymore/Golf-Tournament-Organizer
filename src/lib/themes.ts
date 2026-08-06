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

/** The full 100–900 ramp for a preset, keyed by step. */
export function themeScale(preset: ThemePreset): Record<number, string> {
  const out: Record<number, string> = {};
  STEPS.forEach((step, i) => {
    out[step] = hslToHex(preset.hue, preset.saturation, LIGHTNESS[i]);
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
