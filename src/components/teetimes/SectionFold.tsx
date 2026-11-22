"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * ONE SECTION OF TEE TIMES & DRAW (R9a). On a phone only two sections are open, the one marked Needs you
 * and the sheet itself; every other section is one folded line with its state ("Paper: printed 08:10")
 * (step 3 §2.2, finding 9). On a wider screen every section is open.
 *
 * Server-rendered open, then folded on mount where the screen is a phone: a page that arrives with its
 * sections open never hides a control from a person whose script has not run. `openOnPhone` is the
 * caller's answer (Needs you, or the sheet); this decides nothing about WHICH. The line is a button of
 * 48px or more; it is the section's heading, and the `id` is the anchor the round's needs link to.
 */
const PHONE = "(max-width: 640px)";

export function SectionFold({
  id,
  title,
  state,
  needsYou,
  openOnPhone,
  children,
}: {
  id: string;
  title: string;
  /** The section's state, said on its folded line: "No tee times yet", "Printed 08:10". */
  state: string;
  needsYou: boolean;
  openOnPhone: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current) return;
    decided.current = true;
    try {
      if (window.matchMedia(PHONE).matches && !openOnPhone) setOpen(false);
    } catch {
      /* no matchMedia: leave it open */
    }
  }, [openOnPhone]);
  const bodyId = `${id}-body`;
  return (
    <section id={id} data-draw-section={id} data-needs-you={needsYou ? "true" : "false"} style={{ minWidth: 0, scrollMarginTop: 80, marginTop: 16 }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
        className="btn btn-secondary"
        style={{
          display: "flex",
          width: "100%",
          minHeight: 48,
          minWidth: 0,
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: "2px 12px",
          textAlign: "left",
          color: "var(--color-text)",
        }}
      >
        <span style={{ fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>{title}</span>
        {needsYou && (
          <span style={{ fontSize: "0.8125rem", color: "var(--color-warning)", border: "1px solid var(--color-warning)", borderRadius: 999, padding: "1px 8px" }}>
            Needs you
          </span>
        )}
        <span className="text-muted" style={{ fontSize: "0.8125rem", minWidth: 0, overflowWrap: "anywhere" }}>
          {state}
        </span>
      </button>
      <div id={bodyId} hidden={!open} style={{ minWidth: 0, paddingTop: 12 }}>
        {children}
      </div>
    </section>
  );
}
