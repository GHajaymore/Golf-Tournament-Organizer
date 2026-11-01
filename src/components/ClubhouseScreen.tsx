"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CLUBHOUSE_PAGE_MS, nextPage, pageHeight, pageStarts, pageWords, type Atom } from "@/lib/domain/clubhouse-pages";

/**
 * THE PUBLIC BOARD ON A TV IN THE CLUBHOUSE (2026-10-24).
 *
 * `/live/<token>?screen=clubhouse`. The board itself is the page's own — the
 * same `liveBoard` view, the same components, behind the same credential and
 * visibility check — so this screen cannot show more than the board shows:
 * it is only the frame. What the frame does:
 *
 *   - large type: the whole board is drawn bigger as the screen gets bigger
 *     (`zoom`, set by the screen's size below), read from across a bar on a
 *     1920x1080 TV and still whole on 1280x720;
 *   - no chrome: no round picker, no buttons, nothing to press;
 *   - a page at a time: when the board is taller than the screen it shows one
 *     screen of it, then the next, then starts again (`pageStarts` breaks the
 *     pages between rows). Each page stays up `CLUBHOUSE_PAGE_MS`;
 *   - motion only where the viewer allows it: the page slides to the next one,
 *     and under prefers-reduced-motion it simply switches;
 *   - it refreshes on the board's own cadence, because the page renders the
 *     board's own `LiveRefresh` in `foot`.
 *
 * The frame measures in the screen's own pixels: the view that clips the board
 * is not zoomed, so its height and the rows' positions inside it are read in
 * one unit (and corrected by the ratio of the two, for an engine that reports
 * a zoomed element's box unzoomed).
 */

const ATOMS = "li, tr, h2, h3, p, [role='separator']";

/**
 * The frame's own sheet. The board inside keeps its own styles; this sets the
 * size it is drawn at and the frame round it.
 *
 * `zoom` steps rather than scales smoothly, so a size is a size: 1280x720 draws
 * the board a little larger than a laptop does, 1920x1080 about half as large
 * again. Each step asks for the HEIGHT as well, so a wide, short window is not
 * zoomed into a single row a page.
 */
const CLUBHOUSE_CSS = `
.clubhouse { position: fixed; inset: 0; display: flex; flex-direction: column; overflow: hidden;
  background: var(--color-bg); color: var(--color-text); padding: 0 24px; }
.clubhouse .ch-z { zoom: 1; }
.clubhouse .ch-head, .clubhouse .ch-board, .clubhouse .ch-foot { width: 100%; max-width: 960px; margin: 0 auto; }
.clubhouse .ch-head { padding-top: 14px; flex: none; display: flex; flex-wrap: wrap; align-items: center; column-gap: 32px; }
.clubhouse .ch-head > header { order: -1; flex: 1 1 420px; min-width: 0; margin-bottom: 12px !important; }
.clubhouse .ch-head > div:first-child { margin-bottom: 12px !important; }
.clubhouse .ch-head > :not(header):not(:first-child) { flex-basis: 100%; }
.clubhouse .ch-view { flex: 1; min-height: 0; overflow: hidden; position: relative; }
.clubhouse .ch-window { overflow: hidden; height: 100%; }
.clubhouse .ch-slide { transition: transform 600ms ease; will-change: transform; }
.clubhouse .ch-board { padding-bottom: 8px; }
.clubhouse .ch-foot { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 8px 0 12px; border-top: 1px solid var(--color-divider); flex-wrap: wrap; }
.clubhouse .ch-page { font-size: 14px; font-weight: 700; letter-spacing: 0.06em; color: var(--color-neutral-400); }
@media (min-width: 1200px) and (min-height: 650px) { .clubhouse .ch-z { zoom: 1.12; } }
@media (min-width: 1600px) and (min-height: 850px) { .clubhouse .ch-z { zoom: 1.3; } }
@media (min-width: 1880px) and (min-height: 1000px) { .clubhouse .ch-z { zoom: 1.45; } }
@media (min-width: 2500px) and (min-height: 1400px) { .clubhouse .ch-z { zoom: 1.9; } }
@media (prefers-reduced-motion: reduce) { .clubhouse .ch-slide { transition: none; } }
`;

export function ClubhouseScreen({ head, foot, children }: { head: ReactNode; foot: ReactNode; children: ReactNode }) {
  const viewRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [starts, setStarts] = useState<number[]>([0]);
  const [index, setIndex] = useState(0);
  const [viewHeight, setViewHeight] = useState(0);

  // Where the pages break: measured after the board is drawn, and again
  // whenever it changes size or its rows change (a refresh brings new scores).
  useEffect(() => {
    const view = viewRef.current;
    const board = boardRef.current;
    if (!view || !board) return;
    const measure = () => {
      const inner = board.firstElementChild as HTMLElement | null;
      if (!inner) return;
      // The slider is not zoomed, so its height is in the screen's pixels.
      const total = board.offsetHeight;
      const box = inner.getBoundingClientRect();
      // An engine that reports a zoomed element's boxes unzoomed: scale them up.
      const k = box.height > 0 ? total / box.height : 1;
      const scale = Math.abs(k - 1) < 0.02 ? 1 : k;
      const atoms: Atom[] = [...inner.querySelectorAll(ATOMS)].map((el) => {
        const r = el.getBoundingClientRect();
        return { top: (r.top - box.top) * scale, bottom: (r.bottom - box.top) * scale };
      });
      const next = pageStarts(atoms, view.clientHeight, total);
      setStarts((prev) => (prev.length === next.length && prev.every((v, i) => Math.abs(v - next[i]) < 1) ? prev : next));
      setViewHeight(view.clientHeight);
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(view);
    resize.observe(board);
    const mutate = new MutationObserver(measure);
    mutate.observe(board, { childList: true, subtree: true, characterData: true });
    return () => {
      resize.disconnect();
      mutate.disconnect();
    };
  }, []);

  // A board that shrank keeps a page that exists.
  const count = starts.length;
  const shown = Math.min(index, count - 1);

  useEffect(() => {
    if (count <= 1) return;
    const turn = setInterval(() => setIndex((i) => nextPage(Math.min(i, count - 1), count)), CLUBHOUSE_PAGE_MS);
    return () => clearInterval(turn);
  }, [count]);

  const words = pageWords(shown, count);

  return (
    <main className="clubhouse" aria-label="Clubhouse screen" data-page={shown + 1} data-pages={count}>
      <style>{CLUBHOUSE_CSS}</style>
      <div className="ch-z ch-head">{head}</div>
      <div ref={viewRef} className="ch-view">
        {/* The window ends where the next page begins, so the row a page
            breaks before is not half-shown at its foot. */}
        <div className="ch-window" style={count > 1 && viewHeight > 0 ? { height: pageHeight(starts, shown, viewHeight) } : undefined}>
          {/* The slider moves (unzoomed, so a pixel is a screen pixel); the
              board inside it is drawn large. */}
          <div
            ref={boardRef}
            className="ch-slide"
            style={{ transform: shown > 0 ? `translateY(${-starts[shown]}px)` : undefined }}
          >
            <div className="ch-z ch-board">{children}</div>
          </div>
        </div>
      </div>
      <div className="ch-z ch-foot">
        <span className="ch-page" aria-live="off">
          {words}
        </span>
        {foot}
      </div>
    </main>
  );
}
