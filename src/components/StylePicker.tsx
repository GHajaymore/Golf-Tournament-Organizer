"use client";
import { useState, useTransition } from "react";
import { STYLE_PRESETS, DEFAULT_STYLE, type StyleKey } from "@/lib/styles";
import { saveOrganizationStyle } from "@/app/actions/organization";
import { themeVarsFor, DARK_GROUND, LIGHT_GROUND, type ClubTheme } from "@/lib/themes";

/**
 * The club's STYLE — the second axis beside colour.
 *
 * Sits next to the colour picker and works the same way: pick, it saves, the
 * whole product follows. The preview is the point — it shows BOTH a console
 * sample and a player sample, on the club's own colours, so an organizer sees
 * what members will see, not just what they will. A style only changes the type
 * and the treatment; the colours in the preview are the club's real ones.
 */

/** A tiny leaderboard, drawn on the club's colours and the chosen style. */
function StyleSample({
  label,
  vars,
  styleKey,
}: {
  label: string;
  vars: React.CSSProperties;
  styleKey: StyleKey;
}) {
  const rows = [
    { pos: 1, name: "Ann Doyle", score: "−4", lead: true },
    { pos: 2, name: "Bob Ellery", score: "−1", lead: false },
    { pos: 3, name: "Cara Fenn", score: "+3", lead: false },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 600 }}>{label}</span>
      <div
        data-style={styleKey}
        style={{
          ...vars,
          background: "var(--color-bg)",
          color: "var(--color-text)",
          borderRadius: 10,
          padding: 10,
          border: "1px solid var(--color-divider)",
        }}
      >
        <div className="board-panel" style={{ background: "var(--color-surface)" }}>
          <div
            className="board-head"
            style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "8px 10px" }}
          >
            <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 14 }}>
              Leaderboard
            </span>
            <span className="card-kicker" style={{ fontSize: 10 }}>
              Live
            </span>
          </div>
          {rows.map((r) => (
            <div
              key={r.pos}
              className={r.lead ? "board-leader" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 10px",
                fontSize: 12.5,
                borderTop: r.pos === 1 ? "none" : "1px solid var(--color-divider)",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-heading)",
                  color: "var(--color-accent-300)",
                  fontWeight: 600,
                  width: 14,
                }}
              >
                {r.pos}
              </span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.name}
              </span>
              <span
                style={{
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 600,
                  color: r.lead ? "var(--color-accent-2-400)" : "var(--color-text)",
                }}
              >
                {r.score}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StylePicker({
  styleKey,
  theme,
  readOnly,
}: {
  styleKey: StyleKey;
  theme: ClubTheme;
  readOnly?: boolean;
}) {
  const [selected, setSelected] = useState<StyleKey>(styleKey);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  // Auto resolves to dark for the console preview, matching where it renders.
  const ground = theme.appearance === "light" ? LIGHT_GROUND : DARK_GROUND;
  const vars = themeVarsFor(theme, ground) as React.CSSProperties;

  const pick = (k: StyleKey) => {
    if (readOnly || k === selected || pending) return;
    const prev = selected;
    setSelected(k);
    setError("");
    startTransition(async () => {
      const res = await saveOrganizationStyle(k);
      if (!res.ok) {
        setSelected(prev);
        setError(res.error ?? "Could not save the style.");
      }
    });
  };

  return (
    <div className="card elev-sm" style={{ gap: 14 }}>
      <div>
        <span className="card-kicker">Style</span>
        <h2 className="card-title" style={{ fontSize: 17 }}>The look of your club</h2>
        <p className="text-muted" style={{ fontSize: 13, lineHeight: 1.6, margin: "4px 0 0" }}>
          Colour sets your club&rsquo;s colours; this sets its <em>look</em> &mdash; the typefaces and the
          treatment. Every style works in any colour, and it applies to the console, the public
          board and the player app alike.
        </p>
      </div>

      <div role="radiogroup" aria-label="Club style" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {STYLE_PRESETS.map((s) => {
          const on = selected === s.key;
          const disabled = !s.ready || readOnly;
          return (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled && !on}
              onClick={() => pick(s.key)}
              style={{
                textAlign: "left",
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                padding: "12px 14px",
                borderRadius: 10,
                cursor: disabled ? "default" : "pointer",
                background: on ? "color-mix(in srgb, var(--color-accent) 10%, transparent)" : "var(--color-surface)",
                border: on ? "1px solid var(--color-accent)" : "1px solid var(--color-divider)",
                opacity: !s.ready ? 0.55 : 1,
              }}
            >
              <span
                aria-hidden
                style={{
                  marginTop: 2,
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  flexShrink: 0,
                  border: on ? "5px solid var(--color-accent)" : "2px solid var(--color-neutral-400)",
                }}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</span>
                  {s.key === DEFAULT_STYLE && (
                    <span className="tag tag-accent" style={{ fontSize: 10 }}>Recommended</span>
                  )}
                  {!s.ready && (
                    <span className="tag tag-neutral" style={{ fontSize: 10 }}>Coming soon</span>
                  )}
                </span>
                <span className="text-muted" style={{ display: "block", fontSize: 12.5, lineHeight: 1.55, marginTop: 2 }}>
                  {s.blurb}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="card-kicker">Preview &mdash; on your colours</span>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 12 }}>
          <StyleSample label="Console &amp; public board" vars={vars} styleKey={selected} />
          <StyleSample label="Player app" vars={vars} styleKey={selected} />
        </div>
      </div>

      {error && (
        <p role="alert" style={{ fontSize: 13, color: "var(--color-danger)", margin: 0 }}>{error}</p>
      )}
      {readOnly && (
        <p className="text-muted" style={{ fontSize: 12.5, margin: 0 }}>
          Only an organization owner or admin can change the style.
        </p>
      )}
    </div>
  );
}
