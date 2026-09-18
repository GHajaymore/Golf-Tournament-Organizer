import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./source";
import { themeVarsFor, themeCss, DEFAULT_CLUB_THEME, LIGHT_GROUND, DARK_GROUND } from "../themes";

/**
 * EVERY `var(--color-*)` NAMES A TOKEN THAT EXISTS.
 *
 * This repository has already had this bug once and pinned the instance rather
 * than the class. `brand-consistency.test.ts` records it: `--color-danger` went
 * undeclared while nineteen components wrote `var(--color-danger, #e0665a)`,
 * so the FALLBACK was what rendered and error red was the one colour a club
 * could never change. The fix declared the token and added a test — which
 * matches the literal string `var(--color-danger,` and therefore protects
 * exactly one name.
 *
 * Five more were sitting there. Found on 2026-09-18 by rendering the light
 * ground for the first time and measuring contrast, which caught `/week`
 * printing `#888` — the fallback of a token nothing declared:
 *
 *   --color-text-muted   8 sites   --color-warning     4 sites
 *   --color-surface-2    8 sites   --color-border      3 sites
 *   --color-danger-300   1 site
 *
 * A PHANTOM TOKEN FAILS IN ONE OF TWO WAYS, and neither announces itself:
 *
 *   - WITH a fallback, the fallback renders. That is a hard-coded literal
 *     which ignores the club's palette and does not reverse between grounds —
 *     `#888` measured 3.51:1 on the light ground, under the floor, on a table
 *     of scores.
 *   - WITHOUT one, the declaration is INVALID and the property is dropped.
 *     `color` then inherits, so the tournament journey painted a "todo" step
 *     in exactly the colour of a done one; `background` falls away entirely,
 *     so a received message had no bubble while your own did.
 *
 * The second is the quieter one. Nothing is missing from the screen, nothing
 * is the wrong colour on purpose, and every test in the suite passes — the
 * markup is right and the paint is absent.
 */

const root = process.cwd();

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) sourceFiles(rel, out);
    else if (/\.(tsx?|css)$/.test(e.name)) out.push(rel);
  }
  return out;
}

/** Comments stripped, so prose describing a token never stands in for one. */
const read = (p: string) => stripComments(readFileSync(join(root, p), "utf8"));

const FILES = sourceFiles("src");

/**
 * The name at a `--color-` occurrence, or null where it is interpolated.
 *
 * `split`/`indexOf` rather than a pattern with escapes in it: CLAUDE.md
 * records three sweeps disarmed by a shell eating `\b` and `\s`, one of which
 * shipped into a test file as literal control bytes and asserted nothing while
 * staying green.
 *
 * A name ending in `-` is the start of a template literal — `--color-accent-`
 * followed by `${step}` — and cannot be checked without evaluating it, so it
 * is reported as unknown rather than guessed at.
 */
function nameAt(rest: string): string | null {
  let i = 0;
  while (i < rest.length && /[a-z0-9-]/i.test(rest[i])) i += 1;
  const name = `--color-${rest.slice(0, i)}`;
  return name.endsWith("-") ? null : name;
}

/** Every token DECLARED anywhere: `--color-x:` in CSS, `"--color-x":` in TS. */
function declared(): Set<string> {
  const out = new Set<string>();

  // The ramps themes.ts builds by interpolation, which no static read can see.
  for (const step of [100, 200, 300, 400, 500, 600, 700, 800, 900]) {
    out.add(`--color-accent-${step}`);
    out.add(`--color-accent-2-${step}`);
    out.add(`--color-neutral-${step}`);
  }

  for (const f of FILES) {
    for (const part of read(f).split("--color-").slice(1)) {
      const name = nameAt(part);
      if (!name) continue;
      const after = part.slice(name.length - "--color-".length).trimStart();
      // `--color-x:` in a stylesheet, or `"--color-x":` as an object key.
      if (after.startsWith(":") || after.startsWith('":')) out.add(name);
    }
  }
  return out;
}

/** Every token REFERENCED through `var(...)`, and where. */
function referenced(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of FILES) {
    read(f)
      .split("\n")
      .forEach((line, i) => {
        for (const part of line.split("var(--color-").slice(1)) {
          const name = nameAt(part);
          if (!name) continue;
          if (!out.has(name)) out.set(name, []);
          out.get(name)!.push(`${f}:${i + 1}`);
        }
      });
  }
  return out;
}

describe("every colour token a component names is declared somewhere", () => {
  const DECLARED = declared();
  const REFERENCED = referenced();

  it("finds the tokens and the references at all", () => {
    /**
     * The control, because a sweep that finds nothing may simply be broken —
     * and this one reports a clean app either way. Three sweeps shipped that
     * way in this repository before controls became the habit.
     *
     * Both halves are checked: a known-declared token must be in the declared
     * set, a known-referenced one in the references, and an invented name in
     * neither. If the file walk or the split ever stops working, one of these
     * goes red instead of the suite going quietly green.
     */
    expect(FILES.length, "the file walk found nothing").toBeGreaterThan(300);
    expect(DECLARED.has("--color-text"), "a token that certainly exists").toBe(true);
    expect(DECLARED.has("--color-accent-500"), "an interpolated ramp step").toBe(true);
    expect(REFERENCED.has("--color-accent"), "a token that is certainly used").toBe(true);
    expect(DECLARED.has("--color-zz-invented"), "an invented name is not declared").toBe(false);
    expect(REFERENCED.size, "no references found at all").toBeGreaterThan(10);
  });

  it("has no reference to a token nothing declares", () => {
    const phantom = [...REFERENCED.keys()]
      .filter((name) => !DECLARED.has(name))
      .sort()
      .map((name) => `${name} (${REFERENCED.get(name)!.join(", ")})`);

    expect(phantom, `referenced but never declared:\n  ${phantom.join("\n  ")}`).toEqual([]);
  });

  it("themes every token it names, rather than freezing it as a default", () => {
    /**
     * THE RULE ABOVE IS SATISFIED BY THE WRONG FILE, which a mutation found
     * rather than a reading: deleting `--color-warning` from `themeVarsFor`
     * left this suite GREEN, because globals.css still declares it statically.
     *
     * That is not a pedantic gap. A token declared only as a static default is
     * frozen on the DARK ground — globals.css holds one set of values — so it
     * survives onto the light ground unchanged and paints a dark-ground colour
     * on a light card. It also stops following the club's palette. Those are
     * the two properties the token system exists to provide, and a
     * phantom-token check on its own does not notice their absence.
     *
     * So the static declarations are the fallback and `themeVarsFor` is the
     * source: anything a component names has to come out of it.
     *
     * The deck's section fills are the exception, excluded by name. They are
     * slide-scale artwork that deliberately does not move with a club's theme,
     * which is what `design-system.css` says where it declares them.
     */
    const DECK_ONLY = ["--color-section", "--color-section-glow", "--color-section-ghost"];
    /**
     * WHAT THE STYLESHEET ACTUALLY SAYS, not what `themeVarsFor` returns.
     *
     * This read the keys of `themeVarsFor` and so passed while
     * `--color-surface-2` never reached a page: `themeCss` runs every value
     * through a safety pattern that did not recognise its shape and dropped
     * it without a word. Found by LOOKING at the rebuilt Today screen — the
     * group avatars were dark circles on a light page. The sink is the
     * stylesheet, so the check reads the stylesheet, on both grounds.
     */
    const css = [DARK_GROUND, LIGHT_GROUND]
      .map((g) => themeCss({ ...DEFAULT_CLUB_THEME, appearance: g.key }, "#x"))
      .join("\n");
    const themed = new Set(
      Object.keys(themeVarsFor(DEFAULT_CLUB_THEME, LIGHT_GROUND)).filter((k) =>
        [DARK_GROUND, LIGHT_GROUND].every((g) =>
          themeCss({ ...DEFAULT_CLUB_THEME, appearance: g.key }, "#x").includes(`${k}:`),
        ),
      ),
    );
    expect(css.length, "themeCss wrote nothing — the check would pass vacuously").toBeGreaterThan(200);

    const frozen = [...REFERENCED.keys()]
      .filter((name) => !themed.has(name) && !DECK_ONLY.includes(name))
      .sort()
      .map((name) => `${name} (${REFERENCED.get(name)!.slice(0, 3).join(", ")})`);

    expect(frozen, `never emitted by themeVarsFor:\n  ${frozen.join("\n  ")}`).toEqual([]);
  });
});

/**
 * NO FALLBACK ON A COLOUR TOKEN, with one exemption that has been looked at.
 *
 * `brand-consistency.test.ts` says this for `--color-danger` alone: a fallback
 * on a token that exists is a second source of truth nobody would update. This
 * was deferred from #464 because the sweep reported eleven and they were not
 * one class. Each was then read, and they came out three ways:
 *
 *   design-system.css x3   `var(--color-on-accent, #16181a)`, so the primary
 *                          button read on the marketing pages, which sit
 *                          outside the club theme. A default at :root does
 *                          that for every page — the --color-danger fix again.
 *   RegisterClient         `var(--color-accent-2-300, var(--color-accent))` —
 *                          a fallback for a ramp step that always exists. Dead.
 *   PlayClient             `var(--color-accent-100, #fff)` as the label of the
 *                          SELECTED Me / ½ / Opp button on the casual-round
 *                          scorer. The fallback never ran; the token it named
 *                          was the wrong one. Step 100 on a filled accent
 *                          measures 1.25:1 at worst on the dark ground, and
 *                          `--color-on-accent`, solved for exactly this, 4.50.
 *
 * That third one is the argument for the rule. A fallback reads as caution,
 * and it made the line look deliberate enough that nobody asked which token
 * was the right one.
 *
 * THE EXEMPTION is `Logo.tsx`, and it is the only one. The mark is also drawn
 * by the Open Graph images through Satori, which has no stylesheet — see the
 * note in themes.ts — and `opengraph-image.tsx` passes no `cup` colour, so the
 * `currentColor` at the end of that chain is the only thing a share card gets.
 * Test files are excluded because they QUOTE component source; they declare
 * nothing and render nothing.
 */
describe("no colour token carries a fallback", () => {
  const EXEMPT: Record<string, string> = {
    "src/components/Logo.tsx": "also drawn by Satori for share cards, which cannot read custom properties",
  };

  function fallbacks(): string[] {
    const out: string[] = [];
    for (const f of FILES) {
      if (f.includes("/__tests__/") || EXEMPT[f]) continue;
      read(f)
        .split("\n")
        .forEach((line, i) => {
          for (const part of line.split("var(--color-").slice(1)) {
            const name = nameAt(part);
            if (!name) continue;
            const after = part.slice(name.length - "--color-".length).trimStart();
            if (after.startsWith(",")) out.push(`${name} at ${f}:${i + 1}`);
          }
        });
    }
    return out;
  }

  it("finds a fallback when there is one", () => {
    // The control: the exempt file really does carry them, so a sweep that
    // cannot see a fallback cannot hide behind the exemption.
    const logo = read("src/components/Logo.tsx");
    expect(logo.split("var(--color-").slice(1).some((p) => {
      const name = nameAt(p);
      return name !== null && p.slice(name.length - "--color-".length).trimStart().startsWith(",");
    }), "the fallback detector sees nothing even in Logo.tsx").toBe(true);
  });

  it("has none outside the exemption", () => {
    const found = fallbacks();
    expect(found, `colour tokens given a fallback:\n  ${found.join("\n  ")}`).toEqual([]);
  });

  it("keeps the exemption list to files that exist", () => {
    for (const f of Object.keys(EXEMPT)) expect(FILES, `${f} is exempt but gone`).toContain(f);
  });
});
