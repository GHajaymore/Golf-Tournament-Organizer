import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./source";

/**
 * A `.card` laid out as a ROW must say so.
 *
 * `design-system.css` opens the card with `display: flex; flex-direction:
 * column`. So an element that carries `className="card"` and then sets
 * `display: "flex"` inline has changed NOTHING — it has set the display the
 * card already had, and the column survives. The row it meant to build comes
 * out as a centred stack.
 *
 * That is the whole failure, and it is invisible to every other check. The
 * markup is valid, the styles are valid, tsc and the build are silent, and the
 * screen renders — just in the wrong direction. The tells in the source are
 * the give-away that nobody reads: `justifyContent: "space-between"`
 * distributing children vertically, `marginLeft: "auto"` doing nothing at all,
 * and `textAlign: "left"` quietly overruled by `alignItems: "center"`.
 *
 * Four sites had it on 2026-09-08, and they were not obscure:
 *
 *   - the tournament button on `/choose` — every row of the FIRST screen a
 *     returning organizer sees, 107px tall where a list row wanted 70
 *   - the "Playing a match?" link beside it, 176px tall against 114
 *   - the same link newly added to `/event`
 *   - every rule link on the player's `/me/rules`
 *
 * Measured in the browser, not inferred: `getComputedStyle(el).flexDirection`
 * read "column" on all of them.
 *
 * So the rule is structural. Declaring the direction costs one line and is
 * checkable; remembering that `.card` is a column is neither. CLAUDE.md: a
 * guard you must remember to call is a guard that will be forgotten.
 */

const root = process.cwd();
const read = (p: string) => stripComments(readFileSync(join(root, p), "utf8"));

/** Every .tsx under src, so a new file is swept the day it is added. */
function allTsx(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) allTsx(rel, out);
    else if (e.name.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

/**
 * Opening tags carrying the real `card` class — not `card-meta`, `card-title`
 * or any other `card-` prefixed class, which are ordinary elements with their
 * own layout and nothing to do with this rule.
 */
const TAG = /<(\w+)\s[^>]*?className=\{?["`]([^"`]*)["`][\s\S]{0,700}?>/g;
const IS_CARD = /(^|\s)card(\s|$)/;

describe("a card laid out as a row declares its direction", () => {
  const files = allTsx("src");

  it("sweeps a plausible number of files", () => {
    // An empty or tiny sweep passes everything below without looking at it,
    // which is the failure mode of every filesystem-driven test.
    expect(files.length).toBeGreaterThan(100);
  });

  it("finds the card class is still a column, or this rule is moot", () => {
    /**
     * The premise, asserted rather than assumed. If somebody makes `.card` a
     * row — or drops the flex — every expectation below is about a problem
     * that no longer exists, and this test should be reconsidered rather than
     * left standing as decoration.
     */
    // Comments stripped, like every other assertion here: the prose above the
    // rule describes the rule, so a raw read would go on passing after the
    // declaration it pins had gone. `.card` has exactly such a comment in it.
    const css = read("src/app/design-system.css");
    const rule = css.slice(css.indexOf("\n.card {"), css.indexOf("\n.card-kicker"));
    expect(rule).toMatch(/display:\s*flex/);
    expect(rule).toMatch(/flex-direction:\s*column/);
  });

  it("has no card that sets display:flex inline without a direction", () => {
    const offenders: string[] = [];

    for (const f of files) {
      const src = read(f);
      TAG.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TAG.exec(src)) !== null) {
        if (!IS_CARD.test(m[2])) continue;
        const tag = m[0];
        if (!/display:\s*["']flex["']/.test(tag)) continue;
        if (/flexDirection/.test(tag)) continue;
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${f}:${line} <${m[1]}>`);
      }
    }

    expect(
      offenders,
      "these carry .card and set display:flex inline without saying which direction — " +
        "so they inherit the card's COLUMN and render as a centred stack",
    ).toEqual([]);
  });
});
