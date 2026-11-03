import { describe, it, expect } from "vitest";
import { readSource } from "./source";
import { DARK_GROUND, LIGHT_GROUND, SUNLIGHT_RATIO, THEME_PAIRS, contrastRatio, themeVarsFor, type ClubTheme, type Ground } from "@/lib/themes";

/**
 * THE TIMELINE'S CHIPS AND MARKS READ ON EVERY THEME (Rounds & formats step 2, 2 Nov).
 *
 * Step 2 brought new colour: the state chips ("No date", "Set up", "In play"), the recipe tiles,
 * the par 3 and par 5 marks on the course's scorecard strip, the "Needs you" count, the effect
 * line, the link between rounds. Each is a fill mixed from the club's tokens with words on it, and
 * a fill mixed at 70% over a card is not a colour anybody checked by eye.
 *
 * So this reads the RULES THEMSELVES out of design-system.css — the `background` and `color` each
 * one declares — resolves them against the club's real tokens (`themeVarsFor`) on four schemes
 * (Tournament and Desert on the dark ground, Championship and Coastal on the light), composites
 * every translucent mix over each ground it can sit on (page, card, the card one step up), and
 * holds the words to SUNLIGHT_RATIO on dark and 4.5:1 on light. A rule that names a raw colour
 * instead of a `--color-*` token fails too: it would not follow the club's theme at all.
 *
 * Worked by a route the stylesheet does not take: plain sRGB arithmetic, the way `color-mix(in
 * srgb, …)` is defined, then WCAG's ratio (`contrastRatio`).
 */

const CSS = readSource("src", "app", "design-system.css");
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

/** Every declaration of the rules whose selector is exactly one of `mark`'s, in that order (later wins). */
function declarationsOf(css: string, mark: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const selector of mark.split(" | ")) {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === selector);
    // A misspelt override would otherwise be measured as the shared rule and pass.
    if (rules.length === 0) throw new Error(`${selector} has no rule in design-system.css`);
    for (const m of rules) {
      for (const d of m[2].split(";")) {
        const at = d.indexOf(":");
        if (at > 0) out[d.slice(0, at).trim()] = d.slice(at + 1).trim();
      }
    }
  }
  return out;
}

type Rgba = { r: number; g: number; b: number; a: number };
const hex = (h: string): Rgba => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16), a: 1 });
const toHex = (c: Rgba) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** Split at the commas that are not inside parentheses. */
function args(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** A CSS colour value, resolved against the club's tokens. Throws on anything that is not a token. */
function resolve(value: string, vars: Record<string, string>, token = false): Rgba {
  const v = value.trim();
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  // A hex only as a token's own value: written straight into a rule it would not follow the theme.
  if (token && /^#[0-9a-f]{6}$/i.test(v)) return hex(v);
  const ref = /^var\((--color-[a-z0-9-]+)\)$/.exec(v);
  if (ref) {
    const t = vars[ref[1]];
    if (!t) throw new Error(`${ref[1]} is not a token the club's theme sets`);
    return resolve(t, vars, true);
  }
  const mix = /^color-mix\(in srgb,([\s\S]*)\)$/.exec(v);
  if (mix) {
    const [first, second] = args(mix[1]);
    const pct = /\s(\d+(?:\.\d+)?)%$/.exec(first);
    const p = pct ? Number(pct[1]) / 100 : 0.5;
    const a = resolve(pct ? first.slice(0, pct.index) : first, vars, token);
    const b = resolve(second, vars, token);
    // color-mix in srgb: premultiplied by alpha, then un-premultiplied.
    const alpha = a.a * p + b.a * (1 - p);
    if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const ch = (k: "r" | "g" | "b") => (a[k] * a.a * p + b[k] * b.a * (1 - p)) / alpha;
    return { r: ch("r"), g: ch("g"), b: ch("b"), a: alpha };
  }
  throw new Error(`not a --color-* token: ${v}`);
}

/** A translucent colour laid over an opaque one. */
const over = (top: Rgba, under: Rgba): Rgba => ({
  r: top.r * top.a + under.r * (1 - top.a),
  g: top.g * top.a + under.g * (1 - top.a),
  b: top.b * top.a + under.b * (1 - top.a),
  a: 1,
});

/** The ratio each mark's words reach on the worst ground under it, for one theme. */
function markContrast(css: string, selector: string, vars: Record<string, string>): { ratio: number; on: string } {
  const d = declarationsOf(css, selector);
  if (!d.background && !d.color) throw new Error(`${selector} has no rule in design-system.css`);
  // A mark that only changes its words sits on what its base rule draws (`.rt-hole[data-par]` on
  // `.rt-hole`'s own fill would be overridden by its own `background` when it has one).
  const fill = d.background ?? "transparent";
  const words = d.color ?? "var(--color-text)";
  let worst = { ratio: Infinity, on: "" };
  for (const ground of ["--color-bg", "--color-surface", "--color-surface-2"]) {
    const base = over(resolve(`var(${ground})`, vars), hex("#000000"));
    const chip = over(resolve(fill, vars), base);
    const text = over(resolve(words, vars), chip);
    const ratio = contrastRatio(toHex(text), toHex(chip));
    if (ratio < worst.ratio) worst = { ratio, on: ground };
  }
  return worst;
}

const SCHEMES: Array<{ pair: string; ground: Ground; floor: number }> = [
  { pair: "tournament", ground: DARK_GROUND, floor: SUNLIGHT_RATIO },
  { pair: "desert", ground: DARK_GROUND, floor: SUNLIGHT_RATIO },
  { pair: "championship", ground: LIGHT_GROUND, floor: 4.5 },
  { pair: "coastal", ground: LIGHT_GROUND, floor: 4.5 },
];

const themeOf = (key: string, ground: Ground): ClubTheme => {
  const p = THEME_PAIRS.find((t) => t.key === key)!;
  return { accentKey: p.accentKey, accentHex: "", secondaryKey: p.secondaryKey, secondaryHex: "", appearance: ground.key };
};

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
