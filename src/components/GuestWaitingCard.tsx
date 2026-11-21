"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GUEST_WORDS } from "@/lib/domain/guest-entry";
import { formatClock } from "@/lib/domain/locale";
import { startWaitingRefresh } from "@/lib/waiting-refresh";
import { heldGuestCode } from "@/lib/guest-code-memory";
import { Icon } from "./Icon";

/**
 * THE WAITING SCREEN (J39/J40 PR 3B; design A4, N1). A guest whose entry the organizer has not yet confirmed sees
 * this and nothing else. It says, top to bottom: the event and its day; that the organizer needs to say yes; "At the
 * course? Show this screen at the desk."; when it last checked, with **Check now** (at least 48 px); and the guest's
 * own code, held in this page's memory from the answer to Ask to play (never server-rendered: C3.3).
 *
 * The check is `router.refresh()` of Today, resolved from the cookie with no argument (C3.1). It runs while the page
 * is visible, again on return, and on the button; when the entry is confirmed the layout draws Today instead and this
 * card is gone, which is what stops it for good (C3.2). A check made with no signal says so and keeps the screen.
 */
/** The phone's own clock, read only on the client when a check is made, never while rendering. */
const stamp = () => formatClock(new Date(), undefined, { hour: "2-digit", minute: "2-digit" });

export function GuestWaitingCard({ eventName, dates, extra }: { eventName: string; dates: string; extra?: string }) {
  const W = GUEST_WORDS;
  const router = useRouter();
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [noSignal, setNoSignal] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  const check = () => {
    // The phone's own word that it is offline: say so, keep what is on screen.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setNoSignal(true);
      return;
    }
    setNoSignal(false);
    router.refresh();
    setCheckedAt(stamp());
  };

  useEffect(() => {
    setCode(heldGuestCode());
    setCheckedAt(stamp());
    const stop = startWaitingRefresh({ doc: document, refresh: check });
    const online = () => check();
    window.addEventListener("online", online);
    return () => {
      stop();
      window.removeEventListener("online", online);
    };
    // The check closes over `router`, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card elev-sm" style={{ gap: 12, textAlign: "center", padding: "28px 20px" }} data-testid="guest-waiting">
      <h1 className="page-title" style={{ fontSize: 19, margin: 0 }}>
        {eventName}
      </h1>
      {dates && (
        <p className="text-muted" style={{ fontSize: 14, margin: 0 }}>
          {dates}
        </p>
      )}
      <p style={{ fontSize: 16, lineHeight: 1.5, margin: 0, fontWeight: 600 }}>{W.waitingLead}</p>
      <p style={{ fontSize: 14, lineHeight: 1.5, margin: 0 }}>{W.atTheCourse}</p>
      {extra && (
        <p className="text-muted" style={{ fontSize: 14, margin: 0 }}>
          {extra}
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
        {checkedAt && (
          <p className="text-muted" style={{ fontSize: 14, margin: 0 }} data-testid="last-checked">
            {W.lastChecked(checkedAt)}
          </p>
        )}
        {noSignal && (
          <p role="status" style={{ fontSize: 14, margin: 0 }} data-testid="no-signal">
            <Icon name="warning-circle" /> {W.noSignal}
          </p>
        )}
        <button type="button" className="btn btn-secondary" style={{ minHeight: 48, minWidth: 160, fontSize: 15 }} onClick={check}>
          {W.checkNow}
        </button>
      </div>
      {code && (
        <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 12 }} data-testid="guest-code">
          <p style={{ fontSize: 14, margin: "0 0 4px" }}>{W.saveCode}</p>
          <p style={{ fontSize: 22, fontWeight: 700, letterSpacing: "0.08em", margin: 0, fontVariantNumeric: "tabular-nums" }}>{code}</p>
          <p className="text-muted" style={{ fontSize: 14, margin: "4px 0 0" }}>
            {W.keepToYourself}
          </p>
        </div>
      )}
    </div>
  );
}
