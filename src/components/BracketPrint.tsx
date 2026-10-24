import type { BracketView } from "@/lib/domain";
import { drawSections, layoutSection, type DrawSection } from "@/lib/domain/bracket-layout";
import { marginWords } from "@/lib/domain/my-tie";

/*
 * THE DRAW ON PAPER (the panel, 2026-10-23, part c): each quarter (or half) on
 * its own A4 landscape page and one page for the Finals — a draw of 16 or fewer
 * is one page — legible in black and white, "Printed on <date>" on every page, a
 * blank result line under each tie still to play, and no byes (a bye is not a
 * tie; the seed is drawn in their first real one, with "bye" beside the name).
 *
 * The same layout model as the screen (`layoutSection`), at paper's measures,
 * and fitted to the page with `zoom` so a quarter of 129 is one sheet whatever
 * its depth. Drawn only while printing (`BracketDrawing` mounts it under
 * `body` and calls `window.print()`), so the screen carries none of it.
 */

/* Paper measures, in CSS pixels at 96 to the inch. */
const SEAT = 20;
const TIE_W = 172;
const COL_GAP = 22;
const HEAD = 22;
const CHAMP_W = 120;
/** A4 landscape inside 10mm margins: 277 x 190mm. */
const PAGE_W = 1047;
const PAGE_H = 718;
/** The page's own heading line. */
const TITLE_H = 44;

export interface PrintPage {
  section: DrawSection;
  title: string;
}

/** The pages a draw prints as: every section but the whole draw, or the whole draw when it has no tabs. */
export function printPages(view: BracketView): DrawSection[] {
  const sections = drawSections(view);
  const parts = sections.filter((s) => s.key !== "whole");
  return parts.length ? parts : sections;
}

export function BracketPrint({
  view,
  results,
  title,
  printedOn,
  seeded,
}: {
  view: BracketView;
  results: Record<string, string>;
  /** The tournament and the draw, as the sheet's heading names them. */
  title: string;
  /** "Printed on 24 Oct 2026", worded where it is printed. */
  printedOn: string;
  seeded: boolean;
}) {
  const finalKey = view.rounds[view.rounds.length - 1]?.matches[0]?.key ?? "";
  return (
    <div className="bracket-print">
      {printPages(view).map((s) => {
        const layout = layoutSection(view, s.keys, 0.6);
        const left = (c: number) => c * (TIE_W + COL_GAP);
        const top = (y: number) => HEAD + y * SEAT;
        const finalBox = layout.columns.flatMap((c) => c.ties).find((t) => t.match.key === finalKey);
        const width = left(layout.columns.length) - COL_GAP + (finalBox ? COL_GAP + CHAMP_W : 0);
        const height = top(layout.height) + SEAT;
        const zoom = Math.min(1, PAGE_W / Math.max(width, 1), (PAGE_H - TITLE_H) / Math.max(height, 1));
        return (
          <section key={s.key} className="bracket-print-page" data-print-section={s.key} aria-label={`${title} — ${s.label}`}>
            <header className="bracket-print-head">
              <strong>{title}</strong>
              <span>{s.key === "whole" ? "The draw" : s.label}</span>
              <span>{printedOn}</span>
            </header>
            <div style={{ position: "relative", width, height, zoom }}>
              <svg aria-hidden="true" width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
                {layout.connectors.map((c) => {
                  const x1 = left(c.fromCol) + TIE_W;
                  const xm = x1 + COL_GAP / 2;
                  return (
                    <path
                      key={`${c.fromKey}>${c.toKey}`}
                      d={`M ${x1} ${top(c.fromY)} H ${xm} V ${top(c.toY)} H ${left(c.toCol)}`}
                      fill="none"
                      stroke="#000"
                      strokeWidth={1}
                    />
                  );
                })}
              </svg>
              {layout.columns.map((col, c) => (
                <div key={col.roundIndex}>
                  <div className="bracket-print-round" style={{ position: "absolute", left: left(c), top: 0, width: TIE_W, height: HEAD }}>
                    {col.label}
                  </div>
                  {col.ties.map((t) => {
                    const m = t.match;
                    const margin = m.winnerId ? marginWords(results[m.key]).trim() : "";
                    return (
                      <div
                        key={m.key}
                        className="bracket-print-tie"
                        data-tie={m.key}
                        style={{ position: "absolute", left: left(c), top: top(t.y - 1), width: TIE_W, height: SEAT * 2 }}
                      >
                        {([
                          [m.a, t.a.bye],
                          [m.b, t.b.bye],
                        ] as const).map(([slot, bye], i) => {
                          const won = !!m.winnerId && slot.playerId === m.winnerId;
                          return (
                            <div key={i} className="bracket-print-seat" style={{ height: SEAT, fontWeight: won ? 700 : 400 }}>
                              <span className="bracket-print-name">
                                {won ? "✓ " : ""}
                                {slot.name}
                                {bye ? " (bye)" : ""}
                              </span>
                              <span>{won && margin ? margin : seeded && slot.seed ? slot.seed : ""}</span>
                            </div>
                          );
                        })}
                        {/* A tie still to play has a line to write its result on. */}
                        {!m.winnerId && <div className="bracket-print-result">Result:</div>}
                      </div>
                    );
                  })}
                </div>
              ))}
              {finalBox && (
                <div
                  className="bracket-print-champion"
                  style={{ position: "absolute", left: left(finalBox.col) + TIE_W + COL_GAP, top: top(finalBox.y - 1), width: CHAMP_W, height: SEAT * 2 }}
                >
                  <div>Champion</div>
                  <strong>{view.champion?.name ?? ""}</strong>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
