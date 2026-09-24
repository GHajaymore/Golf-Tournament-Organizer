"use client";
import { useEffect, useState } from "react";
import { READY_STYLES, type StyleKey } from "@/lib/styles";
import { themeVarsFor, DARK_GROUND, LIGHT_GROUND, type ClubTheme } from "@/lib/themes";

/**
 * THE FULL PREVIEW — whole screens, not a snippet.
 *
 * The picker's inline sample answers "what colour"; this answers "what will my
 * members actually see". A button opens a full-screen overlay with a real
 * console screen beside a real player screen, both on the club's own colours and
 * the chosen style, and a row of chips to flip the style and watch every screen
 * change at once. Nothing here is the live app — it is a faithful mock built
 * from the same tokens and the same `data-style`, so it moves exactly as the app
 * does without needing a session or a route.
 */

const ROWS = [
  { pos: "1", name: "Fumiko Shirakawa", score: "−3", lead: true },
  { pos: "2", name: "Hiroshi Tanabe", score: "+1", lead: false },
  { pos: "3", name: "Toby Marchetti", score: "+2", lead: false },
  { pos: "4", name: "Nkechi Obioma", score: "+6", lead: false },
  { pos: "5", name: "Elias Wardlow", score: "+7", lead: false },
  { pos: "6", name: "Desmond Achterberg", score: "+8", lead: false },
];

function Board({ compact }: { compact?: boolean }) {
  return (
    <div className="board-panel" style={{ background: "var(--color-surface)" }}>
      <div className="board-head" style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: compact ? 15 : 17 }}>
          Leaderboard
        </span>
        <span className="card-kicker" style={{ fontSize: 10 }}>Live &middot; Round 2</span>
      </div>
      {(compact ? ROWS.slice(0, 4) : ROWS).map((r) => (
        <div
          key={r.pos}
          className={r.lead ? "board-leader" : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: compact ? "8px 12px" : "11px 16px",
            fontSize: compact ? 13 : 15,
            borderTop: r.pos === "1" ? "none" : "1px solid var(--color-divider)",
          }}
        >
          <span style={{ fontFamily: "var(--font-heading)", color: "var(--color-accent-300)", fontWeight: 600, width: 18 }}>
            {r.pos}
          </span>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.name}
          </span>
          <span
            style={{
              fontVariantNumeric: "tabular-nums",
              fontWeight: 600,
              fontFamily: "var(--font-heading)",
              color: r.lead ? "var(--color-accent-2-400)" : "var(--color-text)",
            }}
          >
            {r.score}
          </span>
        </div>
      ))}
    </div>
  );
}

function Wordmark({ size = 18 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: size, letterSpacing: "0.02em" }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M7 3v18" stroke="var(--color-text)" strokeWidth="2" strokeLinecap="round" />
        <path d="M7 4h9l-2.4 3L16 10H7" fill="var(--color-accent)" />
      </svg>
      Tourney<span style={{ color: "var(--color-accent)" }}>HQ</span>
    </span>
  );
}

/** A desktop console screen: header, board, actions. */
function ConsoleScreen({ vars, styleKey }: { vars: React.CSSProperties; styleKey: StyleKey }) {
  return (
    <div
      data-style={styleKey}
      style={{
        ...vars,
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
        borderRadius: 12,
        border: "1px solid var(--color-divider)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--color-divider)" }}>
        <Wordmark />
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-heading)", fontSize: 17, fontWeight: 600 }}>Club Championship</span>
      </div>
      <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        <Board />
        <div style={{ display: "flex", gap: 10 }}>
          <span
            style={{
              background: "var(--color-accent)",
              color: "var(--color-on-accent)",
              fontWeight: 600,
              fontSize: 14,
              padding: "10px 16px",
              borderRadius: 8,
            }}
          >
            Enter scores
          </span>
          <span style={{ border: "1px solid var(--color-divider)", fontSize: 14, padding: "10px 16px", borderRadius: 8 }}>
            Publish
          </span>
        </div>
      </div>
    </div>
  );
}

/** A phone player screen: header, round hero, board, tabs. */
function PlayerScreen({ vars, styleKey }: { vars: React.CSSProperties; styleKey: StyleKey }) {
  return (
    <div
      data-style={styleKey}
      style={{
        ...vars,
        width: 300,
        flexShrink: 0,
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
        borderRadius: 22,
        border: "8px solid var(--color-neutral-800)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px" }}>
        <Wordmark size={15} />
        <div style={{ flex: 1 }} />
        <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--color-surface)", display: "grid", placeItems: "center", fontSize: 11, fontFamily: "var(--font-heading)" }}>SO</span>
      </div>
      <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 20, fontWeight: 600 }}>Good afternoon, Séamus</div>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Round 2 &middot; thru 12</div>
        </div>
        <div className="board-panel" style={{ background: "var(--color-surface)", padding: 14 }}>
          <span className="card-kicker" style={{ fontSize: 10 }}>Your round</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 34, fontWeight: 600 }}>&minus;1</span>
            <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>thru 12 &middot; 6th</span>
          </div>
          <div style={{ marginTop: 10, background: "var(--color-accent)", color: "var(--color-on-accent)", textAlign: "center", fontWeight: 600, fontSize: 14, padding: 11, borderRadius: 9 }}>
            Enter my score
          </div>
        </div>
        <Board compact />
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", borderTop: "1px solid var(--color-divider)", padding: "8px 4px 12px", marginTop: 12 }}>
        {["Today", "Board", "Card", "Events"].map((t, i) => (
          <span key={t} style={{ textAlign: "center", fontSize: 11, color: i === 0 ? "var(--color-accent)" : "var(--color-text-muted)" }}>{t}</span>
        ))}
      </div>
    </div>
  );
}

export function FullThemePreview({ theme, styleKey }: { theme: ClubTheme; styleKey: StyleKey }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<StyleKey>(styleKey);

  // Reflect the picker's selection whenever it changes.
  useEffect(() => setStyle(styleKey), [styleKey]);

  // Esc closes; body scroll is locked while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const ground = theme.appearance === "light" ? LIGHT_GROUND : DARK_GROUND;
  const vars = themeVarsFor(theme, ground) as React.CSSProperties;

  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        See full preview
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Full preview of your club's look"
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(3px)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: 20,
            overflow: "auto",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              ...vars,
              width: "min(1100px, 100%)",
              background: "var(--color-bg)",
              color: "var(--color-text)",
              borderRadius: 16,
              border: "1px solid var(--color-divider)",
              boxShadow: "0 24px 60px -12px rgba(0,0,0,0.5)",
              padding: 20,
              margin: "auto",
            }}
            data-style={style}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, fontWeight: 600 }}>Full preview</div>
                <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                  Your colours, in each style. This is how members will see the console and the app.
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setOpen(false)}
                aria-label="Close preview"
              >
                Close
              </button>
            </div>

            <div role="group" aria-label="Style" style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              {READY_STYLES.map((s) => {
                const on = style === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setStyle(s.key)}
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      padding: "8px 14px",
                      borderRadius: 999,
                      cursor: "pointer",
                      background: on ? "var(--color-accent)" : "var(--color-surface)",
                      color: on ? "var(--color-on-accent)" : "var(--color-text)",
                      border: on ? "1px solid var(--color-accent)" : "1px solid var(--color-divider)",
                    }}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 280 }}>
                <span className="card-kicker" style={{ display: "block", marginBottom: 6 }}>Console &amp; public board</span>
                <ConsoleScreen vars={vars} styleKey={style} />
              </div>
              <div>
                <span className="card-kicker" style={{ display: "block", marginBottom: 6 }}>Player app</span>
                <PlayerScreen vars={vars} styleKey={style} />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
