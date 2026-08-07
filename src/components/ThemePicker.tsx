"use client";
import { useState, useTransition } from "react";
import { saveOrganizationTheme } from "@/app/actions/organization";
import {
  THEME_PRESETS,
  themeScale,
  themeFor,
  customPreset,
  sunlightCheck,
  type ThemePreset,
} from "@/lib/themes";

/**
 * The club's accent colour.
 *
 * Presets first because most clubs want a colour that looks right rather than
 * one that matches a hex from a brand guide, and a custom field underneath for
 * the ones that do. Both are safe by construction: the ramp is rebuilt from
 * hue and saturation with lightness solved per hue, so a club cannot choose
 * something the app can't render legibly.
 *
 * What it *can* choose is something that reads poorly outdoors, which no
 * contrast standard covers — hence the sunlight note.
 */
export function ThemePicker({
  themeKey,
  themeHex,
  readOnly,
}: {
  themeKey: string;
  themeHex: string;
  readOnly: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [hex, setHex] = useState(themeHex || "#1b4d3e");

  const save = (key: string, colour = "") => {
    setError("");
    startTransition(async () => {
      const res = await saveOrganizationTheme(key, colour);
      if (!res.ok && res.error) setError(res.error);
    });
  };

  const active: ThemePreset =
    themeKey === "custom" ? (customPreset(themeHex) ?? themeFor(themeKey)) : themeFor(themeKey);
  const sun = sunlightCheck(active);
  const preview = customPreset(hex);

  const Swatch = ({ preset, selected }: { preset: ThemePreset; selected: boolean }) => {
    const s = themeScale(preset);
    return (
      <button
        type="button"
        disabled={pending || readOnly}
        onClick={() => save(preset.key)}
        style={{
          textAlign: "left",
          padding: "10px 12px",
          borderRadius: 10,
          cursor: readOnly ? "default" : "pointer",
          color: "var(--color-text)",
          background: selected ? `${s[900]}` : "var(--color-bg)",
          border: `1px solid ${selected ? s[500] : "var(--color-divider)"}`,
        }}
      >
        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          {[300, 400, 500, 600, 700].map((step) => (
            <span
              key={step}
              style={{ width: 18, height: 18, borderRadius: 4, background: s[step] }}
            />
          ))}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{preset.name}</div>
        <div className="text-muted" style={{ fontSize: 11, marginTop: 1 }}>{preset.blurb}</div>
      </button>
    );
  };

  return (
    <div className="card elev-sm" style={{ gap: 12 }}>
      <div>
        <span className="card-title" style={{ fontSize: 15 }}>Club colour</span>
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
          Applies to every tournament this organization runs. The fairway green stays as it is —
          it marks players advancing and scores under par, so it shouldn&apos;t change with a rebrand.
        </p>
      </div>

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        {THEME_PRESETS.map((p) => (
          <Swatch key={p.key} preset={p} selected={themeKey === p.key} />
        ))}
      </div>

      {/* The club's own colour. Only its hue and saturation are used — the
          lightness is rebuilt, which is what stops a pale crest colour from
          producing text nobody can read. */}
      <div
        style={{
          borderTop: "1px solid var(--color-divider)",
          paddingTop: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <span className="card-kicker">Or your own colour</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ width: 130, fontFamily: "var(--font-mono, monospace)" }}
            value={hex}
            disabled={readOnly}
            onChange={(e) => setHex(e.target.value)}
            placeholder="#1B4D3E"
            aria-label="Club colour hex"
          />
          {preview && (
            <div style={{ display: "flex", gap: 4 }}>
              {[300, 400, 500, 600, 700].map((step) => (
                <span
                  key={step}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    background: themeScale(preview)[step],
                  }}
                />
              ))}
            </div>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending || readOnly || !preview}
            onClick={() => save("custom", hex)}
          >
            {themeKey === "custom" ? "Update" : "Use this colour"}
          </button>
        </div>
        <p className="text-muted" style={{ fontSize: 11, margin: 0 }}>
          We keep your colour&apos;s hue and adjust its brightness so text stays readable on every
          screen — the swatches above show exactly what you&apos;ll get.
        </p>
      </div>

      {/* No contrast standard covers a phone in direct sun, and that is where
          this app is used. */}
      {sun.warning && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            padding: "10px 12px",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
          }}
        >
          <i className="ph ph-sun" style={{ fontSize: 15, marginTop: 1 }} />
          <p style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>{sun.warning}</p>
        </div>
      )}

      {error && <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>{error}</p>}
    </div>
  );
}
