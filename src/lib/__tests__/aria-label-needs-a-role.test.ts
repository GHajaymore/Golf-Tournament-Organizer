import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * AN ARIA-LABEL ON A ROLE-LESS ELEMENT IS SILENT (Lighthouse on the player's
 * Today screen, 2026-10-01).
 *
 * A <div>, <span> or <p> with no role is "generic", and ARIA prohibits naming
 * one, so screen readers ignore its aria-label. The scoreboard put each row's
 * whole sentence ("Position 1, COLQUHOUN, thru 9, −6") there and hid every tile
 * beneath it, so the leaders board read as empty rows. Give the element a role,
 * or put the words in a `.sr-only` span.
 *
 * Checks each opening tag up to its first ">", so a tag holding an arrow
 * function can slip through (a miss, never a false alarm).
 */

const ROOTS = [join("src", "app"), join("src", "components")];
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [],
  );

/** Opening <div|span|p …> tags, up to the first ">". */
const OPEN = /<(div|span|p)\b[^>]*>/g;

export function silentLabels(src: string): string[] {
  return [...src.matchAll(OPEN)].map((m) => m[0]).filter((tag) => /\saria-label=/.test(tag) && !/\srole=/.test(tag));
}

describe("an aria-label is only put where a screen reader reads it", () => {
  it("no role-less div, span or p carries an aria-label", () => {
    const offenders = ROOTS.flatMap(files).flatMap((f) => silentLabels(readSource(f)).map((t) => `${f}: ${t.slice(0, 90)}`));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("CONTROL: catches the shape it is for, and passes a labelled role", () => {
    expect(silentLabels('<div className="sb-row" aria-label={`Position ${p}`}>')).toHaveLength(1);
    expect(silentLabels('<span className="x" aria-label="no change">')).toHaveLength(1);
    expect(silentLabels('<div role="group" aria-label="Formats">')).toHaveLength(0);
    expect(silentLabels('<section aria-label="Leaders">')).toHaveLength(0);
  });
});
