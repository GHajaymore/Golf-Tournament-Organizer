import Link from "next/link";

export interface ChecklistItem {
  label: string;
  detail: string;
  done: boolean;
  href: string;
  optional?: boolean;
}

/**
 * Guided path through Set-up: shows what's done, what's left, and where to go
 * next — so getting a new tournament off the ground doesn't require guessing
 * the right order of screens.
 */
export function SetupChecklist({ items }: { items: ChecklistItem[] }) {
  return (
    <div className="card elev-sm" style={{ gap: 4 }}>
      <span className="card-title" style={{ fontSize: 15, marginBottom: 4 }}>Setup checklist</span>
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          className="link-reset"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "9px 6px",
            borderRadius: "var(--radius-md)",
          }}
        >
          <i
            className={it.done ? "ph-fill ph-check-circle" : "ph ph-circle-dashed"}
            style={{
              fontSize: 20,
              color: it.done ? "var(--color-accent-2)" : "var(--color-neutral-500)",
              flex: "none",
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
              {it.label}
              {it.optional && <span className="tag tag-neutral" style={{ fontSize: 10 }}>Optional</span>}
            </div>
            <div className="text-muted" style={{ fontSize: 12 }}>{it.detail}</div>
          </div>
          <i className="ph ph-arrow-right" style={{ color: "var(--color-neutral-500)" }} />
        </Link>
      ))}
    </div>
  );
}
