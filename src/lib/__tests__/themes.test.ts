import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  THEME_PRESETS,
  ACCENT_PRESETS,
  THEME_PAIRS,
  MIN_HUE_SEPARATION,
  pairFor,
  DEFAULT_THEME,
  themeFor,
  isThemeKey,
  themeScale,
  themeVars,
  hslToHex,
  contrastRatio,
  relativeLuminance,
  APP_BG,
  APP_SURFACE,
  hexToHsl,
  customPreset,
  resolveTheme,
  resolvedThemeVars,
  sunlightCheck,
  sunlightCheckFor,
  SUNLIGHT_RATIO,
  DARK_GROUND,
  LIGHT_GROUND,
  groundFor,
  isAppearance,
  APPEARANCES,
  DEFAULT_CLUB_THEME,
  FAIRWAY,
  SECONDARY_PRESETS,
  resolveSecondary,
  themeVarsFor,
  themeCss,
  sunlightVerdict,
  type ClubTheme,
  pairVerdict,
  hueDistance,
} from "../themes";

describe("the preset list", () => {
  it("has unique keys and a default that exists", () => {
    const keys = THEME_PRESETS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(DEFAULT_THEME);
  });

  it("falls back rather than throwing on an unknown key", () => {
    expect(themeFor("chartreuse").key).toBe(DEFAULT_THEME);
    expect(themeFor(null).key).toBe(DEFAULT_THEME);
    expect(isThemeKey("chartreuse")).toBe(false);
  });

  it("keeps the existing orange as the default, unchanged in spirit", () => {
    // Existing tournaments must not visibly re-skin themselves.
    const sunset = themeScale(themeFor("sunset"));
    expect(sunset[500].toLowerCase()).toMatch(/^#f/); // still a warm orange
    expect(contrastRatio(sunset[500], "#f2872e")).toBeLessThan(1.15); // near-identical
  });
});

describe("hslToHex", () => {
  it("produces valid six-digit hex for every preset and step", () => {
    for (const p of THEME_PRESETS) {
      for (const shade of Object.values(themeScale(p))) {
        expect(shade, `${p.key}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("handles the greys and the hue wrap", () => {
    expect(hslToHex(0, 0, 0)).toBe("#000000");
    expect(hslToHex(0, 0, 1)).toBe("#ffffff");
    expect(hslToHex(360, 0.5, 0.5)).toBe(hslToHex(0, 0.5, 0.5));
  });
});

describe("every preset stays readable — the reason these aren't a colour picker", () => {
  // A free hex field lets a club pick the pale yellow off its crest and make
  // accent text vanish. These thresholds are what a preset buys.

  it("gives light shades enough contrast to be text on the dark page", () => {
    // 300 and 400 are what the app uses for accent-coloured text.
    for (const p of THEME_PRESETS) {
      const s = themeScale(p);
      for (const step of [300, 400]) {
        const ratio = contrastRatio(s[step], APP_BG);
        expect(ratio, `${p.key}-${step} on page bg`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps that contrast on card surfaces too, not just the page", () => {
    for (const p of THEME_PRESETS) {
      const s = themeScale(p);
      expect(contrastRatio(s[300], APP_SURFACE), `${p.key}-300 on surface`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("makes the base accent usable as a large-text or UI colour", () => {
    // 500 carries buttons and borders; 3:1 is the threshold for UI components
    // and large text.
    for (const p of THEME_PRESETS) {
      const ratio = contrastRatio(themeScale(p)[500], APP_BG);
      expect(ratio, `${p.key}-500 on page bg`).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps the darkest shades dark enough to sit behind light text", () => {
    // 900 is used as a tinted background under accent text.
    for (const p of THEME_PRESETS) {
      expect(relativeLuminance(themeScale(p)[900]), `${p.key}-900`).toBeLessThan(0.1);
    }
  });

  it("ramps monotonically from light to dark", () => {
    // A scale that doubles back would make 600 lighter than 500 and break
    // every hover state built on the assumption.
    for (const p of THEME_PRESETS) {
      const s = themeScale(p);
      const steps = [100, 200, 300, 400, 500, 600, 700, 800, 900];
      for (let i = 1; i < steps.length; i += 1) {
        expect(
          relativeLuminance(s[steps[i]]),
          `${p.key}: ${steps[i]} should be darker than ${steps[i - 1]}`,
        ).toBeLessThan(relativeLuminance(s[steps[i - 1]]));
      }
    }
  });
});

describe("themeVars", () => {
  it("emits the whole ramp plus the base token", () => {
    const vars = themeVars("links");
    expect(vars["--color-accent"]).toBe(vars["--color-accent-500"]);
    for (const step of [100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      expect(vars[`--color-accent-${step}`]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("leaves the fairway green alone", () => {
    // accent-2 carries meaning — advancing rows, positive deltas — and should
    // not shift underneath a club rebrand.
    // Matched precisely: "--color-accent-200" contains the substring
    // "accent-2", so a naive includes() check fails on the primary ramp.
    const vars = themeVars("claret");
    const secondary = Object.keys(vars).filter((k) => /^--color-accent-2(-\d+)?$/.test(k));
    expect(secondary).toEqual([]);
  });

  it("returns the default ramp for an unknown key", () => {
    expect(themeVars("nonsense")).toEqual(themeVars(DEFAULT_THEME));
  });
});

describe("a club's own colour", () => {
  it("parses both hex forms and rejects anything else", () => {
    expect(hexToHsl("#f2872e")).not.toBeNull();
    expect(hexToHsl("f2872e")).not.toBeNull();
    expect(hexToHsl("#abc")).not.toBeNull();
    for (const bad of ["", "#12345", "not-a-colour", "#gggggg", "rgb(1,2,3)"]) {
      expect(hexToHsl(bad), bad).toBeNull();
    }
  });

  it("round-trips a colour's hue", () => {
    const hsl = hexToHsl("#3c8361")!;
    expect(hslToHex(hsl.h, hsl.s, hsl.l).toLowerCase()).toBe("#3c8361");
  });

  it("keeps the club's hue but replaces its lightness", () => {
    // A club enters the pale yellow off its crest. The hue survives; the
    // washed-out lightness that would make it illegible does not.
    const pale = customPreset("#faf3c0")!;
    const scale = themeScale(pale);
    expect(Math.round(pale.hue)).toBeCloseTo(Math.round(hexToHsl("#faf3c0")!.h), 0);
    expect(contrastRatio(scale[300], APP_BG)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(scale[500], APP_BG)).toBeGreaterThanOrEqual(3);
  });

  it("gives a near-grey brand colour enough saturation to read as an accent", () => {
    expect(customPreset("#807f7e")!.saturation).toBeGreaterThanOrEqual(0.25);
  });

  it("EVERY hue survives the ramp — the claim that makes an open field safe", () => {
    // Contrast is driven almost entirely by lightness, so fixing the ramp
    // should keep any hue legible. Asserted rather than assumed: green is far
    // brighter than blue at the same lightness, and if some band failed this
    // the open colour field would be a trap.
    for (let h = 0; h < 360; h += 1) {
      for (const s of [0.25, 0.6, 0.95]) {
        const scale = themeScale({ key: "t", name: "t", blurb: "", hue: h, saturation: s });
        expect(contrastRatio(scale[300], APP_BG), `h${h} s${s} 300/bg`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(scale[300], APP_SURFACE), `h${h} s${s} 300/surface`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(scale[400], APP_BG), `h${h} s${s} 400/bg`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(scale[500], APP_BG), `h${h} s${s} 500/bg`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("falls back to a preset when the custom colour is unusable", () => {
    expect(resolveTheme("custom", "not-a-colour").key).toBe(DEFAULT_THEME);
    expect(resolveTheme("custom", "").key).toBe(DEFAULT_THEME);
    expect(resolveTheme("custom", "#3c8361").key).toBe("custom");
  });

  it("ignores a custom colour when a preset is selected", () => {
    expect(resolvedThemeVars("links", "#ff0000")).toEqual(themeVars("links"));
  });
});

describe("readable in sunlight, on the course", () => {
  it("holds outdoor colours to a higher bar than the indoor minimum", () => {
    // WCAG's 4.5:1 assumes an office. A phone in direct sun is a different
    // problem, and this app is used on the 14th tee.
    expect(SUNLIGHT_RATIO).toBeGreaterThan(4.5);
  });

  it("warns about a colour that clears indoors but not outdoors", () => {
    // Deep saturated blue: legal by WCAG, dim on a bright day.
    const check = sunlightCheck({ key: "t", name: "t", blurb: "", hue: 240, saturation: 0.9 });
    expect(check.ok).toBe(false);
    expect(check.warning).toMatch(/sunlight/i);
    expect(check.warning).toMatch(/Players entering scores/);
  });

  it("says nothing about a colour that is fine outdoors", () => {
    const check = sunlightCheck(themeFor("bunker"));
    if (check.ok) expect(check.warning).toBeNull();
    expect(check.worstRatio).toBeGreaterThan(4.5); // legible regardless
  });

  it("reports the weakest shade a player actually reads", () => {
    const check = sunlightCheck(themeFor("links"));
    expect([300, 400, 500]).toContain(check.worstStep);
  });

  it("never warns about something that fails the indoor floor instead", () => {
    // Every generated shade already clears WCAG by construction, so any
    // warning is genuinely about sunlight rather than a broken palette.
    for (const p of THEME_PRESETS) {
      const check = sunlightCheck(p);
      expect(check.worstRatio, `${p.key}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("checks a club's custom colour the same way", () => {
    expect(sunlightCheckFor("custom", "#0000cc").ok).toBe(false);
    expect(sunlightCheckFor("custom", "not-a-colour").ok).toBe(
      sunlightCheck(themeFor(DEFAULT_THEME)).ok,
    );
  });
});

/* ── Light mode ──────────────────────────────────────────────────────────── */

describe("the light ground", () => {
  it("names three appearances and rejects anything else", () => {
    expect(APPEARANCES.map((a) => a.key)).toEqual(["dark", "light", "auto"]);
    expect(isAppearance("dark")).toBe(true);
    expect(isAppearance("auto")).toBe(true);
    expect(isAppearance("sepia")).toBe(false);
    expect(isAppearance("")).toBe(false);
  });

  it("puts cards above the page on both grounds", () => {
    expect(relativeLuminance(DARK_GROUND.surface)).toBeGreaterThan(relativeLuminance(DARK_GROUND.bg));
    expect(relativeLuminance(LIGHT_GROUND.surface)).toBeGreaterThan(relativeLuminance(LIGHT_GROUND.bg));
    expect(relativeLuminance(LIGHT_GROUND.bg)).toBeGreaterThan(0.7);
    expect(relativeLuminance(DARK_GROUND.bg)).toBeLessThan(0.05);
  });

  it("makes the accent DARKER on a light ground, not lighter", () => {
    // The bug this exists to catch: a solver that always searches upward would
    // drive the colour into the background it has to stand out from, and
    // nothing else in the suite would notice.
    for (const preset of THEME_PRESETS) {
      const dark = themeScale(preset, DARK_GROUND);
      const light = themeScale(preset, LIGHT_GROUND);
      for (const step of [300, 400, 500]) {
        expect(
          relativeLuminance(light[step]),
          `${preset.key} ${step} must be darker in light mode`,
        ).toBeLessThan(relativeLuminance(dark[step]));
      }
    }
  });

  it("keeps every preset readable on BOTH grounds", () => {
    for (const ground of [DARK_GROUND, LIGHT_GROUND]) {
      for (const preset of [...THEME_PRESETS, FAIRWAY]) {
        const s = themeScale(preset, ground);
        expect(contrastRatio(s[300], ground.surface), `${preset.key} 300 on ${ground.key}`).toBeGreaterThanOrEqual(4.49);
        expect(contrastRatio(s[400], ground.bg), `${preset.key} 400 on ${ground.key}`).toBeGreaterThanOrEqual(4.49);
        expect(contrastRatio(s[500], ground.bg), `${preset.key} 500 on ${ground.key}`).toBeGreaterThanOrEqual(2.99);
      }
    }
  });

  it("survives EVERY hue on a light ground too, not just the presets", () => {
    // The dark-ground sweep found blue failing at 2.98:1. A light ground has
    // its own worst hues, so the claim that an open colour field is safe has
    // to be proved twice.
    for (let hue = 0; hue < 360; hue += 1) {
      for (const saturation of [0.25, 0.6, 0.95]) {
        const s = themeScale({ key: "x", name: "x", blurb: "", hue, saturation }, LIGHT_GROUND);
        expect(contrastRatio(s[300], LIGHT_GROUND.surface), `hue ${hue} sat ${saturation} step 300`).toBeGreaterThanOrEqual(4.49);
        expect(contrastRatio(s[400], LIGHT_GROUND.bg), `hue ${hue} sat ${saturation} step 400`).toBeGreaterThanOrEqual(4.49);
        expect(contrastRatio(s[500], LIGHT_GROUND.bg), `hue ${hue} sat ${saturation} step 500`).toBeGreaterThanOrEqual(2.99);
      }
    }
  });

  it("reverses the ramp so a token keeps its role", () => {
    // --color-accent-300 is text and --color-accent-900 is a background tint.
    // On a light ground that means 300 must be dark and 900 light — the exact
    // opposite of dark mode, with no component changing.
    const dark = themeScale(THEME_PRESETS[0], DARK_GROUND);
    const light = themeScale(THEME_PRESETS[0], LIGHT_GROUND);
    expect(relativeLuminance(dark[100])).toBeGreaterThan(relativeLuminance(dark[900]));
    expect(relativeLuminance(light[100])).toBeLessThan(relativeLuminance(light[900]));
  });

  it("gives light mode a red that can actually be read", () => {
    expect(contrastRatio(LIGHT_GROUND.danger, LIGHT_GROUND.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(DARK_GROUND.danger, DARK_GROUND.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps body text legible on both grounds", () => {
    for (const g of [DARK_GROUND, LIGHT_GROUND]) {
      expect(contrastRatio(g.text, g.bg), `text on ${g.key}`).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(g.text, g.surface), `text on ${g.key} card`).toBeGreaterThanOrEqual(7);
    }
  });

  it("keeps the muted-label neutral usable on both grounds", () => {
    // --color-neutral-500 carries muted icons and labels in both modes; the
    // ramp reverses around it, so it has to work either way.
    for (const g of [DARK_GROUND, LIGHT_GROUND]) {
      expect(contrastRatio(g.neutrals[4], g.bg), `neutral-500 on ${g.key}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("resolves a ground from an appearance", () => {
    expect(groundFor("light")).toBe(LIGHT_GROUND);
    expect(groundFor("dark")).toBe(DARK_GROUND);
  });
});

/* ── The second colour ───────────────────────────────────────────────────── */

describe("the second colour", () => {
  it("defaults to the fairway green", () => {
    expect(DEFAULT_CLUB_THEME.secondaryKey).toBe("fairway");
    expect(resolveSecondary(null, "")).toBe(FAIRWAY);
    expect(resolveSecondary("nonsense", "")).toBe(FAIRWAY);
  });

  it("offers fairway first, then the same presets as the main colour", () => {
    expect(SECONDARY_PRESETS[0]).toBe(FAIRWAY);
    expect(SECONDARY_PRESETS.length).toBe(THEME_PRESETS.length + 1);
    expect(new Set(SECONDARY_PRESETS.map((p) => p.key)).size).toBe(SECONDARY_PRESETS.length);
  });

  it("stays recognisably the green the app has always drawn", () => {
    const s = themeScale(FAIRWAY, DARK_GROUND);
    const hsl = hexToHsl(s[500]);
    expect(hsl!.h).toBeGreaterThan(130);
    expect(hsl!.h).toBeLessThan(175);
  });

  it("takes a club's own colour, same as the main one", () => {
    const p = resolveSecondary("custom", "#4b0082");
    expect(p.key).toBe("custom");
    expect(Math.round(p.hue)).toBe(275);
  });
});

/* ── The emitted stylesheet ──────────────────────────────────────────────── */

describe("themeCss", () => {
  const theme = (over: Partial<ClubTheme> = {}): ClubTheme => ({ ...DEFAULT_CLUB_THEME, ...over });

  it("emits every token the app reads", () => {
    const vars = themeVarsFor(theme(), DARK_GROUND);
    for (const name of ["--color-accent", "--color-accent-2", "--color-bg", "--color-surface",
      "--color-text", "--color-divider", "--color-danger", "--color-danger-bg"]) {
      expect(vars[name], name).toBeTruthy();
    }
    for (const step of [100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      expect(vars[`--color-accent-${step}`], `accent ${step}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(vars[`--color-accent-2-${step}`], `accent2 ${step}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(vars[`--color-neutral-${step}`], `neutral ${step}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("emits one block for a fixed appearance and a media query for auto", () => {
    expect(themeCss(theme({ appearance: "dark" }))).not.toContain("@media");
    expect(themeCss(theme({ appearance: "light" }))).not.toContain("@media");

    const auto = themeCss(theme({ appearance: "auto" }));
    expect(auto).toContain("@media(prefers-color-scheme:light)");
    // Both grounds have to be present, or "follow the device" only follows it
    // in one direction.
    expect(auto).toContain(DARK_GROUND.bg);
    expect(auto).toContain(LIGHT_GROUND.bg);
  });

  it("scopes every rule to the selector it was given", () => {
    const css = themeCss(theme({ appearance: "auto" }), "#club-theme");
    expect(css.match(/#club-theme\{/g)?.length).toBe(2);
    expect(css).not.toMatch(/(^|[^-\w])(:root|html|body)\s*\{/);
  });

  it("puts the right ground in the right block", () => {
    expect(themeCss(theme({ appearance: "light" }))).toContain(LIGHT_GROUND.bg);
    expect(themeCss(theme({ appearance: "light" }))).not.toContain(DARK_GROUND.bg);
    expect(themeCss(theme({ appearance: "dark" }))).toContain(DARK_GROUND.bg);
    expect(themeCss(theme({ appearance: "dark" }))).not.toContain(LIGHT_GROUND.bg);
  });

  it("lets nothing club-typed reach the stylesheet", () => {
    // This output goes into a <style> element. The hex is validated on save,
    // but the guarantee that matters is structural: every value is regenerated
    // by hslToHex, so even a hex field carrying CSS cannot survive the ramp.
    const attacks = [
      "#fff}body{display:none}",
      "red;} * {background:url(https://evil.example/x)",
      "#ff0000</style><script>alert(1)</script>",
      "expression(alert(1))",
      "#ab\\3c script",
    ];
    for (const hex of attacks) {
      for (const appearance of ["dark", "light", "auto"] as const) {
        const css = themeCss(
          theme({ accentKey: "custom", accentHex: hex, secondaryKey: "custom", secondaryHex: hex, appearance }),
        );
        expect(css, hex).not.toContain("<");
        expect(css, hex).not.toContain("script");
        expect(css, hex).not.toContain("url(");
        expect(css, hex).not.toContain("expression");
        // Braces only where the generator put them: one per rule, plus the
        // media wrapper on auto.
        const opens = (css.match(/\{/g) ?? []).length;
        expect(opens, hex).toBe(appearance === "auto" ? 3 : 1);
      }
    }
  });

  it("falls back to a preset rather than emitting nothing for a bad colour", () => {
    const css = themeCss(theme({ accentKey: "custom", accentHex: "not-a-colour" }));
    expect(css).toContain("--color-accent:");
    expect(css.length).toBeGreaterThan(200);
  });
});

/* ── Outdoors ────────────────────────────────────────────────────────────── */

describe("sunlightVerdict", () => {
  const theme = (over: Partial<ClubTheme> = {}): ClubTheme => ({ ...DEFAULT_CLUB_THEME, ...over });

  it("judges 'auto' as light, because that is when the sun is the problem", () => {
    // A device following daylight is in light mode exactly when it is bright
    // out. Reporting the dark-mode number there would be reassuring and wrong.
    const c = theme({ accentKey: "custom", accentHex: "#0b3d91" });
    expect(sunlightVerdict({ ...c, appearance: "auto" })).toEqual(
      sunlightVerdict({ ...c, appearance: "light" }),
    );
  });

  it("names which of the two colours is the weak one", () => {
    const v = sunlightVerdict(theme({ appearance: "dark", secondaryKey: "custom", secondaryHex: "#0b3d91" }));
    if (v.warning) expect(v.warning).toMatch(/second colour|main colour/);
  });

  it("raises light mode for the reason that is actually true", () => {
    // Not "these colours score better in light mode" — measured, they don't. A
    // light theme's accent sits at its readable minimum by construction, since
    // reaching 7:1 on paper would need a near-black. The honest claim is about
    // the bright page, and that is what has to be said.
    const v = sunlightVerdict(theme({ appearance: "dark", accentKey: "custom", accentHex: "#0000cc" }));
    expect(v.ok).toBe(false);
    expect(v.suggestion).toContain("light screen");
    expect(v.suggestion).not.toMatch(/these same colours|hold up/i);
  });

  it("never suggests switching to a mode that is already selected", () => {
    for (const appearance of ["light", "auto"] as const) {
      const v = sunlightVerdict(theme({ appearance, accentKey: "custom", accentHex: "#0000cc" }));
      expect(v.suggestion, appearance).toBeNull();
    }
  });

  it("says nothing at all when both colours are fine", () => {
    const v = sunlightVerdict(theme({ appearance: "light" }));
    if (v.ok) {
      expect(v.warning).toBeNull();
      expect(v.suggestion).toBeNull();
    }
  });
});

/* ── The default theme must not move ─────────────────────────────────────── */

describe("a club that has chosen nothing sees no change", () => {
  // These are the values globals.css shipped before the theme engine existed.
  // Regenerating them from the ramp moved the second accent from a deep forest
  // green to a bright mint — every advancing row, under-par score and won
  // match in the app changed colour for clubs that had picked nothing. Pinned
  // exactly, because "close enough" is what let it drift the first time.
  const SHIPPED_ACCENT: Record<number, string> = {
    100: "#fef3ea", 200: "#fde0cb", 300: "#fac6a1", 400: "#f6a566", 500: "#f2872e",
    600: "#d06f23", 700: "#a5561b", 800: "#6c3c18", 900: "#38230f",
  };
  const SHIPPED_ACCENT_2: Record<number, string> = {
    100: "#e7f5ec", 200: "#c3e6d0", 300: "#93d0ac", 400: "#5fb484", 500: "#3c8361",
    600: "#2e6a4c", 700: "#23503a", 800: "#173627", 900: "#0d2016",
  };
  const STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

  it("reproduces the fairway green exactly", () => {
    const s = themeScale(FAIRWAY, DARK_GROUND);
    for (const step of STEPS) {
      expect(s[step].toLowerCase(), `accent-2 ${step}`).toBe(SHIPPED_ACCENT_2[step]);
    }
  });

  it("emits that green as the default second accent", () => {
    const vars = themeVarsFor(DEFAULT_CLUB_THEME, DARK_GROUND);
    expect(vars["--color-accent-2"].toLowerCase()).toBe("#3c8361");
    for (const step of STEPS) {
      expect(vars[`--color-accent-2-${step}`].toLowerCase(), `accent-2-${step}`).toBe(
        SHIPPED_ACCENT_2[step],
      );
    }
  });

  it("keeps the primary orange visually where it was", () => {
    // Generated rather than pinned — the primary IS a preset, and the solver
    // is allowed to adjust the dark end. What it may not do is change the
    // colour anyone actually reads.
    const s = themeScale(themeFor("sunset"), DARK_GROUND);
    for (const step of [100, 200, 300, 400, 500]) {
      expect(
        contrastRatio(s[step], SHIPPED_ACCENT[step]),
        `accent ${step} drifted from ${SHIPPED_ACCENT[step]} to ${s[step]}`,
      ).toBeLessThan(1.05);
    }
  });

  it("still generates a light-mode green rather than reusing the dark one", () => {
    // The pinned values are tuned for a dark page. Reversing them would not
    // produce a light ramp, so light mode must keep generating.
    const light = themeScale(FAIRWAY, LIGHT_GROUND);
    expect(light[500].toLowerCase()).not.toBe("#3c8361");
    expect(contrastRatio(light[500], LIGHT_GROUND.bg)).toBeGreaterThanOrEqual(4.49);
    expect(contrastRatio(light[300], LIGHT_GROUND.surface)).toBeGreaterThanOrEqual(4.49);
  });

  it("leaves every other preset generated", () => {
    // Only the fairway green is hand-tuned. A second pinned preset would mean
    // the ramp no longer describes what the app renders.
    const pinned = [...THEME_PRESETS, FAIRWAY].filter((p) => p.fixedDarkScale);
    expect(pinned.map((p) => p.key)).toEqual(["fairway"]);
  });
});

describe("the light ramp holds together too", () => {
  // The dark ground had a monotonicity test from the start. The light one did
  // not, and 400 and 500 quietly collapsed onto the same colour — both solve
  // against the same 4.5:1 floor and converged — which made every hover state
  // built on 400-vs-500 invisible.
  it("keeps every step distinct on a light ground", () => {
    for (const preset of [...THEME_PRESETS, FAIRWAY]) {
      const s = themeScale(preset, LIGHT_GROUND);
      const steps = [100, 200, 300, 400, 500, 600, 700, 800, 900];
      for (let i = 1; i < steps.length; i += 1) {
        expect(
          relativeLuminance(s[steps[i]]),
          `${preset.key}: light ${steps[i]} must be lighter than ${steps[i - 1]}`,
        ).toBeGreaterThan(relativeLuminance(s[steps[i - 1]]));
      }
    }
  });

  it("keeps 400 and 500 far enough apart to see", () => {
    // Adjacent steps that differ by less than about 8% relative luminance read
    // as the same colour, which is what a hover state must not do.
    for (const preset of [...THEME_PRESETS, FAIRWAY]) {
      for (const ground of [DARK_GROUND, LIGHT_GROUND]) {
        const s = themeScale(preset, ground);
        expect(
          s[400].toLowerCase(),
          `${preset.key} on ${ground.key}: 400 and 500 are the same colour`,
        ).not.toBe(s[500].toLowerCase());
      }
    }
  });

  it("keeps every hue's light ramp monotonic, not just the presets", () => {
    for (let hue = 0; hue < 360; hue += 5) {
      for (const saturation of [0.25, 0.6, 0.95]) {
        const s = themeScale({ key: "x", name: "x", blurb: "", hue, saturation }, LIGHT_GROUND);
        const steps = [100, 200, 300, 400, 500, 600, 700, 800, 900];
        for (let i = 1; i < steps.length; i += 1) {
          expect(
            relativeLuminance(s[steps[i]]),
            `hue ${hue} sat ${saturation}: ${steps[i]} vs ${steps[i - 1]}`,
          ).toBeGreaterThan(relativeLuminance(s[steps[i - 1]]));
        }
      }
    }
  });
});

describe("text sitting ON the accent", () => {
  // The filled primary button. Its label used to be mixed from the page
  // background, which measured 3.87:1 on a light ground — a pale off-white on
  // a mid-dark orange. This is the most-clicked control in the app.
  it("clears 4.5:1 for every preset on both grounds", () => {
    // Primary presets only. The fairway green is a *secondary* — it colours
    // advancing rows and positive deltas, and is never a filled button — so
    // holding it to the on-accent bar would be testing something the app
    // never renders. THEME_PRESETS is exactly the set a primary can be.
    for (const ground of [DARK_GROUND, LIGHT_GROUND]) {
      for (const preset of THEME_PRESETS) {
        const fill = themeScale(preset, ground)[500];
        expect(
          contrastRatio(ground.onAccent, fill),
          `${preset.key} label on ${ground.key} fill ${fill}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("clears it for a club's own colour too, at every hue", () => {
    for (let hue = 0; hue < 360; hue += 5) {
      for (const saturation of [0.25, 0.6, 0.95]) {
        for (const ground of [DARK_GROUND, LIGHT_GROUND]) {
          const fill = themeScale({ key: "x", name: "x", blurb: "", hue, saturation }, ground)[500];
          expect(
            contrastRatio(ground.onAccent, fill),
            `hue ${hue} sat ${saturation} on ${ground.key}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("is emitted as a token so the stylesheet doesn't have to derive it", () => {
    expect(themeVarsFor(DEFAULT_CLUB_THEME, DARK_GROUND)["--color-on-accent"]).toBe(DARK_GROUND.onAccent);
    expect(themeVarsFor(DEFAULT_CLUB_THEME, LIGHT_GROUND)["--color-on-accent"]).toBe(LIGHT_GROUND.onAccent);
  });
});

describe("two colours have to read as two colours", () => {
  it("measures hue distance the short way round the wheel", () => {
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(0, 180)).toBe(180);
    expect(hueDistance(27, 27)).toBe(0);
  });

  it("refuses a second colour indistinguishable from the accent", () => {
    // Sunset (27°) against Bunker (42°): fifteen degrees apart, one colour on
    // a phone in the sun — and "advancing" stops meaning anything.
    const v = pairVerdict({ ...DEFAULT_CLUB_THEME, secondaryKey: "bunker" });
    expect(v.kind).toBe("indistinct");
  });

  it("warns about an adjacent pair without refusing it", () => {
    // A custom hex 30-odd degrees from sunset: legal, flagged.
    const v = pairVerdict({ ...DEFAULT_CLUB_THEME, secondaryKey: "custom", secondaryHex: "#f2e422" });
    expect(v.kind).toBe("close");
  });

  it("passes the stock pairing without comment", () => {
    // Sunset orange and fairway green are the default for a reason.
    expect(pairVerdict(DEFAULT_CLUB_THEME).kind).toBe("ok");
  });

  it("stays quiet when a hue cannot be known", () => {
    // A half-typed custom hex is the picker's everyday state — nagging about
    // a colour that doesn't exist yet would fire on every keystroke.
    const v = pairVerdict({ ...DEFAULT_CLUB_THEME, secondaryKey: "custom", secondaryHex: "#zz" });
    expect(v.kind).toBe("ok");
  });

  it("is enforced where it matters — on the save endpoint", () => {
    const src = readFileSync(join(process.cwd(), "src/app/actions/organization.ts"), "utf8");
    expect(src).toMatch(/pairVerdict\(/);
    expect(src).toMatch(/pair\.kind === "indistinct"/);
  });
});

describe("ready-made palette pairs", () => {
  it("offers every palette for either role", () => {
    // Fairway used to be a second colour only, so a club whose identity is
    // green could not lead with it — the wrong way round for a golf club.
    expect(ACCENT_PRESETS.map((p) => p.key).sort()).toEqual(
      SECONDARY_PRESETS.map((p) => p.key).sort(),
    );
    expect(ACCENT_PRESETS.some((p) => p.key === "fairway")).toBe(true);
  });

  it("keeps both colours of every pair far enough apart to read as two", () => {
    // The guard that lets an organizer trust these without judging colour
    // themselves: a pair that clashes fails here rather than shipping.
    for (const pair of THEME_PAIRS) {
      const accent = ACCENT_PRESETS.find((p) => p.key === pair.accentKey);
      const secondary = SECONDARY_PRESETS.find((p) => p.key === pair.secondaryKey);
      expect(accent, `${pair.key}: unknown accent ${pair.accentKey}`).toBeDefined();
      expect(secondary, `${pair.key}: unknown secondary ${pair.secondaryKey}`).toBeDefined();
      expect(
        hueDistance(accent!.hue, secondary!.hue),
        `${pair.name} (${pair.accentKey} + ${pair.secondaryKey}) reads as one colour`,
      ).toBeGreaterThanOrEqual(MIN_HUE_SEPARATION);
    }
  });

  it("never lists the same palette twice in one pair", () => {
    for (const pair of THEME_PAIRS) {
      expect(pair.accentKey, `${pair.name}`).not.toBe(pair.secondaryKey);
    }
  });

  it("gives every pair a distinct key, so one can't shadow another", () => {
    const keys = THEME_PAIRS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("recognises a club sitting on a pair, and one that has gone its own way", () => {
    expect(pairFor("sunset", "fairway")?.key).toBe("classic");
    // Two colours that match no pair are not wrong — just not a preset.
    expect(pairFor("claret", "ivy")).toBeNull();
  });
});

describe("the neutral ramps are readable on their own ground", () => {
  /**
   * The accent ramps are *solved* against `contrastFloors`, so they cannot
   * drift. The neutrals are hand-picked constants and were never measured —
   * which is how the light ground shipped `--color-neutral-500` at 4.46:1,
   * just under the bar, carrying the 10px page kicker ("Overview", "Set-up")
   * on every screen. Small muted text on a pale ground is the easiest thing
   * in an interface to get wrong by eye and the hardest to read outdoors.
   *
   * Steps 100–500 are the foreground half of the ramp on either ground; the
   * 600–900 end is background tint and carries no text, so it is not held to
   * a text ratio.
   */
  const FOREGROUND_STEPS = [100, 200, 300, 400, 500];
  const STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

  for (const ground of [DARK_GROUND, LIGHT_GROUND]) {
    for (const step of FOREGROUND_STEPS) {
      const shade = ground.neutrals[STEPS.indexOf(step)];

      it(`${ground.key}: neutral-${step} is readable on the page`, () => {
        expect(
          contrastRatio(shade, ground.bg),
          `${ground.key} neutral-${step} (${shade}) on bg ${ground.bg}`,
        ).toBeGreaterThanOrEqual(4.5);
      });

      it(`${ground.key}: neutral-${step} is readable on a card`, () => {
        expect(
          contrastRatio(shade, ground.surface),
          `${ground.key} neutral-${step} (${shade}) on surface ${ground.surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }

    it(`${ground.key}: the ramp still darkens step by step`, () => {
      // Fixing a contrast failure by dragging one step toward its neighbour
      // would pass the check above and quietly flatten the ramp.
      const lums = STEPS.map((s) => relativeLuminance(ground.neutrals[STEPS.indexOf(s)]));
      const rising = ground.key === "light";
      for (let i = 1; i < lums.length; i++) {
        expect(
          rising ? lums[i] > lums[i - 1] : lums[i] < lums[i - 1],
          `${ground.key} neutral-${STEPS[i]} is not distinct from neutral-${STEPS[i - 1]}`,
        ).toBe(true);
      }
    });
  }
});
