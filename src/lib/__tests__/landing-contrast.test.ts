import { describe, it, expect } from "vitest";
import { contrastRatio } from "@/lib/themes";
import { readSource } from "./source";

/**
 * The marketing page's own palette clears the same contrast floor the app's
 * themes do.
 *
 * `themes.test.ts` proves every accent and neutral ramp on both grounds, and
 * the landing page is not in it: `LANDING_CSS` carries a SEPARATE set of
 * tokens, hand-written, with its own dark and light values. So the one page
 * every visitor sees first was the one surface with no contrast test at all,
 * and it had failures on both grounds.
 *
 * Lighthouse found `--ink-faint` at 4.29:1 on the dark ground, in the footer
 * at 12.5px. It could not find the LIGHT one, because it grades whichever
 * ground the page renders in and it rendered dark — that value sat at about
 * 4.0:1, worse than the one that was reported.
 *
 * That is the reason this is a test and not a one-line colour change: an
 * audit run in one appearance says nothing about the other, and this palette
 * has two.
 *
 * Tokens are read out of the source rather than duplicated here, so a retune
 * is graded automatically. Reading through `readSource` matters as much as
 * usual — the block above `--ink-faint` discusses colours and hex values, and
 * a naive scan would pick words out of the prose.
 */

const CSS = readSource("src/app/page.tsx");

/**
 * The palette is declared twice: once for the dark ground, then again inside
 * `@media (prefers-color-scheme: light)`. Splitting on that boundary and
 * taking the LAST declaration on each side is exactly how the cascade resolves
 * it, so the values here are the values that render.
 */
const LIGHT_AT = CSS.indexOf("@media (prefers-color-scheme: light)");

function token(name: string, ground: "dark" | "light"): string {
  const region = ground === "dark" ? CSS.slice(0, LIGHT_AT) : CSS;
  const matches = [...region.matchAll(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})`, "g"))];
  const last = matches.at(-1);
  if (!last) throw new Error(`no --${name} declared for the ${ground} ground`);
  return last[1];
}

/** Text tokens, and the token each one is read against. */
const TEXT: Array<[string, string]> = [
  ["ink", "ground"],
  ["ink-soft", "ground"],
  ["ink-faint", "ground"],
  ["brass", "ground"],
  ["under", "ground"],
  ["paper-ink", "paper"],
  ["paper-soft", "paper"],
  ["paper-accent", "paper"],
];

/** WCAG AA for body text. The footer meta that failed is 12.5px, so AA applies. */
const FLOOR = 4.5;

describe("the landing palette can be read", () => {
  it("found the palette at all", () => {
    // A regex that matched nothing would make every assertion below vacuous.
    expect(LIGHT_AT).toBeGreaterThan(0);
    expect(token("ground", "dark")).not.toBe(token("ground", "light"));
    expect(token("ink", "dark")).not.toBe(token("ink", "light"));
  });

  for (const ground of ["dark", "light"] as const) {
    for (const [name, against] of TEXT) {
      it(`${ground}: --${name} clears ${FLOOR}:1 on --${against}`, () => {
        const fg = token(name, ground);
        const bg = token(against, ground);
        const ratio = contrastRatio(fg, bg);
        expect(
          Number(ratio.toFixed(2)),
          `--${name} ${fg} on --${against} ${bg} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(FLOOR);
      });
    }
  }
});

describe("decoration stays decoration", () => {
  /**
   * `--incised` is documented in the source as DECORATION ONLY — it may rule a
   * line or edge a frame and must never carry a word.
   *
   * The first version of this asserted a 3:1 floor on it and failed at 1.71:1
   * on the light ground. That was the TEST being wrong, not the colour: the
   * token is declared on both grounds and referenced by no rule anywhere, so
   * there is nothing rendering at 1.71:1 to be a defect. Grading an unused
   * value against a floor invents a failure and then invites somebody to
   * "fix" a colour that draws nothing.
   *
   * So assert the rule the source actually states, which stays meaningful
   * whether or not the token is ever used: it must not become a text colour.
   * If someone wires it to `color:` later, the contrast floor above is the one
   * it would have to meet — and this fails first, pointing at why.
   */
  it("is never used as a text colour", () => {
    expect(CSS, "--incised now carries text; it is a ~1.7:1 line colour").not.toMatch(
      /color\s*:\s*var\(\s*--incised/,
    );
  });
});
