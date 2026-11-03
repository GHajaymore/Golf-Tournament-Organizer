"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * ONE THING OPEN AT A TIME, BESIDE THE LIST IT CAME FROM.
 *
 * The redesign's way of editing (Ajay, 26 Oct): a list of one-line rows, and the one being
 * changed opens here — a panel at the right on a wide screen, the whole screen on a phone.
 * Rounds & formats had every round open at once, each with its customization inside it.
 *
 * MODAL, AND SAYS SO: `role="dialog"`, `aria-modal`, named by its title. Focus moves into it
 * when it opens and back to whatever opened it when it closes; Escape closes it. It scrolls
 * inside itself, so its footer (where Save or Done is) is never below the fold on a small
 * phone — the same rule the centred dialog keeps.
 *
 * Saving is the caller's: most organizer controls save as they change (`SaveState`), so the
 * footer is optional and usually just says it is saved.
 */
export function SidePanel({
  open,
  title,
  kicker,
  onClose,
  children,
  footer,
  keepMounted = false,
}: {
  /**
   * Keep the contents in the page, hidden, while closed. Rounds & formats needs it: every round's
   * controls stay in the document as they always have (`render.test`'s "keeps every control"), and
   * only the open round is shown. One rendered copy either way: never mount the same controls twice.
   */
  keepMounted?: boolean;
  open: boolean;
  title: string;
  /** A short line above the title: "Round 2 of 3". */
  kicker?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  // Held in a ref, not listed as a dependency: a caller's `onClose` is usually a new function on
  // every render, and the effect's cleanup would then hand focus back to the opener while the
  // panel was still open.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    panel.current?.focus();
    // The page behind does not scroll under a finger on the panel (a phone's rubber-band scroll
    // would otherwise move the list behind it).
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      // Only when nothing inside has taken the key: a dialog opened over the panel (a delete
      // confirmation) closes first, on its own Escape.
      if (e.key === "Escape" && !e.defaultPrevented) closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open]);

  if (!open && !keepMounted) return null;
  return (
    <div className="side-panel-backdrop" hidden={!open} onClick={onClose}>
      <div
        ref={panel}
        className="side-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="side-panel-head">
          <div style={{ minWidth: 0 }}>
            {kicker && <div className="side-panel-kicker">{kicker}</div>}
            <h2 className="side-panel-title" id={titleId}>
              {title}
            </h2>
          </div>
          <button type="button" className="btn btn-icon" aria-label={`Close ${title}`} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="side-panel-body">{children}</div>
        {footer && <div className="side-panel-foot">{footer}</div>}
      </div>
    </div>
  );
}
