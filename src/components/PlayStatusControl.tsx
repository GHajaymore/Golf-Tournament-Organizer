"use client";
import { useEffect, useRef, useState } from "react";
import { resumePlay, suspendPlay } from "@/app/actions/play-status";
import { MAX_SUSPEND_NOTE, alertsOffWords } from "@/lib/domain/play-status";
import "./play-status-control.css";
import { Icon } from "./Icon";
import { useAction } from "./useAction";
import { formatClock } from "@/lib/domain/locale";

/**
 * The organizer's half of "play suspended" (Rule 5.7): one button to stop the
 * field, one to start it again. Two taps to suspend — the button, then the
 * confirm with an optional reason — because it buzzes every phone in the
 * field. And two to resume, the button then "Resume play now" (decided by the
 * PM for the TD, 14 Nov, review of #1149 C3): it used to be one, "because by
 * then everybody is waiting on it", but that was when it lived on one screen.
 * On every console screen it is the primary button at the top, and a stray
 * tap sends the field back out into the lightning: an accidental suspend is
 * safe, an accidental resume is not.
 *
 * ON A PHONE, ONE CONTROL, TWO PLACES (B64, Rule 5.7): with play on, the very
 * same button is drawn compact in the sticky top bar (`.suspend-compact`, CSS
 * only: fixed over the bar's right end, 44px, never scrolling away), and its
 * confirm opens as a sheet pinned to the top of the window
 * (`.suspend-confirm`), so a committee member far down a long screen suspends
 * in the same two presses and no second copy of the rule exists. Above 820px
 * both are the ordinary rows they always were.
 *
 * Drawn on every console screen by the shell (`ConsolePlayStatus`), never by
 * a page. `alertsOff` is the names of the players the alarm will not reach
 * (F-2, from `noticesOffAmong`): said on the confirm, before the press, so the
 * TD knows whom to tell by voice or horn. Absent, the confirm says nothing.
 */
export function PlayStatusControl({
  suspended,
  note,
  since,
  alertsOff = [],
}: {
  suspended: boolean;
  note: string;
  since: string;
  alertsOff?: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [why, setWhy] = useState("");
  const { pending, error, run } = useAction();
  const close = () => {
    setOpen(false);
    setResuming(false);
  };
  /**
   * A confirm is about the suspension it was opened on. When the server's
   * state moves under it (another staff member resumed, or resumed and
   * suspended again — `PlayStatusFrame` brings that in), it closes, so a
   * Resume confirmed for an old storm can never lift a new one.
   */
  useEffect(() => {
    setOpen(false);
    setResuming(false);
  }, [suspended, since]);
  /**
   * A confirm that opens is brought fully into view: inside the shell's
   * sticky frame, which scrolls within itself once it is taller than the room
   * between the phone's bars, its button must never sit behind the tab bar
   * during a lightning stop (re-review of #1149, S1.2).
   */
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open || resuming) confirmButton.current?.scrollIntoView({ block: "nearest" });
  }, [open, resuming]);
  /**
   * The suspend confirm is an overlay on a phone (B64): focus moves into it when it opens
   * (the sheet itself, never the reason input, which would raise the keyboard over a lightning
   * stop, and never the confirm button, which would make Enter the second press), and back to
   * Suspend play when it closes. Escape closes it.
   */
  const sheet = useRef<HTMLFormElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) sheet.current?.focus({ preventScroll: true });
    else if (wasOpen.current) trigger.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);
  /**
   * The time on the ORGANIZER'S clock, so only in the browser. Formatted on
   * the server it would be the server's zone (UTC in production) and then a
   * different string after hydration.
   */
  const [at, setAt] = useState("");
  useEffect(() => {
    setAt(since ? formatClock(new Date(since), undefined, { hour: "numeric", minute: "2-digit" }) : "");
  }, [since]);

  if (suspended) {
    return (
      <section
        role="alert"
        className="card"
        style={{ marginBottom: 20, borderColor: "var(--color-danger)", display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}
      >
        <div style={{ minWidth: 0 }}>
          {/* The time arrives after hydration (the organizer's clock), into room
              kept for it from the first paint, so the banner — the top of a
              sticky band — does not grow and push the screen down when it does. */}
          <strong style={{ color: "var(--color-danger)", display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 6 }}>
            <Icon name="warning" /> Play is suspended
            <span style={{ whiteSpace: "nowrap", minWidth: "16ch" }}>{at ? ` since ${at}` : "\u00a0"}</span>
          </strong>
          <p className="text-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            {note ? `${note}. ` : ""}Every player has been told to stop, on their phone and on the public board.
          </p>
        </div>
        {resuming ? (
          <div style={{ flexBasis: "100%", display: "grid", gap: 8 }}>
            <strong>Resume play for the whole field?</strong>
            <p style={{ margin: 0, fontSize: 13 }}>
              Players will be told to play on, from where they stopped, on their phones and on the public board.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button ref={confirmButton} type="button" className="btn btn-primary" disabled={pending} onClick={() => run(resumePlay, close)}>
                {pending ? "Resuming…" : "Resume play now"}
              </button>
              <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setResuming(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setResuming(true)}>
            Resume play
          </button>
        )}
        {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--color-danger)", flexBasis: "100%" }}>{error}</p>}
      </section>
    );
  }

  if (!open) {
    return (
      <div className="suspend-compact" style={{ marginBottom: 20 }}>
        <button ref={trigger} type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
          <Icon name="warning" /> Suspend play
        </button>
      </div>
    );
  }

  return (
    <form
      ref={sheet}
      role="alertdialog"
      aria-labelledby="suspend-confirm-title"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !pending) setOpen(false);
      }}
      className="card suspend-confirm"
      style={{ marginBottom: 20, display: "grid", gap: 10, borderColor: "var(--color-danger)" }}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => suspendPlay(why), close);
      }}
    >
      <strong id="suspend-confirm-title">Suspend play for the whole field?</strong>
      <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
        Every player gets a notification to stop now, and every screen and the public board say so until you
        resume play.
      </p>
      {alertsOff.length > 0 && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-danger)" }}>{alertsOffWords(alertsOff)}</p>
      )}
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        Reason (optional)
        <input
          className="input"
          value={why}
          maxLength={MAX_SUSPEND_NOTE}
          placeholder="e.g. Lightning in the area — go to the clubhouse"
          onChange={(e) => setWhy(e.target.value)}
        />
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          ref={confirmButton}
          type="submit"
          className="btn btn-primary"
          disabled={pending}
          // The theme's danger pair, which reads on both grounds (see the banner).
          style={{ background: "var(--color-danger-bg)", borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
        >
          {pending ? "Suspending…" : "Suspend play now"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--color-danger)" }}>{error}</p>}
    </form>
  );
}
