"use client";
import { useId, useState, useTransition } from "react";
import { Icon } from "./Icon";
import { useCaughtUp } from "./useAction";
import { saveEntryTerms, setEntriesOpen, setRegistrationApproval } from "@/app/actions/tournament";
import { formatDeadline, parseDeadlineIso, type EntriesOpen } from "@/lib/registration";
import { figureOr, readWhole } from "@/lib/domain/decimal-text";

/**
 * ENTRY TERMS — ONE PLACE FOR "ARE ENTRIES OPEN, UNTIL WHEN, HOW MANY, WITH
 * APPROVAL OR NOT" (the entries cleanup, 2026-11-05).
 *
 * A tournament office decides these together, before the notice goes out. They
 * were split across two steps: the window and the number on Tournament
 * details, approval and the sign-up link on Entries, with Entries showing the
 * deadline read-only and sending the organizer back to step one. Five controls
 * answered "are entries open?".
 *
 * Now: ONE state line ("Not open" / "Opens soon" / "Open" / "Closed", worded by
 * `entriesOpen`, the one rule), ONE primary button that its `action` names, and
 * under them the terms, saved together. Whether the sign-up link exists is no
 * longer a second switch: opening entries publishes it.
 */
export function EntryTermsCard({
  entries,
  regOpens,
  regDeadline,
  capacity,
  planLimit,
  approveMode,
  showApproval,
  locked,
  canAdd,
  isAdmin = true,
  locale,
}: {
  entries: EntriesOpen;
  /** The stored terms (the capacity as the organizer set it, not as the plan caps it). */
  regOpens: string;
  regDeadline: string;
  capacity: number;
  /** The plan's field limit where one is enforced, else null. */
  planLimit: number | null;
  approveMode: boolean;
  /** Optimistic approval mode, set inside the transition that saves it. */
  showApproval: (mode: string) => void;
  /** The setup lock: the terms and the approval mode are part of the shape; the open/close button is not. */
  locked: boolean;
  /**
   * Whether the organizer can still add players by hand — the field's add door
   * (`fieldDoors`), not the setup lock: after launch a stroke field still takes
   * a late entry while setup is locked (day-of field changes, PR A).
   */
  canAdd: boolean;
  /** Only an admin saves the terms (`saveEntryTerms` is admin-only); everyone on staff can press the open/close button. */
  isAdmin?: boolean;
  locale?: string;
}) {
  const fid = useId();
  const [pending, startTransition] = useTransition();
  const caughtUp = useCaughtUp();
  const [opens, setOpens] = useState(parseDeadlineIso(regOpens));
  // A deadline saved before the date picker existed is free text and shows empty; it is kept unless a day is picked.
  const [closes, setCloses] = useState(regDeadline);
  const [cap, setCap] = useState(capacity);
  const [saved, setSaved] = useState({ opens: parseDeadlineIso(regOpens), closes: regDeadline, cap: capacity });
  const [error, setError] = useState("");
  const [saidSaved, setSaidSaved] = useState(false);
  const dirty = opens !== saved.opens || closes !== saved.closes || cap !== saved.cap;
  const closed = !entries.open;
  // The terms are read-only for the setup lock and for anyone who is not an admin.
  const termsLocked = locked || !isAdmin;

  const press = (open: boolean) =>
    startTransition(async () => {
      setError("");
      try {
        const res = await setEntriesOpen(open);
        if (!res.ok) setError(res.error ?? "That didn’t save. Try again.");
      } catch {
        setError("That change was not saved. Check the connection and try again.");
      }
    });

  const save = () =>
    startTransition(async () => {
      setError("");
      setSaidSaved(false);
      try {
        const res = caughtUp(await saveEntryTerms({ regOpens: opens, regDeadline: closes, capacity: cap }));
        if (!res.ok) {
          setError(res.error ?? "That didn’t save. Try again.");
          return;
        }
        setSaved({ opens, closes, cap });
        setSaidSaved(true);
      } catch {
        setError("That change was not saved. Check the connection.");
      }
    });

  const tone = entries.open ? "var(--color-accent-200)" : "var(--color-danger)";

  return (
    <section
      aria-label="Entry terms"
      className="card elev-sm"
      style={{ marginBottom: 16, gap: 14 }}
    >
      <span className="card-kicker">Entries</span>

      {/* THE STATE LINE AND ITS ONE BUTTON. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Icon name={entries.open ? "ph ph-door-open" : "ph ph-lock-simple"} style={{ fontSize: 18, color: tone }} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, color: tone }}>{entries.label}</div>
          <div className="text-muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
            {entries.line}
            {closed && entries.state !== "closed-finished" && !entries.linkPublished && canAdd && (
              <>
                {" "}
                <strong>You can still add players below.</strong>
              </>
            )}
            {closed && entries.state !== "closed-finished" && entries.linkPublished && (
              <>
                {" "}
                {/* Adding by hand is never blocked by the dates; only by the field's add door. */}
                {!canAdd ? (
                  <>While it is closed the sign-up link turns everyone away.</>
                ) : (
                  <>
                    <strong>You can still add players below</strong> — while it is closed the sign-up link turns
                    everyone else away.
                  </>
                )}
              </>
            )}
          </div>
        </div>
        {entries.action && (
          <button
            type="button"
            className={entries.action.do === "open" ? "btn btn-primary" : "btn btn-secondary"}
            disabled={pending}
            onClick={() => press(entries.action!.do === "open")}
          >
            <Icon name={entries.action.do === "open" ? "ph ph-door-open" : "ph ph-lock-simple"} />
            {entries.action.label}
          </button>
        )}
      </div>

      {/* THE TERMS, SAVED TOGETHER. */}
      <div className="pair-grid">
        <div className="field">
          <label htmlFor={`${fid}-opens`}>Entries open</label>
          <input
            id={`${fid}-opens`}
            className="input"
            type="date"
            value={opens}
            max={parseDeadlineIso(closes) || undefined}
            disabled={pending || termsLocked}
            onChange={(e) => setOpens(e.target.value)}
          />
          <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
            {opens ? formatDeadline(opens, locale) : "Leave empty to open as soon as you open entries"}
          </p>
        </div>
        <div className="field">
          <label htmlFor={`${fid}-closes`}>Entries close</label>
          <input
            id={`${fid}-closes`}
            className="input"
            type="date"
            value={parseDeadlineIso(closes)}
            min={opens || undefined}
            disabled={pending || termsLocked}
            onChange={(e) => setCloses(e.target.value)}
          />
          <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
            {parseDeadlineIso(closes)
              ? `${formatDeadline(closes, locale)} — open until midnight at the club. Groups lock after it.`
              : "Leave empty to take entries until you close them"}
          </p>
        </div>
        <div className="field">
          <span className="field-caption" id={`${fid}-places`}>Places</span>
          <div style={{ display: "flex", gap: 8 }}>
            <div className="seg" role="group" aria-labelledby={`${fid}-places`}>
              <label className="seg-opt">
                <input type="radio" name={`${fid}-capmode`} checked={cap > 0} disabled={pending || termsLocked} onChange={() => setCap(cap > 0 ? cap : 32)} />
                Fixed
              </label>
              <label className="seg-opt">
                <input type="radio" name={`${fid}-capmode`} checked={cap <= 0} disabled={pending || termsLocked} onChange={() => setCap(0)} />
                Open
              </label>
            </div>
            {cap > 0 && (
              <input
                aria-label="Places in the field (players)"
                className="input"
                type="number"
                value={cap}
                max={planLimit ?? undefined}
                disabled={pending || termsLocked}
                onChange={(e) => setCap(figureOr(readWhole(e.target.value), 0))}
                style={{ width: 90 }}
              />
            )}
          </div>
          {planLimit !== null && (
            <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
              Your plan holds up to {planLimit} players, so an open field or anything larger takes {planLimit} while you
              are on it.
            </p>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" disabled={pending || termsLocked || !dirty} onClick={save}>
          <Icon name="check" /> {dirty ? "Save entry terms" : "Saved"}
        </button>
        {locked ? (
          <span className="text-muted" style={{ fontSize: 13 }}>
            The field is locked, so the terms are read-only. The banner at the top says why, and how an Organizer opens it.
          </span>
        ) : (
          !isAdmin && (
            <span className="text-muted" style={{ fontSize: 13 }}>
              Only an organizer can change the entry terms. You can still open and close entries.
            </span>
          )
        )}
        {saidSaved && !dirty && <span className="text-muted" style={{ fontSize: 13 }}>Saved.</span>}
      </div>

      {/* APPROVAL — auto-confirm to the places, or approve each entry. */}
      <div className="field">
        <span className="field-caption" id={`${fid}-approval`}>When someone enters</span>
        <div className="seg" role="group" aria-labelledby={`${fid}-approval`} style={{ width: "100%" }}>
          {[
            ["auto", "Auto-confirm to capacity"],
            ["approve", "Approve each entry"],
          ].map(([v, l]) => (
            <label className="seg-opt" key={v} style={{ flex: 1, justifyContent: "center" }}>
              <input
                type="radio"
                name={`${fid}-approval`}
                checked={approveMode ? v === "approve" : v === "auto"}
                disabled={pending || locked}
                onChange={() =>
                  startTransition(async () => {
                    setError("");
                    showApproval(v);
                    // Caught: these actions THROW on a refusal, and inside an async
                    // transition that goes to the error screen. The box falls back by itself.
                    try {
                      const res = caughtUp(await setRegistrationApproval(v));
                      if (!res.ok) setError(res.error ?? "That change was not saved.");
                    } catch {
                      setError("That change was not saved. Check the connection.");
                    }
                  })
                }
              />
              {l}
            </label>
          ))}
        </div>
        <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
          {approveMode
            ? "Every entry lands in “Pending approval” below for you to accept — nobody joins the field until you do."
            : "Entries fill the field up to the places and confirm automatically; once full, further entries go to the waitlist."}
        </p>
      </div>

      {error && (
        <p role="alert" className="form-error" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </section>
  );
}
