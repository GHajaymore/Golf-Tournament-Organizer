/**
 * Jump-to navigation for a long settings screen.
 *
 * Club settings is 11,000px tall — eight independent areas (identity and
 * branding, club colour, house defaults, handicaps, money, plan, staff,
 * access) stacked in one column with nothing between them but a gap. An
 * organizer who came to change the currency scrolled past a 3,700px colour
 * picker to find it, and had no way of knowing the money section existed until
 * they arrived at it.
 *
 * The sections themselves are fine. What was missing was any way to see what
 * the page CONTAINS without reading all of it.
 *
 * A nav rather than collapsing every section, for two reasons that are about
 * this page specifically:
 *
 *   - every section already carries its own heading inside its own card, so a
 *     collapsing wrapper would have put a second title above each one;
 *   - several hold unsaved drafts behind a Save button, and a disclosure that
 *     unmounts its children throws a draft away silently.
 *
 * Anchors have neither problem, need no client JavaScript, and leave every
 * section exactly as it was.
 */

export interface SettingsSection {
  /** The `id` on the section this jumps to. */
  id: string;
  /** What the section calls itself. Written once, here and on the section. */
  label: string;
}

export function SettingsNav({ sections }: { sections: readonly SettingsSection[] }) {
  return (
    <nav
      aria-label="Sections on this page"
      className="card elev-sm"
      style={{
        // Sticky, because the question "where else can I go" is asked from
        // half way down a page this long, not only from the top.
        position: "sticky",
        top: 0,
        zIndex: 2,
        marginBottom: 16,
        gap: 8,
      }}
    >
      <span className="card-kicker">On this page</span>
      {/* Scrolls sideways inside itself at narrow widths rather than wrapping
          into four rows of chips, which would cost more height than it saves.
          The page body never scrolls sideways; this container does. */}
      <div style={{ overflowX: "auto", margin: "0 -2px", padding: "0 2px" }}>
        <ul
          style={{
            display: "flex",
            gap: 6,
            listStyle: "none",
            margin: 0,
            padding: 0,
            minWidth: "min-content",
          }}
        >
          {sections.map((s) => (
            <li key={s.id} style={{ flex: "none" }}>
              <a
                href={`#${s.id}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  minHeight: 36,
                  padding: "7px 11px",
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  textDecoration: "none",
                  color: "var(--color-text)",
                  border: "1px solid var(--color-divider)",
                }}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

/**
 * A landing spot for one of those links.
 *
 * `scrollMarginTop` is the whole reason this is a component rather than a bare
 * `id` on a div: the nav above is sticky, so an anchor that scrolls to the top
 * of the viewport lands UNDERNEATH it, and the reader arrives at a section
 * whose heading is hidden by the thing they clicked.
 *
 * 118px, measured: the nav is 102px tall when stuck, and the first check of
 * this landed the section six pixels under it. The extra is headroom, not a
 * guess — a heading flush against the bar reads as clipped.
 */
export function SettingsSectionAnchor({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} style={{ marginTop: 16, scrollMarginTop: 118 }}>
      {children}
    </section>
  );
}
