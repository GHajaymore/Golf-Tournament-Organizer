import { describe, it, expect } from "vitest";
import {
  THEME_PRESETS,
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
