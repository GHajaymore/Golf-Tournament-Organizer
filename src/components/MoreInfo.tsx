import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * A SHORT LINE, AND THE LONG ONE AN ⓘ AWAY — Ajay, 2026-10-05: "why don't we
 * provide a short and long details where long is an info icon away".
 *
 * The short line is what a player reads standing on a tee: it carries the
 * meaning on its own, every visit. The full explanation — the privacy promise
 * word for word, the deadline rules, who pays for a text — is one tap on the
 * line or its ⓘ, never gone. Platform `<details>`, so it needs no JavaScript,
 * a screen reader announces it as expandable, and the long text stays in the
 * page (every test pinning those words still reads them).
 *
 * This replaced `OnceTip`, which opened the long text in full on a first
 * visit. With a short line always there, nothing needs to open itself.
 */
export function MoreInfo({
  short,
  children,
  style,
  warn = false,
}: {
  /** One line that stands on its own. Aim for under ten words. */
  short: ReactNode;
  /** The full explanation, behind the ⓘ. */
  children: ReactNode;
  style?: CSSProperties;
  /** A warning rather than a footnote: the short line in the warning colour. */
  warn?: boolean;
}) {
  return (
    <details className="more-info" style={{ margin: 0, ...style }}>
      <summary
        className="touch-target"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          listStyle: "none",
          fontSize: 14,
          lineHeight: 1.45,
          color: warn ? "var(--color-warning)" : "var(--color-neutral-400)",
          fontWeight: warn ? 600 : undefined,
        }}
      >
        {warn && <Icon name="warning-circle" aria-hidden style={{ flex: "none" }} />}
        <span>{short}</span>
        <Icon
          name="info"
          aria-label="More"
          style={{ flex: "none", fontSize: 16, color: "var(--color-accent-200)" }}
        />
      </summary>
      <div style={{ fontSize: 14, lineHeight: 1.55, color: "var(--color-neutral-400)", marginTop: 4 }}>{children}</div>
    </details>
  );
}
