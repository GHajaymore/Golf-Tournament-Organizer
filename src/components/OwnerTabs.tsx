import Link from "next/link";

/**
 * THE OWNER CONSOLE'S SECTIONS, each at its own address.
 *
 * `/owner` was one long page. The sections are now links to `/owner?tab=…`, so a
 * reload, a bookmark and an email link all land on the section they mean, and a
 * screen reader hears a navigation landmark whose current page is marked
 * (`aria-current`). They are LINKS, not script: nothing here can leave the
 * console half-drawn, and the keyboard is the browser's (Tab, Enter). The row
 * scrolls sideways on a narrow phone rather than wrapping into a stack.
 *
 * The owner-only guard is the page's, applied before any section is chosen.
 */

export const OWNER_TABS = [
  { key: "overview", label: "Overview", about: "The numbers: clubs, tournaments, players." },
  { key: "plans", label: "Plans & pricing", about: "Prices by region, limits, passes, the seasonal plan, a club's plan, discount codes." },
  { key: "accounts", label: "Accounts & launch", about: "The go-live switch, and who registered interest." },
  { key: "content", label: "Content", about: "The demo club and the course catalogue." },
  { key: "finance", label: "Finance", about: "A record of what TourneyHQ earned and spent: costs you type, rates, the projection kept apart." },
] as const;

export type OwnerTabKey = (typeof OWNER_TABS)[number]["key"];

/** A tab from the address; anything unknown is the overview. */
export function ownerTabFrom(raw: string | string[] | undefined): OwnerTabKey {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return OWNER_TABS.find((t) => t.key === v)?.key ?? "overview";
}

export function OwnerTabs({ current }: { current: OwnerTabKey }) {
  return (
    <nav aria-label="Owner console sections" style={{ margin: "12px 0 4px", overflowX: "auto" }}>
      <ul style={{ display: "flex", gap: 6, listStyle: "none", margin: 0, padding: 0, minWidth: "max-content", borderBottom: "1px solid var(--color-divider)" }}>
        {OWNER_TABS.map((t) => {
          const on = t.key === current;
          return (
            <li key={t.key}>
              <Link
                href={`/owner?tab=${t.key}`}
                aria-current={on ? "page" : undefined}
                title={t.about}
                className="touch-target"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "10px 14px",
                  fontSize: 14,
                  fontWeight: on ? 600 : 500,
                  color: on ? "var(--color-text)" : "var(--color-text-muted)",
                  borderBottom: on ? "2px solid var(--color-accent)" : "2px solid transparent",
                  marginBottom: -1,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
