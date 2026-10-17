import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { stripComments } from "./source";

/**
 * A CAPTION DOES NOT PRESS ITS INFO BUTTON (2026-10-16).
 *
 * A `<label>` with no `for` labels its first labelable descendant. Fifteen
 * captions across eleven files held the words and an ⓘ (`FieldInfo`, a
 * `<button>`) and no control — so the ⓘ was what they labelled, and tapping the
 * word "Format", "Handicap" or "Currency" opened the help instead of doing
 * nothing. Found by the UI/UX designer on the review panel. They are
 * `<span className="field-caption">` now, styled the same.
 *
 * Swept from the filesystem, so a sixteenth fails here the day it is written.
 */
const SRC = join(process.cwd(), "src");
const files = (d: string): string[] =>
  readdirSync(d).flatMap((e) => {
    const p = join(d, e);
    if (statSync(p).isDirectory()) return e === "__tests__" ? [] : files(p);
    return p.endsWith(".tsx") ? [p] : [];
  });

const LABEL = /<label(?![^>]*htmlFor)[^>]*>((?:(?!<\/label>)[\s\S])*?)<\/label>/g;
const pressesItsButton = (body: string) => /<FieldInfo|<button/.test(body) && !/<input|<select|<textarea/.test(body);

describe("a caption with an info button", () => {
  it("is never a <label> that would label the button", () => {
    const offenders: string[] = [];
    for (const f of files(SRC)) {
      const src = stripComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(LABEL)) {
        if (pressesItsButton(m[1])) offenders.push(relative(SRC, f).split(sep).join("/"));
      }
    }
    expect(offenders, offenders.join(", ")).toEqual([]);
  });

  it("CONTROL: the pattern sees the shape it banned, and not a label that holds its control", () => {
    const bad = '<label style={{ display: "flex" }}>\n  Currency\n  <FieldInfo label="the currency">x</FieldInfo>\n</label>';
    const fine = '<label style={{ display: "flex" }}>\n  <input type="checkbox" /> Voice entry <FieldInfo label="voice">x</FieldInfo>\n</label>';
    expect([...bad.matchAll(LABEL)].some((m) => pressesItsButton(m[1]))).toBe(true);
    expect([...fine.matchAll(LABEL)].some((m) => pressesItsButton(m[1]))).toBe(false);
  });
});
