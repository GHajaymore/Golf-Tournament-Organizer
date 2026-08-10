"use client";
import { useEffect, useId, useRef, useState } from "react";

/**
 * The "why does this field work like that" explanation, on demand.
 *
 * Tournament setup is full of fields whose *shape* is obvious and whose
 * *meaning* is not: a handicap allowance, a cut taken per flight rather than
 * overall, carry-forward across two rounds measured in different units. The
 * short instruction that gets someone through the field belongs next to it,
 * visible. The paragraph explaining what the setting actually does to their
 * tournament does not — it would bury the form.
 *
 * Two rules this component exists to keep:
 *
 *  - It opens on *tap*, not hover. The app is used one-handed on a phone
 *    standing on a tee box, and hover tooltips — including the native
 *    `title` attribute — simply do not exist there. A control that only
 *    reveals itself to a mouse is invisible to the people most likely to
 *    need it.
 *  - It holds the explanation, never the instruction. Anything a person
 *    needs in order to answer the field correctly stays visible beside it.
 *    Hiding that behind a click makes the form worse, not tidier.
 *
 * The copy itself is passed in from wherever the behaviour is defined, so an
 * explanation and the logic it describes cannot drift apart.
 */
export default function FieldInfo({
  label,
  children,
}: {
  /** What is being explained — announced to screen readers, since an "i" on
   *  its own tells someone using one nothing about what it opens. */
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrap = useRef<HTMLSpanElement>(null);

  // Escape closes from anywhere, and a tap outside dismisses. Both are what
  // people already expect; neither is worth making someone hunt for a close
  // button on a small screen.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  return (
    <span className="field-info" ref={wrap}>
      <button
        type="button"
        className="field-info-btn"
        aria-expanded={open}
        aria-controls={panelId}
        // "More about X" rather than "info": the accessible name has to say
        // what it explains, because the visible label is a single glyph.
        aria-label={`More about ${label}`}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8" cy="4.6" r="0.95" fill="currentColor" />
          <path d="M8 7.1 V11.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <span className="field-info-panel" id={panelId} role="note">
          {children}
        </span>
      )}
    </span>
  );
}
