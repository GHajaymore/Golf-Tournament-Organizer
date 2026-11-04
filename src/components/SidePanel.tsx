"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
 * DOCKED, AND THEN NOT MODAL (`dock`, 2 Nov): from `SIDE_PANEL_DOCK_FROM` px wide the panel is
 * a column beside the list, and a column beside a list is not a dialog. It is a named region; the
 * page is not locked; the list behind it takes presses (`pointer-events` in design-system.css), so
 * a press on another round switches the panel to it in ONE press instead of two (the first only
 * closed it). Escape and its Close button still close it. Below that width it is the dialog above.
 *
 * Saving is the caller's: most organizer controls save as they change (`SaveState`), so the
 * footer is optional and usually just says it is saved.
 */
/**
 * The width the panel docks from. The docked styles' `@media (min-width: 1280px)` is the same
 * number; they live in `src/app/(app)/stages/rounds-timeline.css`, sent only with the Rounds screen,
 * the one caller that docks. A second caller that docks imports that sheet's rules or moves them.
 */
export const SIDE_PANEL_DOCK_FROM = 1280;

/** Whether the screen is wide enough to dock. False on the server and the first render (a dialog). */
function useDocked(enabled: boolean): boolean {
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(`(min-width: ${SIDE_PANEL_DOCK_FROM}px)`);
    const sync = () => setDocked(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [enabled]);
  return enabled && docked;
}

export function SidePanel({
  open,
  title,
  kicker,
  onClose,
  children,
  footer,
  keepMounted = false,
  dock = false,
}: {
  /**
   * Dock beside the page from `SIDE_PANEL_DOCK_FROM` px: not modal there, the list stays usable.
   * Rounds & formats' timeline asks for it; a panel with nothing worth using behind it need not.
   */
  dock?: boolean;
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
  const docked = useDocked(dock);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const node = panel.current;
    node?.focus();
    // The page behind does not scroll under a finger on the panel (a phone's rubber-band scroll
    // would otherwise move the list behind it). Docked, the list is meant to be used: not locked.
    const overflow = document.body.style.overflow;
    if (!docked) document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      // Only when nothing inside has taken the key: a dialog opened over the panel (a delete
      // confirmation) closes first, on its own Escape.
      if (e.key === "Escape" && !e.defaultPrevented) closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      // Focus goes back to the opener only when it was in the panel (or lost with it). Docked, a
      // press on another round has already put focus on THAT round: taking it back to this one's
      // opener would make the next panel remember the wrong round.
      const active = document.activeElement;
      const lost = !active || active === document.body || !!node?.contains(active);
      if (lost && opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open, docked]);

  if (!open && !keepMounted) return null;
  return (
    <div
      className="side-panel-backdrop"
      hidden={!open}
      // Docked, the backdrop lets presses through to the list (design-system.css), so there is no
      // "outside" to press: the list's own buttons are what is pressed.
      data-dock={dock ? "" : undefined}
      onClick={docked ? undefined : onClose}
    >
      <div
        ref={panel}
        className="side-panel"
        role={docked ? "region" : "dialog"}
        aria-modal={docked ? undefined : "true"}
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
