"use client";
import { useId } from "react";
import FieldInfo from "./FieldInfo";

/**
 * A subheading naming ONE question.
 *
 * Seven controls sat in a flat list under a single "Players & scoring"
 * heading, answering four unrelated questions: who may see results, how scores
 * get in, who signs a result off, and who is playing next week. The fix is
 * separation, not removal: every control is still present and still does what
 * it did, grouped under headings that each name one thing.
 *
 * Lifted out of `PlaySettings.tsx` (R3-1) so the blocks that now live in their
 * own files (`EntriesHowIn`, `EventTees`, `BoardVisibility`) draw the same
 * heading and the same radio group, never a copy.
 */
export function Group({ title, blurb, more }: { title: string; blurb: string; more?: string }) {
  return (
    <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 12, marginTop: 2 }}>
      <span style={{ fontFamily: "var(--font-heading)", fontSize: 15, fontWeight: 600 }}>{title}</span>
      {/* The blurb is one short line; anything longer is `more`, an ⓘ away
          (Ajay, 2026-10-05). */}
      <p className="text-muted" style={{ fontSize: 13, margin: "3px 0 0", lineHeight: 1.5, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        <span>{blurb}</span>
        {more && <FieldInfo label={title}>{more}</FieldInfo>}
      </p>
    </div>
  );
}

/** Radio group. Each option carries its own explanation, because these
 *  choices change what players can see and do — not somewhere to be terse. */
export function Choice<T extends string>({
  label,
  hint,
  value,
  options,
  labels,
  help,
  disabled,
  onChange,
}: {
  /** Empty where the Group heading above already names this setting. */
  label: string;
  hint?: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  help?: Record<T, string>;
  disabled: boolean;
  onChange: (v: T) => void;
}) {
  const fid = useId();
  return (
    <div className="field">
      {/* Suppressed when the Group heading directly above already says it.
          Where a group holds one control, the heading IS the label. The hint
          sits behind an ⓘ beside the label (2026-10-05), as the options'
          explanations do. */}
      {label && (
        <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <span id={`${fid}-caption`}>{label}</span>
          {hint && <FieldInfo label={label}>{hint}</FieldInfo>}
        </span>
      )}
      {/* THE NAME, AND ITS EXPLANATION AN ⓘ AWAY (Ajay, 2026-10-05). The name
          is the short line; `FieldInfo`, the app's tap-to-open explainer,
          holds the rest. The explanation is still required for every option
          (`settings-explained.test.ts`). */}
      <div
        role={label ? "group" : undefined}
        aria-labelledby={label ? `${fid}-caption` : undefined}
        style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 2 }}
      >
        {options.map((opt) => (
          <div key={opt} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 14,
                // 36px under a mouse, 44 under a finger (`--tap-min`,
                // globals.css). A bare `minHeight: 36` beat the touch rule for
                // a label round a radio (found 2026-10-23).
                minHeight: "var(--tap-min, 36px)",
                cursor: disabled ? "default" : "pointer",
                opacity: disabled ? 0.6 : 1,
              }}
            >
              <input type="radio" checked={value === opt} disabled={disabled} onChange={() => onChange(opt)} />
              <span>{labels[opt]}</span>
            </label>
            {help?.[opt] && <FieldInfo label={labels[opt]}>{help[opt]}</FieldInfo>}
          </div>
        ))}
      </div>
    </div>
  );
}
