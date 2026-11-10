import { DARK_GROUND, LIGHT_GROUND, SUNLIGHT_RATIO, THEME_PAIRS, contrastRatio, type ClubTheme, type Ground } from "@/lib/themes";

/**
 * WORDS ON A FILL, RESOLVED AGAINST THE CLUB'S REAL TOKENS — one copy, shared by every sheet that is
 * held to the sunlight bar: Rounds & formats' timeline (`rounds-timeline-contrast.test.ts`) and the
 * lifecycle stepper (`lifecycle-stepper.test.tsx`). Moved here verbatim from the timeline's test
 * (B03, 10 Nov) so the stepper did not grow a second copy of the arithmetic.
 *
 * Worked by a route the stylesheet does not take: plain sRGB arithmetic, the way `color-mix(in srgb, …)`
 * is defined, then WCAG's ratio (`contrastRatio`).
 */

/** Every declaration of the rules whose selector is exactly one of `mark`'s, in that order (later wins). */
export function declarationsOf(css: string, mark: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const selector of mark.split(" | ")) {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === selector);
    // A misspelt override would otherwise be measured as the shared rule and pass.
    if (rules.length === 0) throw new Error(`${selector} has no rule in design-system.css or rounds-timeline.css`);
    for (const m of rules) {
      for (const d of m[2].split(";")) {
        const at = d.indexOf(":");
        if (at > 0) out[d.slice(0, at).trim()] = d.slice(at + 1).trim();
      }
    }
  }
  return out;
}

export type Rgba = { r: number; g: number; b: number; a: number };
export const hex = (h: string): Rgba => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16), a: 1 });
export const toHex = (c: Rgba) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

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
export function resolve(value: string, vars: Record<string, string>, token = false): Rgba {
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
export const over = (top: Rgba, under: Rgba): Rgba => ({
  r: top.r * top.a + under.r * (1 - top.a),
  g: top.g * top.a + under.g * (1 - top.a),
  b: top.b * top.a + under.b * (1 - top.a),
  a: 1,
});

/** The ratio each mark's words reach on the worst ground under it, for one theme. */
export function markContrast(css: string, selector: string, vars: Record<string, string>): { ratio: number; on: string } {
  const d = declarationsOf(css, selector);
  if (!d.background && !d.color) throw new Error(`${selector} has no rule in design-system.css or rounds-timeline.css`);
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

export const SCHEMES: Array<{ pair: string; ground: Ground; floor: number }> = [
  { pair: "tournament", ground: DARK_GROUND, floor: SUNLIGHT_RATIO },
  { pair: "desert", ground: DARK_GROUND, floor: SUNLIGHT_RATIO },
  { pair: "championship", ground: LIGHT_GROUND, floor: 4.5 },
  { pair: "coastal", ground: LIGHT_GROUND, floor: 4.5 },
];

export const themeOf = (key: string, ground: Ground): ClubTheme => {
  const p = THEME_PAIRS.find((t) => t.key === key)!;
  return { accentKey: p.accentKey, accentHex: "", secondaryKey: p.secondaryKey, secondaryHex: "", appearance: ground.key };
};
