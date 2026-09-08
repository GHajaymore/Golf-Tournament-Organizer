import Link from "next/link";
import { Icon } from "./Icon";

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
export function SetupChecklist({
  items,
  currentPath,
}: {
  items: ChecklistItem[];
  /**
   * The path this checklist is being rendered on.
   *
   * A step whose href IS this page must not be a link — the same rule
   * `OrgSetupChecklist` already states, and for the same reason: on `/event`
   * the "Tournament details" row points at the screen it is drawn on, so as a
   * link it goes nowhere.
   *
   * The row still renders and still counts. It is a real step, and on `/event`
   * it is usually the step being DONE at that moment; dropping it would
   * understate the work and make the two screens disagree about what the list
   * contains, which is what `SETUP_ORDER` was just introduced to stop. Only
   * the link is wrong, so only the link goes.
   */
  currentPath?: string;
}) {
  return (
    <div className="card elev-sm" style={{ gap: 4 }}>
      <span className="card-title" style={{ fontSize: 15, marginBottom: 4 }}>Setup checklist</span>
      {items.map((it) => {
        // Query strings and hashes are not part of "which page is this".
        const here = currentPath !== undefined && it.href.split(/[?#]/)[0] === currentPath;
        const rowStyle = {
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "9px 6px",
          borderRadius: "var(--radius-md)",
        } as const;
        const Row = here
          ? ({ children }: { children: React.ReactNode }) => <div style={rowStyle}>{children}</div>
          : ({ children }: { children: React.ReactNode }) => (
              <Link href={it.href} className="link-reset" style={rowStyle}>
                {children}
              </Link>
            );
        return (
          <Row key={it.href}>
          <Icon name={it.done ? "ph-fill ph-check-circle" : "ph ph-circle-dashed"}
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
          {/* No arrow on the row you are already on: it is the affordance that
              says "this goes somewhere", and here it does not. */}
          {!here && <Icon name="arrow-right" style={{ color: "var(--color-neutral-500)" }} />}
          </Row>
        );
      })}
    </div>
  );
}
