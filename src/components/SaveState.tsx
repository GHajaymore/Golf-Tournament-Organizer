"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/**
 * "Did that save?"
 *
 * The round cards on Rounds & formats save on change: pick a format, pick
 * nine holes, pick a scoring basis, and each fires a server action inside a
 * transition. Every one of them works. NOT ONE of them says so — the control
 * shows the new value the instant it is clicked, because that is local state,
 * and it would show exactly the same thing if the action had never been
 * called. There is no button to press and therefore nothing that ever changes
 * from "Save" to "Saved", which is the only feedback a form normally has.
 *
 * An organizer's only way to find out was to reload the page, and somebody
 * who is not sure their settings stuck does not trust the app with a
 * tournament. Auto-saving without saying so is worse than a Save button: it
 * removes the click AND the confirmation, and keeps only the doubt.
 *
 * So: three states, in the same corner, every time.
 *
 *   saving   the transition is running
 *   saved    it finished, and it says so for a few seconds
 *   idle     nothing has been touched since the page loaded
 *
 * It is deliberately quiet. This is confirmation, not celebration — it sits at
 * 11.5px in muted colour beside the thing that changed, and it goes away.
 */
export type SaveStatus = "idle" | "saving" | "saved";

/** How long "Saved" stays up. Long enough to be read after looking away from
 *  the control, short enough not to become part of the furniture. */
const SAVED_MS = 2400;

/**
 * Derive the badge's state from a transition's `pending`.
 *
 * Takes `pending` rather than wrapping the actions, so a card with eight
 * controls needs one line rather than eight — and so a control added later
 * reports through it without anybody remembering to. The same reason the tee
 * sheet reads the nav for its routes instead of listing them.
 */
export function useSaveStatus(pending: boolean): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const wasPending = useRef(false);

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      setStatus("saving");
      return;
    }
    // Only on the FALLING edge. Without this the badge would announce "Saved"
    // on first render of every card on the screen, having saved nothing.
    if (!wasPending.current) return;
    wasPending.current = false;
    setStatus("saved");
    const t = setTimeout(() => setStatus("idle"), SAVED_MS);
    return () => clearTimeout(t);
  }, [pending]);

  return status;
}

/**
 * The badge itself.
 *
 * `aria-live="polite"` because this is the whole of the feedback: a screen
 * reader user gets no visual cue that a select saved either, and polite is
 * right — it should be read after whatever the user is doing, never over it.
 *
 * Renders an empty live region when idle rather than nothing at all, so the
 * region exists before it has anything to announce. A live region created at
 * the same moment its content arrives is not reliably announced.
 */
export function SaveState({ status, label = "Saved" }: { status: SaveStatus; label?: string }) {
  return (
    <span
      aria-live="polite"
      className="text-muted"
      style={{
        fontSize: 11.5,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        // Held rather than collapsed, so the row does not jump by a few pixels
        // every time something saves.
        minHeight: 16,
        opacity: status === "idle" ? 0 : 1,
        transition: "opacity 140ms ease",
      }}
    >
      {status === "saving" && (
        <>
          <Icon name="circle-notch" /> Saving…
        </>
      )}
      {status === "saved" && (
        <>
          <Icon name="check-circle" weight="fill" style={{ color: "var(--color-accent-2)" }} /> {label}
        </>
      )}
    </span>
  );
}
