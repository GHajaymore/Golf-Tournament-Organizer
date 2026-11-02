import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BracketPrint, printPages } from "@/components/BracketPrint";
import { buildBracket, type BracketView } from "@/lib/domain/bracket";
import { isByeTie } from "@/lib/domain/bracket-layout";
import { readSource } from "./source";
import type { Player } from "@/lib/domain/types";

/**
 * THE DRAW PRINTS A SHEET A SECTION (the panel, 2026-10-23, part c): each
 * quarter — or half — on its own A4 landscape page plus one Finals page (a draw
 * of 16 or fewer is one page), legible in black and white, "Printed on <date>"
 * on every sheet, a blank result line under each tie still to play, byes left
 * out, and every sheet fitted inside the page.
 */

const field = (n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Seed ${i + 1}`, handicap: i, seed: i + 1 }));

/** Part-played: the preliminary tie (if any) and the first tie of every later quarter of Round 1. */
function partPlayed(n: number): BracketView {
  const players = field(n);
  const winners: Record<string, string> = {};
  let view = buildBracket("winners", players, winners);
  const ready = view.rounds.flatMap((r) => r.matches).filter((m) => m.a.playerId && m.b.playerId && !m.winnerId);
  for (const m of ready.slice(0, Math.ceil(ready.length / 3))) winners[m.key] = m.a.playerId!;
  view = buildBracket("winners", players, winners);
  return view;
}

const PAGE_W = 1047;
const PAGE_H = 718;

function pagesOf(html: string): string[] {
  return html.split('<section class="bracket-print-page"').slice(1);
}

describe("the draw on paper", () => {
  for (const [n, expected] of [
    [129, ["q1", "q2", "q3", "q4", "finals"]],
    [64, ["q1", "q2", "q3", "q4", "finals"]],
    [22, ["top", "bottom", "finals"]],
    [16, ["whole"]],
    [5, ["whole"]],
  ] as const) {
    it(`${n} players: ${expected.join(", ")} — each a sheet, fitted, with a line for every tie still to play and no byes`, () => {
      const view = partPlayed(n);
      expect(printPages(view).map((s) => s.key)).toEqual(expected);
      const html = renderToStaticMarkup(
        <BracketPrint view={view} results={{}} title="Spring Knockout" printedOn="Printed on 24 Oct 2026" seeded />,
      );
      const pages = pagesOf(html);
      expect(pages.length).toBe(expected.length);
      const byKey = new Map(view.rounds.flatMap((r) => r.matches).map((m) => [m.key, m]));
      printPages(view).forEach((s, i) => {
        const page = pages[i];
        expect(page).toContain(`data-print-section="${s.key}"`);
        expect(page).toContain("Spring Knockout");
        expect(page).toContain("Printed on 24 Oct 2026");
        // Every tie of the section, and a result line under exactly the ones still to play.
        const ties = [...page.matchAll(/data-tie="([^"]+)"/g)].map((m) => m[1]);
        expect(ties.sort()).toEqual([...s.keys].sort());
        const open = s.keys.filter((k) => !byKey.get(k)!.winnerId).length;
        expect(page.split('class="bracket-print-result"').length - 1, `${s.label}: result lines`).toBe(open);
        // No bye is a tie on paper either.
        expect(ties.some((k) => isByeTie(byKey.get(k)!))).toBe(false);
        expect(page).not.toMatch(/>Bye</);
        // Fitted: the drawing, zoomed, is inside the A4 landscape page under its heading.
        const box = page.match(/width:(\d+(?:\.\d+)?)px;height:(\d+(?:\.\d+)?)px;zoom:(\d+(?:\.\d+)?)/);
        expect(box, `${s.label}: no drawing box`).not.toBeNull();
        const [w, h, z] = box!.slice(1).map(Number);
        expect(z).toBeLessThanOrEqual(1);
        expect(w * z).toBeLessThanOrEqual(PAGE_W + 0.5);
        expect(h * z).toBeLessThanOrEqual(PAGE_H + 0.5);
        // Legible: never zoomed so far that 12px type prints under 6.5px.
        expect(12 * z, `${s.label}: type printed at ${(12 * z).toFixed(1)}px`).toBeGreaterThanOrEqual(6.5);
      });
    });
  }

  it("marks a winner in words as well as weight, and seeds only a seeded draw", () => {
    const view = buildBracket("winners", field(8), { "winners-0-0": "p1" });
    const seeded = renderToStaticMarkup(<BracketPrint view={view} results={{ "winners-0-0": "3&2" }} title="T" printedOn="P" seeded />);
    expect(seeded).toMatch(/✓ Seed 1<\/span><span>3&amp;2</);
    expect(seeded).toMatch(/Seed 4<\/span><span>4</);
    const unseeded = renderToStaticMarkup(<BracketPrint view={view} results={{}} title="T" printedOn="P" seeded={false} />);
    expect(unseeded).toMatch(/Seed 4<\/span><span><\/span>/);
  });

  it("is black on white, one A4 landscape sheet a section, and printed alone", () => {
    const css = readSource("src/app/globals.css");
    expect(css).toMatch(/@page bracket-sheet\s*\{\s*size: A4 landscape;/);
    expect(css).toMatch(/\.bracket-print-page\s*\{\s*page: bracket-sheet;\s*break-after: page;/);
    expect(css).toMatch(/body\.printing-draw > \*:not\(\.bracket-print\)\s*\{\s*display: none !important;/);
    for (const rule of [".bracket-print-tie", ".bracket-print-seat + .bracket-print-seat", ".bracket-print-result"]) {
      const at = css.indexOf(`${rule} {`);
      expect(at, rule).toBeGreaterThan(-1);
      expect(css.slice(at, css.indexOf("}", at)), `${rule} is not drawn in black`).toMatch(/#000/);
    }
  });
});
