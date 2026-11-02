import { describe, it, expect } from "vitest";
import { nextPage, pageHeight, pageStarts, pageWords, type Atom } from "../clubhouse-pages";

/**
 * Where the clubhouse screen breaks a long board into pages (2026-10-24). The
 * browser half — a long field paging on a 1280x720 screen, the page changing
 * on its own — is `e2e/clubhouse-and-event-page.spec.ts`.
 */

/** `n` rows of `h` pixels, one under the other from `from`. */
const rows = (n: number, h: number, from = 0): Atom[] =>
  Array.from({ length: n }, (_, i) => ({ top: from + i * h, bottom: from + (i + 1) * h }));

/** Every row is shown whole on some page: it starts at or after a page's top and ends by its bottom. */
function everyRowWhole(atoms: Atom[], starts: number[], view: number) {
  for (const a of atoms) {
    const page = starts.some((s) => a.top >= s - 0.01 && a.bottom <= s + view + 0.01);
    expect(page, `row ${a.top}-${a.bottom} is cut on every page (${starts.join(", ")})`).toBe(true);
  }
}

describe("a board that fits", () => {
  it("is one page", () => {
    expect(pageStarts(rows(5, 60), 400, 300)).toEqual([0]);
    expect(pageStarts(rows(5, 60), 300, 300)).toEqual([0]);
  });

  it("is one page when nothing has been measured yet", () => {
    expect(pageStarts([], 0, 0)).toEqual([0]);
    expect(pageStarts([], 500, 0)).toEqual([0]);
  });
});

describe("a long board", () => {
  it("breaks between rows, never through one", () => {
    // Rows of 70 on a 500 screen: 7 whole rows (490) fit, the 8th (490-560) would be cut.
    const atoms = rows(20, 70);
    const starts = pageStarts(atoms, 500, 1400);
    expect(starts.slice(0, 3)).toEqual([0, 490, 980]);
    everyRowWhole(atoms, starts, 500);
    // CONTROL: breaking at the screen's height instead cuts a row in half.
    expect(() => everyRowWhole(atoms, [0, 500, 1000], 500)).toThrow();
  });

  it("breaks on the innermost row a section holds, not on the section", () => {
    // A heading, then a section (an outer list item) holding twelve rows.
    const heading: Atom = { top: 0, bottom: 40 };
    const section: Atom = { top: 40, bottom: 40 + 12 * 50 };
    const inner = rows(12, 50, 40);
    const starts = pageStarts([heading, section, ...inner], 300, 640);
    // The first page holds the heading and five rows (to 290); the 6th starts at 290.
    expect(starts[1]).toBe(290);
    everyRowWhole(inner, starts, 300);
  });

  it("ends the page at the screen's edge where the edge falls between rows", () => {
    const atoms = [{ top: 0, bottom: 100 }, { top: 300, bottom: 400 }];
    expect(pageStarts(atoms, 200, 400)).toEqual([0, 200]);
  });

  it("always moves forward, even past a row taller than the screen", () => {
    const starts = pageStarts([{ top: 0, bottom: 2000 }], 500, 2000);
    expect(starts).toEqual([0, 500, 1000, 1500]);
    for (let i = 1; i < starts.length; i += 1) expect(starts[i]).toBeGreaterThan(starts[i - 1]);
  });

  it("reaches the bottom: the last page shows the last row", () => {
    const atoms = rows(33, 64);
    const total = 33 * 64;
    const starts = pageStarts(atoms, 600, total);
    expect(starts[starts.length - 1] + 600).toBeGreaterThanOrEqual(total);
    everyRowWhole(atoms, starts, 600);
  });
});

describe("how much of the screen a page shows", () => {
  it("ends where the next page starts, so its last row is not half-shown; the last page shows it all", () => {
    const starts = pageStarts(rows(20, 70), 500, 1400); // [0, 490, 980]
    expect(pageHeight(starts, 0, 500)).toBe(490);
    expect(pageHeight(starts, 1, 500)).toBe(490);
    expect(pageHeight(starts, 2, 500)).toBe(500);
    // Past the end, the last page.
    expect(pageHeight(starts, 9, 500)).toBe(500);
    expect(pageHeight([0], 0, 500)).toBe(500);
  });
});

describe("turning the pages", () => {
  it("goes on to the next, and back to the first after the last", () => {
    expect(nextPage(0, 3)).toBe(1);
    expect(nextPage(1, 3)).toBe(2);
    expect(nextPage(2, 3)).toBe(0);
    expect(nextPage(0, 1)).toBe(0);
  });

  it("says which page is up only when there is more than one", () => {
    expect(pageWords(1, 3)).toBe("Page 2 of 3");
    expect(pageWords(0, 1)).toBe("");
    // A board that shrank under a page that no longer exists says the last one.
    expect(pageWords(5, 3)).toBe("Page 3 of 3");
  });
});
