"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { endCorrection, openCorrection } from "@/app/actions/tournament";
import { CORRECTION_REASON, SCOPE_WORDS, correctionWords, type CorrectionFacts, type LockScope } from "@/lib/domain/tournament-status";
import { Icon } from "./Icon";

/**
 * THE COMMITTEE CORRECTION, AS THE ORGANIZER PRESSES IT (state machine PR 5b;
 * TD Q2, panel 8.1). It replaces the blanket "Unlock configuration" / "Unlock
 * setup": one scope, a reason that goes in Recent changes, closed at Done or
 * at the end of the club's day. Drawn on the dashboard's status card and on
 * every `ScopeLockBanner`, so the way out is where the lock is said.
 *
 * Two pieces. `CorrectionButton` opens one: a dialog that asks which part
 * (preselected from the banner it was pressed on) and why. `CorrectionOpenLine`
 * is the banner's line while one is open — "Open for a correction by A.
 * Organizer: ‘Wrong flight for one player’ · Done".
 */

export const CORRECTION_BUTTON = "Make a committee correction";

export function CorrectionButton({ scopes, className = "btn btn-secondary" }: { scopes: readonly LockScope[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<LockScope>(scopes[0]);
  const [reason, setReason] = useState("");
  const [refused, setRefused] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (scopes.length === 0) return null;
  const chosen = scopes.includes(scope) ? scope : scopes[0];
  const close = () => {
    setOpen(false);
    setRefused("");
  };
  return (
    <>
      <button type="button" className={className} disabled={pending} onClick={() => setOpen(true)}>
        <Icon name="lock-simple-open" /> {CORRECTION_BUTTON}
      </button>
      {open && (
        <div className="dialog-backdrop" onClick={close}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="correction-dialog-title" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title" id="correction-dialog-title">{CORRECTION_BUTTON}</div>
            <div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
                This is a committee correction. Your name and your reason go in Recent changes. It opens one part of setup until you
                press Done, or until the end of today at the club.
              </p>
              <div className="field">
                <label htmlFor="correction-scope">Open which part</label>
                <select id="correction-scope" value={chosen} onChange={(e) => setScope(e.target.value as LockScope)} disabled={scopes.length === 1}>
                  {scopes.map((s) => (
                    <option key={s} value={s}>
                      {SCOPE_WORDS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="correction-reason">Why</label>
                <textarea
                  id="correction-reason"
                  rows={3}
                  value={reason}
                  maxLength={CORRECTION_REASON.max}
                  placeholder="e.g. Wrong flight for one player"
                  onChange={(e) => setReason(e.target.value)}
                />
                <span className="text-muted" style={{ fontSize: 13 }}>
                  {CORRECTION_REASON.min} to {CORRECTION_REASON.max} characters.
                </span>
              </div>
              {refused && (
                <p role="alert" className="form-error" style={{ margin: 0 }}>
                  {refused}
                </p>
              )}
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={close} disabled={pending}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending || reason.trim().length < CORRECTION_REASON.min}
                onClick={() =>
                  startTransition(async () => {
                    const res = await openCorrection(chosen, reason);
                    if (!res.ok) {
                      setRefused(res.error ?? "That could not be opened.");
                      return;
                    }
                    setReason("");
                    close();
                    router.refresh();
                  })
                }
              >
                <Icon name="lock-simple-open" /> Open it for a correction
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function CorrectionOpenLine({ correction, isAdmin }: { correction: CorrectionFacts; isAdmin: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <p role="status" style={{ margin: 0, fontSize: 14, lineHeight: 1.5, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span>
        <b>{SCOPE_WORDS[correction.scope]}</b> · {correctionWords(correction)}
      </span>
      {isAdmin && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await endCorrection();
              router.refresh();
            })
          }
        >
          <Icon name="check" /> Done
        </button>
      )}
    </p>
  );
}
