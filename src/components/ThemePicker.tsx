"use client";
import { useState, useTransition } from "react";
import { saveOrganizationTheme } from "@/app/actions/organization";
import {
  ACCENT_PRESETS,
  SECONDARY_PRESETS,
  THEME_PAIRS,
  hslToHex,
  APPEARANCES,
  themeScale,
  themeVarsFor,
  groundFor,
  resolveTheme,
  resolveSecondary,
  customPreset,
  sunlightVerdict,
  pairVerdict,
  hueDistance,
  themeHue,
  DEFAULT_CLUB_THEME,
  type ThemePreset,
  type Appearance,
  type ClubTheme,
  type Ground,
} from "@/lib/themes";

/**
 * The club's whole look: light or dark, and both accent colours.
 *
 * Presets first because most clubs want a colour that looks right rather than
 * one matching a hex from a brand guide, and a custom field for the ones that
 * do. Both are safe by construction — the ramp is rebuilt from hue and
 * saturation with lightness solved per hue against the chosen ground, so a
 * club cannot pick something the app can't render legibly.
 *
 * What it *can* pick is something that reads poorly outdoors, which no
 * contrast standard covers. That's what the sunlight note is for, and it's why
 * appearance sits at the top: switching to light does more for readability on
 * the 14th tee than any colour choice below it.
 *
 * Changes are staged and saved together rather than applied per click. With
 * five fields, saving each one separately would walk the club through
 * combinations it never asked for — and the preview only means something when
 * it shows the whole thing at once.
 */
export function ThemePicker({
  theme,
  readOnly,
}: {
  theme: ClubTheme;
  readOnly: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState<ClubTheme>(theme);
  // Held separately from the draft so typing a half-finished hex doesn't blank
  // the preview on every keystroke.
  const [accentHexDraft, setAccentHexDraft] = useState(theme.accentHex || "#1b4d3e");
  const [secondaryHexDraft, setSecondaryHexDraft] = useState(theme.secondaryHex || "#1b4d3e");

  const set = (patch: Partial<ClubTheme>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
    setError("");
  };

  const save = () => {
    setError("");
    startTransition(async () => {
      const res = await saveOrganizationTheme(
        draft.accentKey,
        draft.accentHex,
        draft.secondaryKey,
        draft.secondaryHex,
        draft.appearance,
      );
      if (!res.ok && res.error) setError(res.error);
      else setSaved(true);
    });
  };

  const dirty =
    draft.accentKey !== theme.accentKey ||
    draft.accentHex !== theme.accentHex ||
    draft.secondaryKey !== theme.secondaryKey ||
    draft.secondaryHex !== theme.secondaryHex ||
    draft.appearance !== theme.appearance;

  // Swatches and preview are drawn on the ground the club is choosing, not the
  // one they're currently looking at — otherwise picking "light" would show
  // every colour as it appears in dark mode.
  const ground = groundFor(draft.appearance === "dark" ? "dark" : "light");
  const sun = sunlightVerdict(draft);
  const pair = pairVerdict(draft);
  const accentHue = themeHue(draft.accentKey, draft.accentHex);

  const Swatch = ({
    preset,
    selected,
    onPick,
    disabledReason,
  }: {
    preset: ThemePreset;
    selected: boolean;
    onPick: () => void;
    /** Set when this swatch can't do its job against the current accent. */
    disabledReason?: string;
  }) => {
    const s = themeScale(preset, ground);
    return (
      <button
        type="button"
        disabled={pending || readOnly || !!disabledReason}
        onClick={onPick}
        style={{
          textAlign: "left",
          padding: "10px 12px",
          borderRadius: 10,
          cursor: readOnly || disabledReason ? "default" : "pointer",
          // Was 0.4, which put the reason below it at about the contrast of a
          // watermark. Dimmed enough to read as unavailable, not so far that
          // the sentence explaining why cannot be read.
          opacity: disabledReason ? 0.62 : 1,
          color: ground.text,
          background: selected ? s[900] : ground.bg,
          border: `1px solid ${selected ? s[500] : `color-mix(in srgb, ${ground.text} 16%, transparent)`}`,
        }}
      >
        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          {[300, 400, 500, 600, 700].map((step) => (
            <span key={step} style={{ width: 18, height: 18, borderRadius: 4, background: s[step] }} />
          ))}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{preset.name}</div>
        {/* The comment at the call site said this swatch "says why instead of
            just dimming" — and it did not: the reason went into a `title`,
            which never appears on a touch device and is not announced. On the
            swatch now, in place of the blurb, because a swatch that cannot be
            picked has no use for a description of what picking it would do. */}
        <div style={{ fontSize: 11, marginTop: 1, opacity: 0.66 }}>
          {disabledReason ?? preset.blurb}
        </div>
      </button>
    );
  };

  const HexField = ({
    label,
    value,
    onChange,
    onUse,
    active,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    onUse: () => void;
    active: boolean;
  }) => {
    const preview = customPreset(value);
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ width: 130, fontFamily: "var(--font-mono, monospace)" }}
          value={value}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#1B4D3E"
          aria-label={label}
        />
        {preview && (
          <div style={{ display: "flex", gap: 4 }}>
            {[300, 400, 500, 600, 700].map((step) => (
              <span
                key={step}
                style={{ width: 20, height: 20, borderRadius: 4, background: themeScale(preview, ground)[step] }}
              />
            ))}
          </div>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending || readOnly || !preview}
          onClick={onUse}
        >
          {active ? "Update" : "Use this colour"}
        </button>
      </div>
    );
  };

  return (
    <div className="card elev-sm" style={{ gap: 16 }}>
      <div>
        <span className="card-title" style={{ fontSize: 15 }}>Club colour &amp; appearance</span>
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
          Applies to every tournament this organization runs, on every device anyone opens it on.
        </p>
      </div>

      {/* Appearance first: it changes the ground every colour below is judged
          against, and it matters more outdoors than any colour does. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="card-kicker">Appearance</span>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          {APPEARANCES.map((a) => (
            <button
              key={a.key}
              type="button"
              disabled={pending || readOnly}
              onClick={() => set({ appearance: a.key as Appearance })}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 10,
                cursor: readOnly ? "default" : "pointer",
                color: "var(--color-text)",
                background: draft.appearance === a.key ? "color-mix(in srgb, var(--color-accent) 12%, transparent)" : "var(--color-bg)",
                border: `1px solid ${draft.appearance === a.key ? "var(--color-accent)" : "var(--color-divider)"}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
                <i className={`ph ph-${a.key === "light" ? "sun" : a.key === "dark" ? "moon" : "circle-half"}`} />
                {a.name}
              </div>
              <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{a.blurb}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Ready-made pairs first. Choosing two colours that work together is a
          design job, and a club secretary opening this on a Tuesday evening
          didn't sign up for one — one click here sets both, and every pair is
          checked to hold apart. The individual pickers stay below for a club
          with its own crest colours. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="card-kicker">Colour scheme</span>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
          {THEME_PAIRS.map((pair) => {
            const accent = ACCENT_PRESETS.find((p) => p.key === pair.accentKey)!;
            const secondary = SECONDARY_PRESETS.find((p) => p.key === pair.secondaryKey)!;
            const on = draft.accentKey === pair.accentKey && draft.secondaryKey === pair.secondaryKey;
            return (
              <button
                key={pair.key}
                type="button"
                className="card"
                onClick={() =>
                  set({
                    accentKey: pair.accentKey,
                    accentHex: "",
                    secondaryKey: pair.secondaryKey,
                    secondaryHex: "",
                  })
                }
                style={{
                  cursor: "pointer",
                  textAlign: "left",
                  gap: 6,
                  padding: "10px 12px",
                  border: on
                    ? "1px solid var(--color-accent)"
                    : "1px solid var(--color-divider)",
                }}
                aria-pressed={on}
              >
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 22, height: 22, borderRadius: 999,
                      background: hslToHex(accent.hue, accent.saturation, 0.5),
                    }}
                  />
                  <span
                    aria-hidden="true"
                    style={{
                      width: 22, height: 22, borderRadius: 999, marginLeft: -8,
                      background: hslToHex(secondary.hue, secondary.saturation, 0.5),
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 500, marginLeft: 4 }}>{pair.name}</span>
                </span>
                <span className="text-muted" style={{ fontSize: 11 }}>{pair.blurb}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="card-kicker">Main colour</span>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
          {ACCENT_PRESETS.map((p) => (
            <Swatch
              key={p.key}
              preset={p}
              selected={draft.accentKey === p.key}
              onPick={() => set({ accentKey: p.key, accentHex: "" })}
            />
          ))}
        </div>
        {/* Only hue and saturation are used — the lightness is rebuilt, which is
            what stops a pale crest colour producing text nobody can read. */}
        <HexField
          label="Club colour hex"
          value={accentHexDraft}
          onChange={setAccentHexDraft}
          onUse={() => set({ accentKey: "custom", accentHex: accentHexDraft })}
          active={draft.accentKey === "custom"}
        />
        <p className="text-muted" style={{ fontSize: 11, margin: 0 }}>
          We keep your colour&apos;s hue and adjust its brightness so text stays readable on every
          screen — the swatches show exactly what you&apos;ll get.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="card-kicker">Second colour</span>
        <p className="text-muted" style={{ fontSize: 11, margin: 0 }}>
          Marks players advancing, scores under par and matches won. Most clubs should leave this on
          Fairway — it reads as the colour of the game rather than of any one club.
        </p>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
          {SECONDARY_PRESETS.map((p) => {
            // A second colour under 24° from the accent is the accent, as far
            // as a leaderboard in daylight is concerned — so it can't be
            // picked, and the swatch says why instead of just dimming.
            const clash =
              accentHue !== null && hueDistance(accentHue, p.hue) < 24 && draft.secondaryKey !== p.key
                ? `Too close to ${draft.accentKey === "custom" ? "your accent colour" : "the accent"} to read as a second colour.`
                : undefined;
            return (
              <Swatch
                key={p.key}
                preset={p}
                selected={draft.secondaryKey === p.key}
                onPick={() => set({ secondaryKey: p.key, secondaryHex: "" })}
                disabledReason={clash}
              />
            );
          })}
        </div>
        <HexField
          label="Second colour hex"
          value={secondaryHexDraft}
          onChange={setSecondaryHexDraft}
          onUse={() => set({ secondaryKey: "custom", secondaryHex: secondaryHexDraft })}
          active={draft.secondaryKey === "custom"}
        />
      </div>

      <ThemePreview theme={draft} ground={ground} />

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
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <p style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>{sun.warning}</p>
            {sun.suggestion && (
              <p style={{ fontSize: 12, margin: 0, lineHeight: 1.5, fontWeight: 500 }}>{sun.suggestion}</p>
            )}
          </div>
        </div>
      )}

      {pair.kind !== "ok" && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            padding: "10px 12px",
            borderRadius: 8,
            background: pair.kind === "indistinct"
              ? "color-mix(in srgb, var(--color-danger) 10%, transparent)"
              : "color-mix(in srgb, var(--color-accent) 10%, transparent)",
            border: pair.kind === "indistinct"
              ? "1px solid color-mix(in srgb, var(--color-danger) 35%, transparent)"
              : "1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
          }}
        >
          <i className="ph ph-palette" style={{ fontSize: 15, marginTop: 1 }} />
          <p style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>
            {pair.message}
            {pair.kind === "indistinct" && " Pick a second colour further from the accent to save."}
          </p>
        </div>
      )}

      {error && <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>{error}</p>}

      {/* The button row wraps, because it holds up to three buttons and one of
          them says "Back to default (Sunset + Fairway)" — 241px that will not
          break. On a phone the row pushed the page 4px wide, which the fixed
          tab bar then stretched to match. */}
      {!readOnly && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || !dirty || pair.kind === "indistinct"}
            onClick={save}
          >
            {pending ? "Saving…" : saved && !dirty ? "Saved" : "Save theme"}
          </button>
          {/* The way back to the stock look. Restores every field at once —
              including a stored custom hex, which switching presets alone
              leaves behind to resurrect on the next "custom" click. */}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={
              pending ||
              (draft.accentKey === DEFAULT_CLUB_THEME.accentKey &&
                draft.accentHex === DEFAULT_CLUB_THEME.accentHex &&
                draft.secondaryKey === DEFAULT_CLUB_THEME.secondaryKey &&
                draft.secondaryHex === DEFAULT_CLUB_THEME.secondaryHex &&
                draft.appearance === DEFAULT_CLUB_THEME.appearance)
            }
            onClick={() => {
              setDraft({ ...DEFAULT_CLUB_THEME });
              setAccentHexDraft("#1b4d3e");
              setSecondaryHexDraft("#1b4d3e");
              setSaved(false);
              setError("");
            }}
          >
            Back to default (Sunset + Fairway)
          </button>
          {dirty && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pending}
              onClick={() => { setDraft(theme); setError(""); }}
            >
              Discard
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The theme drawn on itself.
 *
 * Real interface pieces — a leaderboard row, a primary button, a muted label —
 * rather than a strip of swatches, because the question a club is actually
 * asking is "can I read a score in this", and a swatch can't answer it. The
 * whole panel is given the theme's own variables, so what's shown is produced
 * by exactly the tokens the app will render with.
 */
function ThemePreview({ theme, ground }: { theme: ClubTheme; ground: Ground }) {
  const vars = themeVarsFor(theme, ground) as React.CSSProperties;
  const accent = resolveTheme(theme.accentKey, theme.accentHex);
  const secondary = resolveSecondary(theme.secondaryKey, theme.secondaryHex);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="card-kicker">Preview</span>
      <div
        style={{
          ...vars,
          background: "var(--color-bg)",
          color: "var(--color-text)",
          border: "1px solid var(--color-divider)",
          borderRadius: 10,
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 15 }}>
            Leaderboard
          </span>
          <span style={{ fontSize: 11, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
            after Round 2
          </span>
        </div>

        <div style={{ background: "var(--color-surface)", borderRadius: 8, overflow: "hidden" }}>
          {[
            { pos: 1, name: "Ann Doyle", score: "−4", advancing: true },
            { pos: 2, name: "Bob Ellery", score: "−1", advancing: true },
            { pos: 3, name: "Cara Fenn", score: "+3", advancing: false },
          ].map((r) => (
            <div
              key={r.pos}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                fontSize: 13,
                borderTop: r.pos === 1 ? "none" : "1px solid var(--color-divider)",
                background: r.advancing ? "color-mix(in srgb, var(--color-accent-2) 12%, transparent)" : "transparent",
              }}
            >
              <span style={{ color: "var(--color-accent-300)", fontWeight: 600, width: 16 }}>{r.pos}</span>
              <span style={{ flex: 1 }}>{r.name}</span>
              <span
                style={{
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 600,
                  color: r.advancing ? "var(--color-accent-2-400)" : "var(--color-text)",
                }}
              >
                {r.score}
              </span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Outlined, matching .btn-primary — accent as label text on the page
              itself. A filled swatch would flatter a colour the app never
              renders that way. */}
          <span
            style={{
              border: "1px solid var(--color-accent)",
              color: "var(--color-accent)",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Enter scores
          </span>
          <span
            style={{
              border: "1px solid var(--color-divider)",
              color: "var(--color-text)",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 13,
            }}
          >
            Publish
          </span>
          <span style={{ fontSize: 11, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
            {accent.name}
            {secondary.key === "fairway" ? "" : ` + ${secondary.name}`}
          </span>
        </div>
      </div>
    </div>
  );
}
