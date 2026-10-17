"use client";
import { useState, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * WHAT IS LEFT TO SORT OUT ON A SETUP SCREEN, IN ONE CARD (2026-10-16).
 *
 * Rounds & formats stacked a notice per problem above the rounds — a course card
 * missing (naming every round), rounds with no date, handicaps approximate, a
 * card nobody has checked — each a full card with its paragraph. Measured on a
 * ten-round league at 375px: the first round began 950px down, below the first
 * screen of a phone. Ajay: "pretty long specially for multi round tournament".
 *
 * One card now, one line per item; the line says what is wrong, a tap opens the
 * why and the fix. Nothing is hidden that was shown: every item's title is on
 * the screen, and a blocker keeps its colour.
 */
export interface SetupNotice {
  key: string;
  /** "block" stops a launch; "note" is advice. */
  tone: "block" | "note";
  /** One line: what is wrong. */
  title: string;
  /** The why and the fix, shown on a tap. */
  body: ReactNode;
}

export function SetupNotices({ items: given }: { items: SetupNotice[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (given.length === 0) return null;
  // What stops a launch comes first, whatever order a screen hands them in (the
  // tournament director on the review panel); otherwise the screen's own order.
  const items = [...given.filter((i) => i.tone === "block"), ...given.filter((i) => i.tone !== "block")];
  const blocks = items.filter((i) => i.tone === "block").length;
  return (
    <section
      aria-label="To sort out"
      className="card elev-sm"
      style={{
        marginBottom: 16,
        gap: 6,
        borderLeft: `3px solid ${blocks ? "var(--color-danger)" : "var(--color-accent)"}`,
      }}
    >
      <span className="card-kicker">
        {items.length} to sort out
        {blocks > 0 && ` — ${blocks} needed before launch`}
      </span>
      {items.map((n) => {
        const shown = open === n.key;
        return (
          <div key={n.key}>
            <button
              type="button"
              aria-expanded={shown}
              onClick={() => setOpen(shown ? null : n.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                minHeight: 44,
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "var(--color-text)",
                textAlign: "left",
                font: "inherit",
                fontSize: 14,
              }}
            >
              <Icon
                name={n.tone === "block" ? "warning-circle" : "info"}
                style={{ flex: "none", color: n.tone === "block" ? "var(--color-danger)" : "var(--color-accent-200)" }}
              />
              <span style={{ flex: 1, minWidth: 0, fontWeight: 500 }}>{n.title}</span>
              <Icon name={shown ? "caret-up" : "caret-down"} style={{ flex: "none", fontSize: 13, color: "var(--color-neutral-500)" }} />
            </button>
            {shown && <div style={{ fontSize: 13, lineHeight: 1.55, padding: "0 0 8px 24px" }}>{n.body}</div>}
          </div>
        );
      })}
    </section>
  );
}
