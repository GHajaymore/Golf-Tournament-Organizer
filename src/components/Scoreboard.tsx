import Link from "next/link";
import type { TileMark } from "@/lib/domain/scoreboard";
import { Icon } from "./Icon";

/**
 * THE HAND-HUNG SCOREBOARD — the look the club chose for the player's Today
 * screen on 2026-09-19 (design D). Two panels:
 *
 *   - LEADERS: the top of the board, and the player themself, on tiles;
 *   - YOUR CARD: the round as eighteen hung tiles, ringed red under par and
 *     boxed over, with one button to hang the next hole.
 *
 * Presentational only. Every value arrives already decided on the server —
 * positions, totals and thru from `standingRows` and `rankedScore`, the marks
 * from `tileMark` — so this can never disagree with the Board tab.
 *
 * The palette is the fixed `--sb-*` object set in globals.css: the board is
 * the same at every club and on either ground, like the TourneyHQ mark.
 */

export interface LeaderTile {
  id: string;
  pos: string;
  name: string;
  thru: string;
  total: string;
  /** Under par: the total is painted red, as on a real board. */
  under: boolean;
  you: boolean;
  /** A break before this row — the player, below the leaders. */
  gap: boolean;
}

export function ScoreboardLeaders({ rows, note }: { rows: LeaderTile[]; note?: string }) {
  return (
    <section aria-label="Leaders" className="sb-frame" style={{ marginTop: 14 }}>
      <div className="sb-board">
        <div className="sb-title">LEADERS</div>
        <div className="sb-row sb-head" aria-hidden="true">
          <span>POS</span>
          <span style={{ textAlign: "left", paddingLeft: 8 }}>PLAYER</span>
          <span>THRU</span>
          <span>TOT</span>
        </div>
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((r) => (
            <li key={r.id}>
              {r.gap && <div className="sb-gap" aria-hidden="true" />}
              <div className="sb-row" aria-label={`${r.pos === "–" ? "Not ranked" : `Position ${r.pos}`}, ${r.you ? "you" : r.name}, ${r.thru === "F" ? "finished" : r.thru === "–" ? "not started" : `thru ${r.thru}`}, ${r.total}`}>
                <span className="sb-tile" aria-hidden="true">{r.pos}</span>
                <span className={`sb-tile sb-name${r.you ? " sb-you" : ""}`} aria-hidden="true">
                  {r.you ? `${r.name} · YOU` : r.name}
                </span>
                <span className="sb-tile" aria-hidden="true">{r.thru}</span>
                <span className={`sb-tile${r.under ? " sb-under" : ""}`} aria-hidden="true">{r.total}</span>
              </div>
            </li>
          ))}
        </ol>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            padding: "4px 10px 10px",
            fontFamily: "var(--font-body)",
            fontSize: 12.5,
            color: "var(--sb-ink)",
          }}
        >
          <span>{note}</span>
          <Link href="/me/board" style={{ color: "var(--sb-frame)", fontWeight: 700, minHeight: 44, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
            Full board <Icon name="arrow-right" />
          </Link>
        </div>
      </div>
    </section>
  );
}

export interface HoleTile {
  n: number;
  stroke: number | null;
  mark: TileMark;
  next: boolean;
}

export function ScoreboardCard({
  headline,
  total,
  tiles,
  action,
  footer,
}: {
  /** "YOUR CARD · THRU 9" — the service's own label for where the card is. */
  headline: string;
  /** The number this player is ranked on, "E", "+2", "36 pts". */
  total: string;
  tiles: HoleTile[];
  action: { href: string; label: string } | null;
  footer: string;
}) {
  const filled = tiles.filter((t) => t.stroke !== null).length;
  return (
    <section aria-label="Your round" className="sb-frame" style={{ marginTop: 14 }}>
      <div className="sb-board" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
          <span style={{ color: "var(--sb-frame)", fontSize: 16, fontWeight: 700, letterSpacing: "0.12em" }}>{headline}</span>
          <span style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{total}</span>
        </div>

        {tiles.length > 0 && (
          <div className="sb-card" role="img" aria-label={`${filled} of ${tiles.length} holes in`}>
            {tiles.map((t) => (
              <div key={t.n} className="sb-hole">
                <span className="sb-hole-n">{t.n}</span>
                <span
                  className={`sb-tile is-${t.next ? "next" : t.mark}`}
                >
                  {t.stroke ?? ""}
                </span>
              </div>
            ))}
          </div>
        )}

        {action && (
          <Link href={action.href} className="sb-action">
            {action.label} <Icon name="arrow-right" />
          </Link>
        )}

        <div style={{ fontFamily: "var(--font-body)", fontSize: 12.5, lineHeight: 1.5 }}>{footer}</div>
      </div>
    </section>
  );
}
