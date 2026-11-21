import type { ReactNode } from "react";
import type { DefaultOf, Mark } from "@/lib/domain/setup-field";

/**
 * ONE SET-UP FIELD, as every redesigned screen draws it (R1a): a label, the value or its control, the
 * mark, and the way to change it or go back to the default.
 *
 * It computes nothing. The mark is `markOf`'s answer, passed in; the default is the app's proposal,
 * passed in. A screen that wants a different mark changes the rule (`setup-field.ts`), not this file.
 * Colours are `--color-*` tokens only; every flex child has `min-width: 0` and the label wraps above
 * the value when the room is narrower than both.
 */

export const MARK_WORDS: Record<Mark, string> = {
  "required-before-launch": "Required before launch",
  required: "Required",
  default: "Default",
};

const markStyle: Record<Mark, { color: string; border: string }> = {
  "required-before-launch": { color: "var(--color-warning)", border: "var(--color-warning)" },
  required: { color: "var(--color-warning)", border: "var(--color-warning)" },
  default: { color: "var(--color-text-muted)", border: "var(--color-divider)" },
};

export interface SetupFieldProps {
  label: string;
  mark: Mark | null;
  /** The value, or the control that edits it. */
  children: ReactNode;
  /** The app's proposal, when there is one. */
  dflt: DefaultOf | null;
  /** Whether the value is the proposal now: the source is shown, and the way back is not offered. */
  isDefault: boolean;
  /** Opens the control. Null when the value cannot be changed here. */
  onChange: (() => void) | null;
  onUseDefault: (() => void) | null;
}

export function SetupField({ label, mark, children, dflt, isDefault, onChange, onUseDefault }: SetupFieldProps) {
  const offerDefault = dflt !== null && !isDefault && onUseDefault !== null;
  const button = {
    background: "none",
    border: "none",
    padding: 0,
    color: "var(--color-accent)",
    font: "inherit",
    textDecoration: "underline",
    cursor: "pointer",
    minHeight: 44,
  } as const;
  return (
    <div
      data-setup-field={label}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "4px 16px",
        padding: "12px 0",
        borderBottom: "1px solid var(--color-divider)",
        color: "var(--color-text)",
      }}
    >
      <div style={{ flex: "0 0 210px", maxWidth: "100%", minWidth: 0, fontWeight: 600 }}>{label}</div>
      <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          {children}
          {mark !== null && (
            <span
              data-mark={mark}
              style={{
                marginLeft: 8,
                padding: "1px 8px",
                borderRadius: 999,
                border: `1px solid ${markStyle[mark].border}`,
                color: markStyle[mark].color,
                fontSize: "0.8125rem",
                whiteSpace: "nowrap",
              }}
            >
              {MARK_WORDS[mark]}
            </span>
          )}
        </div>
        {(onChange !== null || offerDefault) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0 16px", minWidth: 0 }}>
            {onChange !== null && (
              <button type="button" onClick={onChange} style={button}>
                Change
              </button>
            )}
            {offerDefault && dflt && (
              <button type="button" onClick={onUseDefault} style={button}>
                Use the default ({dflt.value})
              </button>
            )}
          </div>
        )}
        {dflt !== null && isDefault && <div style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem" }}>{dflt.source}</div>}
      </div>
    </div>
  );
}
