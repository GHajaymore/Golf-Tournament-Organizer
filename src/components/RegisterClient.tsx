"use client";
import { useState, useTransition } from "react";
import { registerForEvent, type RegisterResult } from "@/app/actions/register";
import type { ApprovalMode } from "@/lib/domain/registration-intake";
import type { RegistrationPrefill } from "@/lib/services/registration";

/**
 * The self-service registration form.
 *
 * A short, no-account form: name, email, handicap, and optional phone/tee. The
 * server is the authority on everything — capacity, the deadline, where the
 * entry lands — so this component's job is only to collect, show what the field
 * looks like right now, and report back what the server decided.
 */

interface Props {
  token: string;
  eventName: string;
  formatLabel: string;
  regDeadline: string;
  /** Field is full: a new entry waitlists. */
  waitlistOnly: boolean;
  /** Remaining confirmed places, or null for an unlimited field. */
  spotsLeft: number | null;
  approvalMode: ApprovalMode;
  prefill: RegistrationPrefill | null;
}

export function RegisterClient({
  token,
  eventName,
  formatLabel,
  regDeadline,
  waitlistOnly,
  spotsLeft,
  approvalMode,
  prefill,
}: Props) {
  const [name, setName] = useState(prefill?.name ?? "");
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [handicap, setHandicap] = useState(
    prefill && prefill.handicap !== 0 ? String(prefill.handicap) : "",
  );
  const [handicapType, setHandicapType] = useState(prefill?.handicapType === "9" ? "9" : "18");
  const [phone, setPhone] = useState(prefill?.phone ?? "");
  const [tee, setTee] = useState(prefill?.preferredTee ?? "");
  const [error, setError] = useState("");
  const [done, setDone] = useState<RegisterResult | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!name.trim()) {
      setError("Enter your name.");
      return;
    }
    if (!email.trim()) {
      setError("Enter your email.");
      return;
    }
    setError("");
    startTransition(async () => {
      const result = await registerForEvent(token, {
        name,
        email,
        handicap,
        handicapType,
        phone,
        preferredTee: tee,
      });
      if (!result.ok) {
        setError(result.error ?? "Something went wrong. Try again.");
        return;
      }
      setDone(result);
    });
  };

  // Confirmation — this IS the receipt (email is best-effort and deferred).
  if (done) {
    const heading = done.already
      ? "You're already registered"
      : done.status === "confirmed"
        ? "You're in!"
        : done.status === "waitlisted"
          ? "You're on the waitlist"
          : "Entry received";
    const detail = done.already
      ? `We already have you in the field for ${eventName}.`
      : done.status === "confirmed"
        ? `You're confirmed in the field for ${eventName}. Use this email to sign in.`
        : done.status === "waitlisted"
          ? "The field is full, so you're on the waitlist. We'll be in touch if a place opens up."
          : "Your entry is with the organizer for approval. You'll hear once it's confirmed.";
    const good = done.already || done.status === "confirmed";
    return (
      <div className="card elev-sm" style={{ alignItems: "center", textAlign: "center", gap: 10, padding: "26px 20px" }}>
        <i
          className={good ? "ph-fill ph-check-circle" : "ph ph-clock"}
          style={{ fontSize: 34, color: good ? "var(--color-accent-2-300, var(--color-accent))" : "var(--color-accent)" }}
        />
        <h2 style={{ fontSize: 20, margin: 0, fontFamily: "var(--font-heading)" }}>{heading}</h2>
        <p className="text-muted" style={{ fontSize: 13.5, margin: 0, maxWidth: 340 }}>{detail}</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* What the field looks like right now. */}
      <div
        className="card elev-sm"
        style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}
      >
        <i
          className={waitlistOnly ? "ph ph-hourglass-medium" : "ph ph-door-open"}
          style={{ fontSize: 18, color: waitlistOnly ? "var(--color-accent)" : "var(--color-accent-400)" }}
        />
        <span style={{ fontSize: 13, flex: 1, minWidth: 200 }}>
          {waitlistOnly ? (
            <strong>Field full — joining the waitlist</strong>
          ) : spotsLeft === null ? (
            "Open for entries"
          ) : (
            <>
              <strong>{spotsLeft}</strong> {spotsLeft === 1 ? "place" : "places"} left
            </>
          )}
          <span className="text-muted">
            {" · "}
            {formatLabel}
            {regDeadline ? ` · closes ${regDeadline}` : ""}
          </span>
        </span>
      </div>

      {approvalMode === "approve" && (
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          <i className="ph ph-info" /> Entries for this event are confirmed by the organizer, so yours will be
          held for approval.
        </p>
      )}

      <div className="card elev-sm" style={{ gap: 12 }}>
        <div className="field">
          <label>Your name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </div>
        <div className="field">
          <label>Email</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@email"
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div className="field">
            <label>Handicap index</label>
            <input
              className="input"
              value={handicap}
              onChange={(e) => setHandicap(e.target.value)}
              placeholder="e.g. 12.4"
              inputMode="decimal"
            />
          </div>
          <div className="field">
            <label>Index is a…</label>
            <select className="input" value={handicapType} onChange={(e) => setHandicapType(e.target.value)}>
              <option value="18">18-hole</option>
              <option value="9">9-hole</option>
            </select>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div className="field">
            <label>Phone <span className="text-muted">· optional</span></label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1…" />
          </div>
          <div className="field">
            <label>Preferred tee <span className="text-muted">· optional</span></label>
            <input className="input" value={tee} onChange={(e) => setTee(e.target.value)} placeholder="e.g. White" />
          </div>
        </div>

        <button type="button" className="btn btn-primary btn-block" disabled={pending} onClick={submit}>
          <i className="ph ph-check" /> {pending ? "Registering…" : waitlistOnly ? "Join the waitlist" : "Register"}
        </button>
        {error && (
          <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-danger, #e0665a)" }}>
            <i className="ph ph-warning-circle" /> {error}
          </p>
        )}
      </div>
    </div>
  );
}
