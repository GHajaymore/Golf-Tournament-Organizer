import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./source";
import { themeVarsFor, DEFAULT_CLUB_THEME, LIGHT_GROUND } from "../themes";

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
    const themed = new Set(Object.keys(themeVarsFor(DEFAULT_CLUB_THEME, LIGHT_GROUND)));

    const frozen = [...REFERENCED.keys()]
      .filter((name) => !themed.has(name) && !DECK_ONLY.includes(name))
      .sort()
      .map((name) => `${name} (${REFERENCED.get(name)!.slice(0, 3).join(", ")})`);

    expect(frozen, `never emitted by themeVarsFor:\n  ${frozen.join("\n  ")}`).toEqual([]);
  });
});

/**
 * WHAT IS DELIBERATELY NOT ASSERTED HERE, and why it is written down rather
 * than left out silently.
 *
 * The obvious companion rule is "no `var(--color-x, fallback)` at all" —
 * `brand-consistency.test.ts` already says so for `--color-danger`, on the
 * grounds that a fallback on a token that exists is a second source of truth.
 * Swept across `src` it reports ELEVEN, and they are not one class: three sit
 * on `--color-on-accent` in the stylesheet, four are in `Logo.tsx`, which is
 * artwork that renders in places no stylesheet reaches, and two are inside
 * `brand-consistency.test.ts` itself, quoting the component it checks.
 *
 * Deciding each of those is a separate pass with its own reading. Writing a
 * register of reasons tonight would mean inventing reasons for cases nobody
 * has looked at, which is worse than the gap.
 *
 * The rule above does not depend on it: a phantom token is caught whether or
 * not it carries a fallback, because what is checked is the DECLARATION.
 */
