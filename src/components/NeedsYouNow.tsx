import Link from "next/link";
import type { ReactNode } from "react";
import type { NeedsYouItem } from "@/lib/domain/needs-you-now";
import { Icon } from "./Icon";

/**
 * "NEEDS YOU NOW" — the organizer's to-do list, at the top of the dashboard
 * (Ajay, 2026-10-05). One line per thing to do, each with the button that
 * goes and does it; `needsYouNow` decides the lines. `children` is for a
 * thing that needs more than a line — the cut, with its preview and its
 * two-tap approval (`CutReadyCard`).
 *
 * Renders nothing when there is nothing to do: an empty to-do list is not a
 * card worth a place at the top of the screen.
 */
export function NeedsYouNow({ items, children }: { items: NeedsYouItem[]; children?: ReactNode }) {
  if (items.length === 0 && !children) return null;
  return (
    <section aria-label="Needs you now" style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      {items.length > 0 && (
        <div className="card elev-sm" style={{ gap: 0, borderColor: "var(--color-accent-700)" }}>
          <span className="card-kicker" style={{ marginBottom: 4 }}>
            Needs you now
          </span>
          {items.map((item, i) => (
            <div
              key={item.key}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
                padding: "8px 0",
                borderTop: i === 0 ? "none" : "1px solid var(--color-divider)",
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 600, minWidth: 0 }}>
                {item.key === "disputed" && (
                  <Icon name="warning-circle" style={{ color: "var(--color-danger)", marginRight: 6 }} />
                )}
                {item.text}
              </span>
              <Link href={item.href} className="btn btn-secondary" style={{ minHeight: 44 }}>
                {item.action} <Icon name="arrow-right" />
              </Link>
            </div>
          ))}
        </div>
      )}
      {children}
    </section>
  );
}
