"use client";
import { useEffect, useState } from "react";
import { resumePlay, suspendPlay } from "@/app/actions/play-status";
import { MAX_SUSPEND_NOTE } from "@/lib/domain/play-status";
import { Icon } from "./Icon";
import { useAction } from "./useAction";

/**
 * The organizer's half of "play suspended" (Rule 5.7): one button to stop the
 * field, one to start it again. Two taps to suspend — the button, then the
 * confirm with an optional reason — because it buzzes every phone in the
 * field; one to resume, because by then everybody is waiting on it.
 */
export function PlayStatusControl({ suspended, note, since }: { suspended: boolean; note: string; since: string }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  const { pending, error, run } = useAction();
  const close = () => setOpen(false);
  /**
   * The time on the ORGANIZER'S clock, so only in the browser. Formatted on
   * the server it would be the server's zone (UTC in production) and then a
   * different string after hydration.
   */
  const [at, setAt] = useState("");
  useEffect(() => {
    setAt(since ? new Date(since).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
  }, [since]);

  if (suspended) {
    return (
      <section
        role="alert"
        className="card"
        style={{ marginBottom: 20, borderColor: "var(--color-danger)", display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}
      >
        <div style={{ minWidth: 0 }}>
          <strong style={{ color: "var(--color-danger)", display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="warning" /> Play is suspended{at ? ` since ${at}` : ""}
          </strong>
          <p className="text-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            {note ? `${note}. ` : ""}Every player has been told to stop, on their phone and on the public board.
          </p>
        </div>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(resumePlay, close)}>
          {pending ? "Resuming…" : "Resume play"}
        </button>
        {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--color-danger)", flexBasis: "100%" }}>{error}</p>}
      </section>
    );
  }

  if (!open) {
    return (
      <div style={{ marginBottom: 20 }}>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
          <Icon name="warning" /> Suspend play
        </button>
      </div>
    );
  }

  return (
    <form
      className="card"
      style={{ marginBottom: 20, display: "grid", gap: 10, borderColor: "var(--color-danger)" }}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => suspendPlay(why), close);
      }}
    >
      <strong>Suspend play for the whole field?</strong>
      <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
        Every player gets a notification to stop now, and every screen and the public board say so until you
        resume play.
      </p>
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
