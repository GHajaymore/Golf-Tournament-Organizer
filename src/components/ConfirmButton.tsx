"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/**
 * A destructive control that takes two taps.
 *
 * The money ledger had this and nothing else did, so the same fault was
 * sitting on nine other screens: an unlabelled trash icon, often beside a
 * harmless one, wired straight to an action that destroys a record with no
 * undo. On a phone the two are a thumb's width apart. "Delete season" was a
 * plain secondary button that ended a season on one press.
 *
 * Written once rather than nine times because it was already written twice —
 * the ledger's and the announcement composer's — and a third copy is how the
 * next one gets a slightly different answer.
 *
 * NOT a substitute for `window.confirm` everywhere. A modal is right when the
 * consequence needs a sentence to explain (removing players who have already
 * played is a WITHDRAWAL, and registration says so in a dialog). This is for
 * the ordinary case: one row, one irreversible verb, no explanation needed
 * beyond the word itself.
 */
export function ConfirmButton({
  onConfirm,
  confirmLabel,
  label,
  title,
  icon = "trash",
  keepLabel = "Keep",
  note,
  disabled = false,
  className = "btn btn-icon",
  style,
}: {
  onConfirm: () => void;
  /** The armed button's words. Say the verb and the thing: "Delete season". */
  confirmLabel: string;
  /** Resting label. Omit for an icon-only control. */
  label?: string;
  /** Resting tooltip, and the accessible name when there is no label. */
  title: string;
  icon?: string;
  keepLabel?: string;
  /**
   * One short line shown BESIDE the armed pair, for the reassurance or the
   * consequence that decides the answer — "rounds played keep their results".
   *
   * Visible text rather than a `title`, because the moment somebody is
   * deciding whether to go through with it is the moment they need to read it,
   * and a tooltip is not readable on the phone this is being tapped on. Two of
   * these were sitting in `no-tooltip-refusals`' known-debt list.
   */
  note?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [armed, setArmed] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);

  // Focus the SAFE option once the armed pair has actually rendered, not the
  // destructive one. A keyboard user who presses Enter twice — on a control
  // they reached with the keyboard in the first place — must land on "Keep";
  // focusing the confirm button would turn a double-press into exactly the
  // deletion this exists to prevent. In an effect rather than in the click
  // handler because the button being focused does not exist until the state
  // change has committed.
  useEffect(() => {
    if (armed) keepRef.current?.focus();
  }, [armed]);

  if (armed) {
    return (
      <>
        <button
          type="button"
          className="btn touch-target"
          style={{ fontSize: 12, color: "var(--color-danger)", whiteSpace: "nowrap" }}
          disabled={disabled}
          onClick={() => {
            setArmed(false);
            onConfirm();
          }}
        >
          <Icon name={icon} /> {confirmLabel}
        </button>
        <button
          ref={keepRef}
          type="button"
          className="btn btn-secondary touch-target"
          style={{ fontSize: 12 }}
          onClick={() => setArmed(false)}
        >
          {keepLabel}
        </button>
        {note && (
          <span className="text-muted" style={{ fontSize: 11.5, alignSelf: "center" }}>
            {note}
          </span>
        )}
      </>
    );
  }

  return (
    <button
      type="button"
      className={className}
      title={title}
      aria-label={label ? undefined : title}
      disabled={disabled}
      style={style}
      onClick={() => setArmed(true)}
    >
      <Icon name={icon} />
      {label ? ` ${label}` : ""}
    </button>
  );
}
