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
const LIGHTNESS_LIGHT = [0.08, 0.16, 0.24, 0.33, 0.45, 0.6, 0.74, 0.87, 0.95];
const MIN_RAMP_GAP = 0.035;
const STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

export interface ThemePreset {
  key: string;
  name: string;
  /** Where the name comes from, so the list reads like golf and not like CSS. */
  blurb: string;
  hue: number;
  saturation: number;
  /**
   * Hand-tuned shades that bypass the generated ramp on the dark ground.
   *
   * Only the fairway green has these, and only because it is a fixed brand
   * colour that predates the ramp rather than a preset chosen from it. Running
   * it through the shared curve moved it from a deep forest green to a bright
   * mint — the curve puts step 500 at lightness 0.565 and the original sits at
   * 0.37 — which changed the colour of every advancing row in the app for
   * clubs that had chosen nothing.
   *
   * Dark ground only: these values are tuned for a dark page, and light mode
   * still generates, because a reversed hand-tuned ramp is not a light ramp.
   */
  fixedDarkScale?: Record<number, string>;
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

/* ── Ground: the surfaces a club's colour has to survive on ──────────────── */

/**
 * Light or dark. Everything in the interface is drawn from tokens, so this is
 * a token swap rather than a second stylesheet — no component knows which one
 * it's rendering on.
 *
 * `auto` follows the device. It exists mostly for the course: a phone set to
 * follow daylight will already be in light mode by the time it's carried onto
 * the first tee, which is where the contrast is hardest to win.
 */
export type Appearance = "dark" | "light" | "auto";

export const APPEARANCES: Array<{ key: Appearance; name: string; blurb: string }> = [
  { key: "dark", name: "Dark", blurb: "Clubhouse at dusk. Easy on the eyes indoors and at night." },
  { key: "light", name: "Light", blurb: "Paper white. Much easier to read outdoors in bright sun." },
  { key: "auto", name: "Follow the device", blurb: "Dark indoors, light in daylight — whatever the phone is set to." },
];

export function isAppearance(v: string): v is Appearance {
  return v === "dark" || v === "light" || v === "auto";
}

export const DEFAULT_APPEARANCE: Appearance = "dark";

export interface Ground {
  key: "dark" | "light";
  bg: string;
  surface: string;
  text: string;
  /** Neutral ramp 100→900, in the order the tokens are numbered. */
  neutrals: string[];
  /** Error red and its tinted background, which also have to flip. */
  danger: string;
  dangerBg: string;
  /**
   * Label colour for text sitting ON the accent — the filled primary button.
   *
   * Not derived from the page background. Mixing toward it looked principled
   * and measured 3.87:1 on a light ground, because the label ends up a pale
   * off-white on a mid-dark accent. These are the two values that actually
   * clear the bar against every hue the ramp can produce.
   */
  onAccent: string;
}

/**
 * The two grounds.
 *
 * Both keep the warm cast the brand is built on — the light one is a paper
 * off-white rather than a clinical #fff, and its cards sit *above* the page
 * rather than below it, which is the one relationship that inverts between the
 * two. Neutrals are the dark ramp read backwards, so a token used for a muted
 * label stays muted and one used for a background stays a background.
 */
export const DARK_GROUND: Ground = {
  key: "dark",
  bg: "#16181a",
  surface: "#21231f",
  text: "#e9e9ed",
  neutrals: ["#f3f5fe", "#e4e7f5", "#cfd3e5", "#b2b6ca", "#9397ab", "#75798c", "#595d6c", "#3f424d", "#292b31"],
  danger: "#e0665a",
  dangerBg: "#2a1512",
  // Near-black on a light accent: the dark ramp puts step 500 in the upper
  // lightness range, so dark text is what clears the bar there.
  onAccent: "#16181a",
};

export const LIGHT_GROUND: Ground = {
  key: "light",
  bg: "#f4f2ee",
  surface: "#fffefb",
  text: "#1a1c1e",
  // Darker through the middle than a straight reversal would give: neutral-500
  // carries muted labels and icons, and the dark ramp's mid greys are far too
  // pale to read on paper.
  //
  // Step 500 was #6b6f80, which measured 4.46:1 on this ground — under the bar
  // it is held to, and it carries the smallest text in the app (the 10px page
  // kicker). It is darkened just far enough to clear with margin. The floors in
  // `contrastFloors` never caught this because they govern the *solved* accent
  // steps; these neutrals are constants and were checked by eye. There is now a
  // test that measures them.
  neutrals: ["#1f2126", "#2b2d33", "#3f424d", "#565a68", "#666a7a", "#9297a8", "#b8bccd", "#d7dae7", "#eceef7"],
  // The dark theme's salmon red only manages about 3:1 on white, so light mode
  // takes a deeper one. Error text is the last thing that should be hard to
  // read.
  danger: "#b3261e",
  dangerBg: "#fdecea",
  // Pure white on a light-mode accent, which the ramp keeps dark enough to
  // carry it. An off-white mixed from the page background measured 3.87:1.
  onAccent: "#ffffff",
};

export function groundFor(appearance: "dark" | "light"): Ground {
  return appearance === "light" ? LIGHT_GROUND : DARK_GROUND;
}

/**
 * Minimum contrast each step has to clear, and against what.
 *
 * Only the shades used as foreground carry a requirement. On a dark ground
 * those are the light end of the ramp; on a light ground they're the dark end.
 * The ramp reverses between the two (see `rampFor`), so the same step numbers
 * carry the same *role* either way and this table doesn't move.
 */
function contrastFloors(ground: Ground): Record<number, { ratio: number; against: string }> {
  return {
    300: { ratio: 4.5, against: ground.surface }, // text, on the card surface
    // 400 is the accent *text* token and 500 the accent *UI* token, so 400
    // carries the stricter bar. That is also what keeps them apart: held to
    // the same floor, both get solved to exactly it and land on the same
    // colour — which happened to bunker and every hue near 35°, making the
    // 400/500 hover states invisible.
    400: { ratio: 5.5, against: ground.bg },
    // 500 was held to 3:1 as a "buttons and borders" colour. It isn't one:
    // .btn-primary and .btn-ghost both render label text in it at normal size,
    // so it is read as text and owes the text ratio.
    500: { ratio: 4.5, against: ground.bg },
  };
}

/**
 * The lightness curve for a ground.
 *
 * Reversed for light mode, and that reversal is the whole trick. In this
 * interface the low steps are foreground and the high steps are background —
 * `--color-accent-300` is text, `--color-accent-900` is a tint behind a card.
 * On a dark ground foreground means light; on a light ground it means dark. So
 * reading the same curve backwards keeps every token's meaning intact and
 * leaves every component untouched.
 */
function rampFor(ground: Ground): number[] {
  return ground.key === "light" ? LIGHTNESS_LIGHT : LIGHTNESS;
}

/**
 * Not simply the dark curve reversed.
 *
 * A straight reversal put the foreground steps at 0.38–0.565, which on paper
 * clears 4.5:1 only after the solver drags every one of them down to exactly
 * the floor — so every club colour came out at an identical weight and the
 * ramp did no work at all. This curve runs darker through the foreground so
 * the designed spacing survives and the solver is the exception rather than
 * the rule.
 */

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
function lightnessFor(
  hue: number,
  saturation: number,
  step: number,
  base: number,
  ground: Ground,
): number {
  const floor = contrastFloors(ground)[step];
  if (!floor) return base;
  if (contrastRatio(hslToHex(hue, saturation, base), floor.against) >= floor.ratio) return base;

  // Which way is "more contrast" depends on the ground: away from a dark page
  // means lighter, away from a light one means darker. Searching the wrong way
  // would drive the colour *into* the background it has to stand out from.
  const target = ground.key === "light" ? 0 : 1;
  let stay = base;
  let go = target;
  // Binary search. 24 iterations resolves far finer than 8-bit colour.
  for (let i = 0; i < 24; i += 1) {
    const mid = (stay + go) / 2;
    if (contrastRatio(hslToHex(hue, saturation, mid), floor.against) >= floor.ratio) go = mid;
    else stay = mid;
  }
  return go;
}

/**
 * The full 100–900 ramp for a preset, keyed by step.
 *
 * Defaults to the dark ground so every existing caller keeps its behaviour.
 */
export function themeScale(preset: ThemePreset, ground: Ground = DARK_GROUND): Record<number, string> {
  if (ground.key === "dark" && preset.fixedDarkScale) return { ...preset.fixedDarkScale };
  const ramp = rampFor(ground);
  const solved = STEPS.map((step, i) =>
    lightnessFor(preset.hue, preset.saturation, step, ramp[i], ground),
  );

  // Solving each step against its own floor can reorder the ramp: 400 carries
  // a stricter bar than 500, and on a yellow it gets dragged past 300. A ramp
  // that doubles back makes hover states look like glitches, so ordering is
  // restored here rather than hoped for.
  //
  // The repair only ever moves a step *away* from the background — lighter on
  // a dark ground, darker on a light one — which is the direction that adds
  // contrast. So no step can be pushed below the floor it was just solved to.
  // Walking from the background end toward the foreground end means each fix
  // propagates instead of fighting the next one.
  const away = ground.key === "light" ? -1 : 1;
  for (let i = solved.length - 2; i >= 0; i -= 1) {
    const wanted = solved[i + 1] + away * MIN_RAMP_GAP;
    solved[i] = away > 0 ? Math.max(solved[i], wanted) : Math.min(solved[i], wanted);
  }

  const out: Record<number, string> = {};
  STEPS.forEach((step, i) => {
    out[step] = hslToHex(preset.hue, preset.saturation, clamp01(solved[i]));
  });
  return out;
}

/** Smallest lightness difference that still reads as two colours. */

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
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

/* ── The second colour ───────────────────────────────────────────────────── */

/**
 * The fairway green, as a preset rather than a constant.
 *
 * It carries meaning the primary accent doesn't — advancing rows, positive
 * deltas, a match won — so it defaults to the colour of the game and most
 * clubs should leave it alone. But a club whose identity is *two* colours has
 * nowhere else to put the second one, and forcing green next to, say, a navy
 * and gold crest looks like a bug rather than a choice.
 */
export const FAIRWAY: ThemePreset = {
  key: "fairway",
  name: "Fairway",
  blurb: "The colour of the game — the default, and the safe answer.",
  hue: 151,
  saturation: 0.42,
  // The exact ramp the app has always drawn, so a club that never touches
  // this sees no change at all. Generating it instead moved every advancing
  // row from forest green to mint.
  fixedDarkScale: {
    100: "#e7f5ec",
    200: "#c3e6d0",
    300: "#93d0ac",
    400: "#5fb484",
    500: "#3c8361",
    600: "#2e6a4c",
    700: "#23503a",
    800: "#173627",
    900: "#0d2016",
  },
};

export const SECONDARY_PRESETS: ThemePreset[] = [FAIRWAY, ...THEME_PRESETS];

/**
 * Every palette, offered for either role.
 *
 * Fairway used to be a second colour only, so a club whose identity *is*
 * green could pick it as their supporting colour and not their main one —
 * which is the wrong way round for most golf clubs. Both lists are the same
 * list now; which one leads is the club's decision, not ours.
 */
export const ACCENT_PRESETS: ThemePreset[] = [...THEME_PRESETS, FAIRWAY];

/**
 * How far apart two hues must sit to read as two colours rather than one
 * slightly-off colour. Below this a leaderboard's accent and its "advancing"
 * marker start to look like a rendering fault.
 */
export const MIN_HUE_SEPARATION = 24;

export interface ThemePair {
  key: string;
  name: string;
  blurb: string;
  accentKey: string;
  secondaryKey: string;
}

/**
 * Ready-made two-colour schemes.
 *
 * Picking two colours that work together is a design job, and an organizer
 * opening the club settings on a Tuesday evening did not sign up for one.
 * These are pairs that are known to hold apart — every one is checked against
 * MIN_HUE_SEPARATION by a test, so a combination that clashes cannot ship.
 *
 * They are a starting point, never a restriction: the individual pickers stay,
 * and a club with its own crest colours can still set both by hand, including
 * a custom hex.
 */
export const THEME_PAIRS: ThemePair[] = [
  {
    key: "classic",
    name: "Classic",
    blurb: "Warm orange on clubhouse green. The app's own colours.",
    accentKey: "sunset",
    secondaryKey: "fairway",
  },
  {
    key: "championship",
    name: "Championship",
    blurb: "Claret and gold, after the jug.",
    accentKey: "claret",
    secondaryKey: "bunker",
  },
  {
    key: "coastal",
    name: "Coastal",
    blurb: "Links blue with sand.",
    accentKey: "links",
    secondaryKey: "bunker",
  },
  {
    key: "parkland",
    name: "Parkland",
    blurb: "Deep green led, warmed with orange.",
    accentKey: "fairway",
    secondaryKey: "sunset",
  },
  {
    key: "heathland",
    name: "Heathland",
    blurb: "Heather purple over ivy.",
    accentKey: "heather",
    secondaryKey: "ivy",
  },
  {
    key: "morning",
    name: "Morning",
    blurb: "Sand gold against coastal blue.",
    accentKey: "bunker",
    secondaryKey: "links",
  },
];

/** The pair a club's current two colours match, or null if they've gone their own way. */
export function pairFor(accentKey: string, secondaryKey: string): ThemePair | null {
  return (
    THEME_PAIRS.find((p) => p.accentKey === accentKey && p.secondaryKey === secondaryKey) ?? null
  );
}

export function secondaryFor(key: string | null | undefined): ThemePreset {
  return SECONDARY_PRESETS.find((t) => t.key === key) ?? FAIRWAY;
}

export function resolveSecondary(key: string | null | undefined, hex: string): ThemePreset {
  if (key === "custom") {
    const p = customPreset(hex);
    if (p) return p;
  }
  return secondaryFor(key);
}

/* ── A club's whole theme ────────────────────────────────────────────────── */

/**
 * Everything an organization can set about how the app looks.
 *
 * Stored as five short strings rather than a blob so each one can be validated
 * on its own and a bad value for one can't take the rest of the theme down.
 */
export interface ClubTheme {
  accentKey: string;
  accentHex: string;
  secondaryKey: string;
  secondaryHex: string;
  appearance: Appearance;
}

export const DEFAULT_CLUB_THEME: ClubTheme = {
  accentKey: DEFAULT_THEME,
  accentHex: "",
  secondaryKey: FAIRWAY.key,
  secondaryHex: "",
  appearance: DEFAULT_APPEARANCE,
};

/** Every custom property a theme sets, for one ground. */
export function themeVarsFor(theme: ClubTheme, ground: Ground): Record<string, string> {
  const accent = themeScale(resolveTheme(theme.accentKey, theme.accentHex), ground);
  const secondary = themeScale(resolveSecondary(theme.secondaryKey, theme.secondaryHex), ground);

  const vars: Record<string, string> = {
    "--color-accent": accent[500],
    "--color-accent-2": secondary[500],
    "--color-bg": ground.bg,
    "--color-surface": ground.surface,
    "--color-text": ground.text,
    "--color-divider": `color-mix(in srgb, ${ground.text} 16%, transparent)`,
    "--color-danger": ground.danger,
    "--color-danger-bg": ground.dangerBg,
    "--color-on-accent": ground.onAccent,
  };
  STEPS.forEach((step, i) => {
    vars[`--color-accent-${step}`] = accent[step];
    vars[`--color-accent-2-${step}`] = secondary[step];
    vars[`--color-neutral-${step}`] = ground.neutrals[i];
  });
  return vars;
}

/**
 * Only values this module generated itself.
 *
 * The theme is rendered into a `<style>` element, and part of it comes from a
 * hex field a club typed. That field is validated on save, but a value that
 * reached a stylesheet without passing through the ramp would be a CSS
 * injection — and every value here *is* regenerated by `hslToHex` or picked
 * from a constant, so nothing club-typed survives to the output. This asserts
 * that rather than assuming it, because the assumption is one refactor away
 * from being wrong and the failure would be silent.
 */
const SAFE_CSS_VALUE = /^(#[0-9a-f]{6}|color-mix\(in srgb, #[0-9a-f]{6} \d{1,3}%, transparent\))$/i;

function declarations(vars: Record<string, string>): string {
  return Object.entries(vars)
    .filter(([, v]) => SAFE_CSS_VALUE.test(v))
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

/**
 * The club's theme as a stylesheet, scoped to one selector.
 *
 * A stylesheet rather than an inline `style` attribute, because `auto` needs a
 * media query and an inline custom property would outrank it — a club that
 * chose "follow the device" would be stuck in whichever mode was rendered.
 * Server-rendered either way, so there's no frame of default orange before the
 * club's colours arrive.
 */
export function themeCss(theme: ClubTheme, selector = "[data-club-theme]"): string {
  const dark = declarations(themeVarsFor(theme, DARK_GROUND));
  const light = declarations(themeVarsFor(theme, LIGHT_GROUND));

  if (theme.appearance === "light") return `${selector}{${light}}`;
  if (theme.appearance === "dark") return `${selector}{${dark}}`;
  return `${selector}{${dark}}@media(prefers-color-scheme:light){${selector}{${light}}}`;
}

/**
 * The same theme, for a screen someone is holding on the 14th tee.
 *
 * Identical to `themeCss` except in what "auto" means. In the console, auto
 * resolves dark-first and light only if the device asks. That is the wrong way
 * round outdoors: a dark screen in direct sun is the hardest thing to read on a
 * phone, and a device set to follow daylight is in light mode *precisely* when
 * the sun is the problem. `outdoorBar` already assumes this — it grades `auto`
 * against the light ground — so the console's default was quietly contradicting
 * the app's own sunlight model.
 *
 * So here auto is light-first, and dark applies only when the device explicitly
 * asks for it (dusk, an evening scramble, a player who has pinned dark).
 *
 * A club that has *chosen* light or dark still gets exactly what it chose; this
 * only decides the undecided case.
 */
export function playerThemeCss(theme: ClubTheme, selector = "[data-club-theme]"): string {
  const dark = declarations(themeVarsFor(theme, DARK_GROUND));
  const light = declarations(themeVarsFor(theme, LIGHT_GROUND));

  if (theme.appearance === "light") return `${selector}{${light}}`;
  if (theme.appearance === "dark") return `${selector}{${dark}}`;
  return `${selector}{${light}}@media(prefers-color-scheme:dark){${selector}{${dark}}}`;
}

/**
 * What `color-scheme` a player-facing surface should declare, so native chrome
 * (scrollbars, form controls) matches the ground chosen above.
 */
export function playerColorScheme(theme: ClubTheme): string {
  if (theme.appearance === "light") return "light";
  if (theme.appearance === "dark") return "dark";
  return "light dark";
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
/**
 * The bar a shade is held to outdoors, which is not the same on both grounds.
 *
 * On a dark ground the accent has room to be much brighter than the floor, so
 * 7:1 discriminates properly — measured across the presets it separates 4.5
 * from 14.75, and a club whose colour lands at the bottom really is harder to
 * read on the course.
 *
 * On a light ground it can't. Reaching 7:1 against near-white paper needs a
 * lightness under about 0.1, and pushing three foreground steps down there
 * would collapse them into one near-black and take the colour with them. So a
 * light theme's accent sits at the readable minimum by construction, and its
 * outdoor advantage comes from the bright page rather than from the accent —
 * which is what `sunlightVerdict` says instead of pretending the same number
 * means the same thing on both.
 */
function outdoorBar(ground: Ground): number {
  return ground.key === "light" ? 4.5 : SUNLIGHT_RATIO;
}

export function sunlightCheck(preset: ThemePreset, ground: Ground = DARK_GROUND): SunlightCheck {
  const scale = themeScale(preset, ground);
  let worstRatio = Infinity;
  let worstStep = 500;
  for (const step of [300, 400, 500]) {
    const ratio = contrastRatio(scale[step], ground.bg);
    if (ratio < worstRatio) {
      worstRatio = ratio;
      worstStep = step;
    }
  }
  const bar = outdoorBar(ground);
  const ok = worstRatio >= bar;
  // On a dark ground the fix is a brighter shade; on a light one it's a deeper
  // one. Advising "lighter" to a club already in light mode would make it worse.
  const remedy =
    ground.key === "light"
      ? "a deeper or more saturated shade reads better on the course"
      : "a lighter or more saturated shade reads better on the course";
  return {
    ok,
    worstRatio,
    worstStep,
    warning: ok
      ? null
      : `This colour is readable indoors but dim in sunlight (${worstRatio.toFixed(1)}:1, where ${bar}:1 holds up outdoors). Players entering scores on a bright day may struggle — ${remedy}.`,
  };
}

/** The same check for a stored theme, preset or custom. */
export function sunlightCheckFor(
  themeKey: string | null | undefined,
  customHex: string,
  ground: Ground = DARK_GROUND,
): SunlightCheck {
  return sunlightCheck(resolveTheme(themeKey, customHex), ground);
}

/**
 * How a whole theme behaves outdoors — the thing an organizer actually wants
 * to know before a tournament.
 *
 * Judged on the ground the phone will really be in: `auto` is checked as light,
 * because a device that follows daylight is in light mode exactly when the sun
 * is the problem. Reporting a dark-mode number there would be reassuring and
 * wrong.
 */
export function sunlightVerdict(theme: ClubTheme): {
  ok: boolean;
  accent: SunlightCheck;
  secondary: SunlightCheck;
  /** The single sentence worth showing, or null when it's fine. */
  warning: string | null;
  /** Set when switching appearance would fix it on its own. */
  suggestion: string | null;
} {
  const ground = theme.appearance === "dark" ? DARK_GROUND : LIGHT_GROUND;
  const accent = sunlightCheck(resolveTheme(theme.accentKey, theme.accentHex), ground);
  const secondary = sunlightCheck(resolveSecondary(theme.secondaryKey, theme.secondaryHex), ground);
  const worst = accent.worstRatio <= secondary.worstRatio ? accent : secondary;
  const which = worst === accent ? "main colour" : "second colour";

  // Worth raising light mode, but only for the reason that is actually true.
  // A light theme's accent is NOT a higher ratio than a dark one's — it sits
  // at the readable minimum by construction. What helps outdoors is the bright
  // page behind it, and saying that is honest where "these colours hold up in
  // light mode" would not be.
  const suggestion =
    !worst.ok && theme.appearance === "dark"
      ? "A light screen is easier to read at arm's length in direct sun, whatever the accent colour. Switching appearance to Light — or Follow the device — helps more here than changing the club's colours would."
      : null;

  return {
    ok: accent.ok && secondary.ok,
    accent,
    secondary,
    warning: worst.ok ? null : `Your ${which}: ${worst.warning}`,
    suggestion,
  };
}

/* ── Do the two colours read as two colours? ─────────────────────────────── */

/** Degrees between two hues, the short way round the wheel. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** The hue a key/hex pair resolves to, or null when it can't be known. */
export function themeHue(key: string, hex: string): number | null {
  if (key === "custom") {
    const hsl = hexToHsl(hex);
    return hsl ? hsl.h : null;
  }
  const preset = SECONDARY_PRESETS.find((p) => p.key === key) ?? THEME_PRESETS.find((p) => p.key === key);
  return preset ? preset.hue : null;
}

export type PairVerdict =
  | { kind: "ok" }
  | { kind: "close"; distance: number; message: string }
  | { kind: "indistinct"; distance: number; message: string };

/**
 * Whether an accent and a second colour can do their jobs together.
 *
 * The second colour exists to mean something different from the first — it
 * marks advancing players, scores under par, matches won. Contrast against the
 * background is already guaranteed by the ramp, so the only way the pair can
 * fail is against *each other*:
 *
 *  - Under 24° apart the two are the same colour to most eyes, and the same
 *    colour to everyone on a phone in the sun. A leaderboard where "leading"
 *    and "advancing" are indistinguishable has lost the information the
 *    second colour was carrying — that pairing is refused.
 *  - 24–45° reads as adjacent; some clubs genuinely wear it, so it warns and
 *    lets them.
 *  - Wider is fine, whatever anyone's taste says: taste belongs to the club.
 */
export function pairVerdict(theme: ClubTheme): PairVerdict {
  const accent = themeHue(theme.accentKey, theme.accentHex);
  const secondary = themeHue(theme.secondaryKey, theme.secondaryHex);
  if (accent === null || secondary === null) return { kind: "ok" };
  const distance = hueDistance(accent, secondary);
  if (distance < 24) {
    return {
      kind: "indistinct",
      distance,
      message:
        "These two are close enough to read as one colour — the second colour marks advancing players and scores under par, and it would vanish into the first.",
    };
  }
  if (distance < 45) {
    return {
      kind: "close",
      distance,
      message:
        "These sit close on the colour wheel. They stay distinguishable, but only just — worth a look at the preview before saving.",
    };
  }
  return { kind: "ok" };
}
