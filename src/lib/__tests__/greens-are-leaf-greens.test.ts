import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { ACCENT_PRESETS, FAIRWAY, SECONDARY_PRESETS, THEME_PAIRS, hexToHsl, themeScale, DARK_GROUND, LIGHT_GROUND } from "../themes";
import { LANDING_HUES, landingTokens, leafTokens } from "../landing-palette";

/**
 * TOURNEYHQ'S GREEN IS THE INDIA-FLAG GREEN (Ajay, 2026-10-10).
 *
 * `#138808`, hue 115: a leaf green. Until that day the product's greens were
 * the deep, blue-leaning ones — Fairway at hue 151, Ivy at 158, Signal at 137,
 * the scoreboard frame, the ball in the logo — and beside white those read as
 * another country's flag. His instruction was to take that look out
 * "everywhere", and to use the India green or some other green.
 *
 * So this is a sweep of the CLASS rather than a list of the places fixed that
 * day: no colour anywhere in the source may sit in the band those greens
 * occupied. A new preset, a new token or a hex pasted into a component is
 * caught the day it is written, by a rule that does not need anybody to
 * remember why.
 *
 * What it reads: six- and eight-digit hex, `hsl()` and `rgb()` in every source
 * file, stylesheet, SVG and script — and every preset's hue and generated
 * ramp. What it does not: three-digit hex (in this codebase `#495` is nearly
 * always a pull request), a colour a CLUB types as its own, and images.
 */

/** The band the old greens sat in. India green is 115; the flag it must not resemble is 145. */
const BAND = { from: 128, to: 172 };
/** Below this a colour is a grey with a tint, not a green anybody would name. */
const MIN_SATURATION = 0.18;

function inBand(hue: number, saturation: number): boolean {
  return hue >= BAND.from && hue <= BAND.to && saturation >= MIN_SATURATION;
}

function hexInBand(hex: string): boolean {
  const c = hexToHsl(hex.slice(0, 7));
  return !!c && inBand(c.h, c.s);
}

function rgbToHue(r: number, g: number, b: number): { h: number; s: number } {
  const hex = "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
  const c = hexToHsl(hex);
  return { h: c?.h ?? 0, s: c?.s ?? 0 };
}

/** Every colour written in one file that falls in the band, as `line: text`. */
function offenders(text: string): string[] {
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?(?![0-9a-fA-F])/g)) {
      if (hexInBand(m[0])) out.push(`${i + 1}: ${m[0]}`);
    }
    for (const m of line.matchAll(/hsla?\(\s*(\d{1,3})(?:deg)?[\s,]+(\d{1,3})%/g)) {
      if (inBand(Number(m[1]), Number(m[2]) / 100)) out.push(`${i + 1}: ${m[0]}…)`);
    }
    for (const m of line.matchAll(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/g)) {
      const c = rgbToHue(Number(m[1]), Number(m[2]), Number(m[3]));
      if (inBand(c.h, c.s)) out.push(`${i + 1}: ${m[0]}…)`);
    }
  });
  return out;
}

const READ = new Set([".ts", ".tsx", ".css", ".svg", ".mjs", ".js", ".json", ".webmanifest"]);

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "generated" || name === "__tests__" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (READ.has(extname(name)) && !name.includes(".test.")) yield path;
  }
}

describe("no colour in the product sits in the deep blue-leaning green band", () => {
  it("CONTROL: the detector flags the greens it was written for, and passes the ones that replaced them", () => {
    // The old Fairway, the old scoreboard frame, a flag-dark green, and the same in the other notations.
    expect(offenders('fill="#3c8361"')).toHaveLength(1);
    expect(offenders("--sb-frame: #1f5a3d;")).toHaveLength(1);
    expect(offenders("color: #01411c")).toHaveLength(1);
    expect(offenders("color: hsl(158, 50%, 30%)")).toHaveLength(1);
    expect(offenders("color: rgb(60, 131, 97)")).toHaveLength(1);
    // India green, the retuned Fairway, TourneyHQ's orange, a neutral with a green tint.
    expect(offenders('fill="#138808"')).toEqual([]);
    expect(offenders('fill="#35932c"')).toEqual([]);
    expect(offenders('fill="#f2862e"')).toEqual([]);
    expect(offenders("background: #16181a")).toEqual([]);
  });

  it("holds for every colour a club can pick, in either role", () => {
    for (const preset of [...ACCENT_PRESETS, ...SECONDARY_PRESETS]) {
      expect(inBand(preset.hue, preset.saturation), `${preset.name} is at hue ${preset.hue}`).toBe(false);
    }
    // And for what the ramp actually draws from them, on both grounds — a
    // hand-tuned shade is not obliged to match the hue its preset declares.
    for (const preset of [...ACCENT_PRESETS, FAIRWAY]) {
      for (const ground of [DARK_GROUND, LIGHT_GROUND]) {
        for (const [step, hex] of Object.entries(themeScale(preset, ground))) {
          expect(hexInBand(hex), `${preset.name} ${step} on ${ground.key} is ${hex}`).toBe(false);
        }
      }
    }
  });

  it("holds for every ready-made scheme, which is built only from those colours", () => {
    const keys = new Set([...ACCENT_PRESETS, ...SECONDARY_PRESETS].map((p) => p.key));
    for (const pair of THEME_PAIRS) {
      expect(keys.has(pair.accentKey) && keys.has(pair.secondaryKey), `${pair.name} names a colour that is not a preset`).toBe(true);
    }
  });

  it("holds for the front door, whose colours are generated from hues rather than written", () => {
    // The landing page keeps its own palette, solved from a handful of hue
    // NUMBERS (`flag: 151` was one), so no hex of its green exists in the
    // source for the sweep below to read. Its green was found by reading the
    // file, after the sweep had passed without it.
    expect(inBand(LANDING_HUES.flag, 1), `the landing's green is at hue ${LANDING_HUES.flag}`).toBe(false);
    for (const appearance of ["dark", "light"] as const) {
      const css = landingTokens(appearance, "");
      expect(css).toContain("--flag:");
      expect(offenders(css), `the ${appearance} landing draws a colour in the band`).toEqual([]);
    }
    // And the green sections a phone draws (the outdoor test): the whole surface is a green there,
    // so it is the place a blue-leaning one would do the most damage.
    for (const ground of ["navy", "leaf"] as const) {
      const css = leafTokens(ground, "");
      expect(css).toContain("--ground-2:");
      expect(offenders(css), `the leaf sections on ${ground} draw a colour in the band`).toEqual([]);
    }
  });

  it("holds for every colour written in the source", () => {
    const found: string[] = [];
    let files = 0;
    for (const root of ["src", "scripts", "public"]) {
      for (const file of sourceFiles(join(process.cwd(), root))) {
        files += 1;
        for (const hit of offenders(readFileSync(file, "utf8"))) {
          found.push(`${file.slice(process.cwd().length + 1).replace(/\\/g, "/")}:${hit}`);
        }
      }
    }
    // A walk that read nothing would pass this by looking at nothing.
    expect(files, "the sweep read almost no files — did the directories move?").toBeGreaterThan(400);
    expect(found).toEqual([]);
  });
});
