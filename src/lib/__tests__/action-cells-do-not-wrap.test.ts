import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * A ROW'S CONTROLS STAY ON THE ROW'S LINE.
 *
 * The last cell of a table row is where this app puts its actions — Edit,
 * Remove, Verify card. They are inline-flex buttons, so when the column is
 * narrower than they are the browser does the only thing it can and breaks
 * the line, stacking the second control under the first.
 *
 * NOTHING ABOUT THAT LOOKS BROKEN TO ANY OTHER CHECK. It renders, it is
 * clickable, the screen returns 200, and every one of 5,599 unit tests passes.
 * What it does is double the height of every row in the table and stop the
 * controls lining up with the data they act on — reported on 2026-09-14 from a
 * screenshot of the tee table, where six sets of tees stood 510px tall in a
 * column of stacked icons instead of 306px of rows.
 *
 * It was ONE cell of six. `TeeEditor` gave its action column `width: 70`,
 * which is less than the two 34px buttons in it before the 24px of cell
 * padding is counted. The other five had already been written with
 * `whiteSpace: "nowrap"` — including `CourseLibrary`, which sits directly
 * above the tee table on the same screen and looked right while this looked
 * broken.
 *
 * So the rule was already the app's, in five places, and unwritten. This is
 * the sweep that closes it: every action cell, not the one that was reported.
 *
 * WHY `nowrap` RATHER THAN A WIDTH. A width is a guess that goes stale the
 * moment a control is added, and the failure is silent when it does. `nowrap`
 * cannot go stale — the cell takes the width its contents need, and the table
 * is inside a `table-scroll` wrapper precisely so a wide one scrolls rather
 * than pushing the page sideways.
 */

/** Every `<td>…</td>` in a file, crudely but honestly: split on the tag. */
function cellsIn(src: string): string[] {
  const out: string[] = [];
  const parts = src.split("<td");
  for (let i = 1; i < parts.length; i++) {
    const end = parts[i].indexOf("</td>");
    if (end < 0) continue;
    out.push("<td" + parts[i].slice(0, end));
  }
  return out;
}

/**
 * How many things a person can press in it.
 *
 * `ConfirmButton` counts, and counts as one: its resting state is a single
 * icon. Its ARMED state is two labelled buttons and a note, which is the case
 * that makes a fixed width hopeless and `nowrap` the right answer.
 */
function controlsIn(cell: string): number {
  return cell.split("<button").length - 1 + (cell.split("<ConfirmButton").length - 1);
}

/** What keeps them on one line. Either spelling of the same intent. */
function holdsTheLine(cell: string): boolean {
  return cell.includes("nowrap") || cell.includes('display: "flex"') || cell.includes('display:"flex"');
}

function componentFiles(): string[] {
  const dir = join("src", "components");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => join(dir, f));
}

/**
 * Read through `readSource`, which strips comments — and here that is not a
 * formality. The comment this fix left in `TeeEditor` contains the words
 * `whiteSpace: "nowrap"`, so a raw read would find the sentence describing the
 * rule and call the rule satisfied. That is the exact failure `source.ts` was
 * written for, and this file would have walked into it.
 */
const cells = componentFiles().flatMap((f) =>
  cellsIn(readSource(f)).map((cell) => ({ file: f.replace(/\\/g, "/"), cell })),
);
const multi = cells.filter((c) => controlsIn(c.cell) >= 2);

describe("a table row's action cell keeps its controls on one line", () => {
  it("finds the cells that have more than one control — the sweep's own control", () => {
    /**
     * Without this, a changed component name or a different way of writing a
     * button makes "every action cell is fine" true and empty. Six on
     * 2026-09-14; the floor is set below that so adding one does not turn this
     * red, and well above zero so an instrument that has stopped matching
     * does.
     */
    expect(multi.length, "found no multi-control table cells — the sweep is broken").toBeGreaterThan(
      3,
    );
  });

  it.each(multi.map((c) => c.file))("%s keeps them on the line", (file) => {
    const wrapping = multi.filter((c) => c.file === file && !holdsTheLine(c.cell));
    expect(
      wrapping.length,
      `an action cell here can wrap: its controls will stack and double the row's height. ` +
        `Give the cell whiteSpace: "nowrap", as CourseLibrary and four others do.`,
    ).toBe(0);
  });
});
