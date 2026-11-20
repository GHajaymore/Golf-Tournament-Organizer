import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { stripComments } from "./source";

/**
 * A BARE CAPTION IS TIED TO NO BOX (J51, 2026-11-06).
 *
 * `<label>Course name</label>` followed by a sibling `<input>` looks like a
 * labelled box and is not one: with no `htmlFor` and no control inside it, the
 * words name nothing. A screen reader lands on "edit text" with no name, and
 * tapping the words does not focus the box. `a-caption-does-not-press-its-info-button`
 * is the opposite fault (a label that holds only a button); this is a label that
 * holds nothing.
 *
 * A RATCHET, not a ban: `KNOWN_BARE_CAPTIONS` is today's set (the screens are
 * fixed in their own pull requests, not here), and it may only SHRINK. A caption
 * written tomorrow fails here; a caption fixed tomorrow fails here too until its
 * line is deleted, so the list cannot go on claiming a fault that is gone.
 *
 * Tied means ANY of: `htmlFor`, an `id` that an `aria-labelledby` in the same file names,
 * or a control (`input`, `select`, `textarea`) inside the label itself.
 */
const SRC = join(process.cwd(), "src");
const files = (d: string): string[] =>
  readdirSync(d).flatMap((e) => {
    const p = join(d, e);
    if (statSync(p).isDirectory()) return e === "__tests__" ? [] : files(p);
    return p.endsWith(".tsx") ? [p] : [];
  });

const LABEL = /<label\b([^>]*)>((?:(?!<\/label>)[\s\S])*?)<\/label>/g;

/** The `<label>`s in one file's code that name no box. Pure, so the control can feed it a string. */
export function bareCaptions(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(LABEL)) {
    const attrs = m[1];
    const body = m[2];
    if (/\bhtmlFor\b/.test(attrs)) continue;
    // An id only ties when something in the same file points at it; `data-id=` is not an id.
    const id = attrs.match(/(?<![\w-])id=(?:"([^"]+)"|\{([^}]+)\})/);
    if (id) {
      const quoted = id[1] !== undefined;
      const token = quoted ? id[1] : id[2].trim();
      if (code.includes(quoted ? `aria-labelledby="${token}"` : `aria-labelledby={${token}`)) continue;
    }
    if (/<input\b|<select\b|<textarea\b/.test(body)) continue;
    // The words only: tags dropped, each {expression} shown as an ellipsis, so a key is stable
    // under a restyle and readable in a diff.
    let words = body.replace(/<[^>]*>/g, " ");
    for (let i = 0; i < 4; i++) words = words.replace(/\{[^{}]*\}/g, "…");
    out.push(words.replace(/\s+/g, " ").trim().slice(0, 50));
  }
  return out;
}

function swept(): string[] {
  const keys: string[] = [];
  for (const f of files(SRC)) {
    const rel = relative(SRC, f).split(sep).join("/");
    const seen = new Map<string, number>();
    for (const text of bareCaptions(stripComments(readFileSync(f, "utf8")))) {
      const n = (seen.get(text) ?? 0) + 1;
      seen.set(text, n);
      keys.push(`${rel} :: ${text}${n > 1 ? ` #${n}` : ""}`);
    }
  }
  return keys.sort();
}

/**
 * Today's set: EMPTY (all 56 were tied, 2026-11-10). Never add a line; tie the caption instead
 * (`htmlFor` + `id`, or a `span.field-caption` naming a `role="group"` with `aria-labelledby`).
 */
const KNOWN_BARE_CAPTIONS: string[] = [];

describe("a caption names its box", () => {
  it("no caption is added to the set that is tied to nothing", () => {
    const known = new Set(KNOWN_BARE_CAPTIONS);
    const added = swept().filter((k) => !known.has(k));
    expect(added, `new bare captions (tie each with htmlFor + id):\n${added.join("\n")}`).toEqual([]);
  });

  it("the set only shrinks: a caption that has been tied is struck off the list", () => {
    const now = new Set(swept());
    const gone = KNOWN_BARE_CAPTIONS.filter((k) => !now.has(k));
    expect(gone, `tied now, delete from KNOWN_BARE_CAPTIONS:\n${gone.join("\n")}`).toEqual([]);
  });

  it("CONTROL: the sweep sees a bare caption, and not a tied one", () => {
    const bare = '<div className="field"><label>Course name</label><input className="input" /></div>';
    expect(bareCaptions(bare)).toEqual(["Course name"]);
    expect(bareCaptions('<label htmlFor="n">Course name</label><input id="n" />')).toEqual([]);
    expect(bareCaptions('<label>Course name <input className="input" /></label>')).toEqual([]);
    expect(bareCaptions('<label id="cap">Holes</label><div role="radiogroup" aria-labelledby="cap" />')).toEqual([]);
    // An id nothing points at ties nothing, and data-id is not an id.
    expect(bareCaptions('<label id="cap">Holes</label><div />')).toEqual(["Holes"]);
    expect(bareCaptions('<label data-id="cap">Holes</label><div aria-labelledby="cap" />')).toEqual(["Holes"]);
  });

  it("CONTROL: the sweep reads files at all (a sweep of nothing reports nothing)", () => {
    // The set is empty now, so a clean sweep is the right answer and cannot prove the sweep can see;
    // the file count and the string controls above do (a bare caption in a string is found).
    expect(files(SRC).length).toBeGreaterThan(100);
    expect(Array.isArray(swept())).toBe(true);
  });
});
