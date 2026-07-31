"use client";
import { useState, useRef, useTransition } from "react";
import { addSignup, removeSignup, importCsvSignups, setInviteMessage } from "@/app/actions/tournament";

interface Signup {
  id: string;
  name: string;
  handicap: number;
  seed: number;
}
interface EventInfo {
  name: string;
  capacity: number;
  regDeadline: string;
  inviteMessage: string;
  dates: string;
  course: string;
  city: string;
}

export function RegistrationClient({
  event,
  confirmed,
  waitlist,
}: {
  event: EventInfo;
  confirmed: Signup[];
  waitlist: Signup[];
}) {
  const [name, setName] = useState("");
  const [handicap, setHandicap] = useState("");
  const [invite, setInvite] = useState(event.inviteMessage);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const spotsLeft = Math.max(0, event.capacity - confirmed.length);
  const status = spotsLeft === 0 ? "Full — waitlist active" : "Open";

  const submitAdd = () => {
    if (!name.trim()) return;
    const h = parseFloat(handicap);
    startTransition(() => addSignup(name, Number.isFinite(h) ? h : 0));
    setName("");
    setHandicap("");
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    startTransition(() => importCsvSignups(text));
    if (fileRef.current) fileRef.current.value = "";
  };

  const sendWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(invite)}`, "_blank", "noopener");
  };
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const table = (rows: Signup[], title: string) => (
    <div className="card elev-sm">
      <span className="card-title" style={{ fontSize: 15 }}>{title} ({rows.length})</span>
      <table className="table" style={{ fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ width: 36 }}>#</th>
            <th>Player</th>
            <th style={{ textAlign: "right" }}>Handicap</th>
            <th style={{ width: 60 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="text-muted">{p.seed}</td>
              <td style={{ fontWeight: 500 }}>{p.name}</td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.handicap}</td>
              <td style={{ textAlign: "right" }}>
                <button
                  type="button"
                  className="btn btn-icon"
                  disabled={pending}
                  onClick={() => startTransition(() => removeSignup(p.id))}
                >
                  <i className="ph ph-x" />
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="text-muted" style={{ padding: "10px 6px" }}>
                None yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Setup</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Registration</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Open sign-up for this pilot. Confirmed players fill up to capacity in seed order; overflow waitlists.
        </p>
      </div>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Confirmed</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{confirmed.length}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>of {event.capacity} capacity</div>
        </div>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Waitlisted</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{waitlist.length}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>bumped in if a spot opens</div>
        </div>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Registration closes</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 18 }}>{event.regDeadline}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>groups lock after this date</div>
        </div>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Status</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, color: "var(--color-accent-200)" }}>{status}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>spots remaining: {spotsLeft}</div>
        </div>
      </div>

      <div className="card elev-sm" style={{ marginBottom: 16, gap: 12 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Invite players to sign up</span>
        <p className="text-muted" style={{ fontSize: 12, margin: "-4px 0 0" }}>
          Broadcast the sign-up message to your player group (e.g. a WhatsApp group) or copy it into any channel.
        </p>
        <div className="field">
          <label>Message</label>
          <textarea
            className="input"
            rows={3}
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            onBlur={() => startTransition(() => setInviteMessage(invite))}
            style={{ resize: "vertical", fontFamily: "inherit" }}
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={sendWhatsApp}>
            <i className="ph-fill ph-whatsapp-logo" /> Send via WhatsApp
          </button>
          <button type="button" className="btn btn-secondary" onClick={copyInvite}>
            <i className="ph ph-copy" /> {copied ? "Copied" : "Copy message"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, alignItems: "start" }}>
        <div className="card elev-sm" style={{ gap: 12 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Add a signup</span>
          <div className="field">
            <label>Player name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          </div>
          <div className="field">
            <label>Handicap</label>
            <input
              className="input"
              type="number"
              value={handicap}
              onChange={(e) => setHandicap(e.target.value)}
              placeholder="12.0"
            />
          </div>
          <button type="button" className="btn btn-primary btn-block" disabled={pending} onClick={submitAdd}>
            <i className="ph ph-plus" /> Add to field
          </button>
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
            Auto-confirms while under capacity; overflow goes to the waitlist.
          </p>
          <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 10 }}>
            <label className="btn btn-secondary btn-block" style={{ cursor: "pointer", justifyContent: "center" }}>
              <i className="ph ph-upload-simple" /> Import CSV
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
            </label>
            <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>Columns: name, handicap</p>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {table(confirmed, "Confirmed field")}
          {table(waitlist, "Waitlist")}
        </div>
      </div>
    </>
  );
}
