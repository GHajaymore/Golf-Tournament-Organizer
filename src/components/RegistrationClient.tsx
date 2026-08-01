"use client";
import { useState, useRef, useTransition } from "react";
import { addSignup, removeSignup, importCsvSignups, setInviteMessage } from "@/app/actions/tournament";

interface Signup {
  id: string;
  name: string;
  handicap: number;
  seed: number;
  email?: string;
  phone?: string;
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
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [ghin, setGhin] = useState("");
  const [homeClub, setHomeClub] = useState("");
  const [hSource, setHSource] = useState("manual");
  const [invite, setInvite] = useState(event.inviteMessage);
  const [copied, setCopied] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const unlimited = event.capacity <= 0;
  const spotsLeft = unlimited ? Infinity : Math.max(0, event.capacity - confirmed.length);
  const status = unlimited ? "Open · unlimited" : spotsLeft === 0 ? "Full — waitlist active" : "Open";

  const submitAdd = () => {
    if (!name.trim()) return;
    const h = parseFloat(handicap);
    startTransition(() =>
      addSignup({
        name,
        handicap: Number.isFinite(h) ? h : 0,
        email,
        phone,
        ghin,
        homeClub,
        handicapSource: hSource,
      }),
    );
    setName("");
    setHandicap("");
    setEmail("");
    setPhone("");
    setGhin("");
    setHomeClub("");
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    startTransition(() => importCsvSignups(text));
    if (fileRef.current) fileRef.current.value = "";
  };

  const registrationLink = typeof window !== "undefined" ? window.location.origin : "";
  const fullMessage = `${invite}${registrationLink ? `\n\nSign up: ${registrationLink}` : ""}`;

  const sendWhatsApp = () => window.open(`https://wa.me/?text=${encodeURIComponent(fullMessage)}`, "_blank", "noopener");
  const sendSms = () => {
    window.location.href = `sms:?&body=${encodeURIComponent(fullMessage)}`;
  };
  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(""), 1600);
    } catch {
      setCopied("");
    }
  };
  const shareNative = async () => {
    const nav = navigator as Navigator & { share?: (d: { text: string; title?: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: event.name, text: fullMessage });
      } catch {
        /* cancelled */
      }
    } else {
      copy(fullMessage, "share");
    }
  };

  const table = (rows: Signup[], title: string) => (
    <div className="card elev-sm">
      <span className="card-title" style={{ fontSize: 15 }}>{title} ({rows.length})</span>
      <div className="table-scroll">
        <table className="table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>Player</th>
              <th>Contact</th>
              <th style={{ textAlign: "right" }}>Hcp</th>
              <th style={{ width: 44 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="text-muted">{p.seed}</td>
                <td style={{ fontWeight: 500 }}>{p.name}</td>
                <td className="text-muted" style={{ fontSize: 12 }}>{p.email || p.phone || "—"}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.handicap}</td>
                <td style={{ textAlign: "right" }}>
                  <button type="button" className="btn btn-icon" disabled={pending} onClick={() => startTransition(() => removeSignup(p.id))}>
                    <i className="ph ph-x" />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="text-muted" style={{ padding: "10px 6px" }}>None yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Setup</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Registration</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Collect the details you need to run the event. Confirmed players fill up to capacity; overflow waitlists.
        </p>
      </div>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Confirmed</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{confirmed.length}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>{unlimited ? "unlimited field" : `of ${event.capacity} capacity`}</div>
        </div>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Waitlisted</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{waitlist.length}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>bumped in if a spot opens</div>
        </div>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Registration closes</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 18 }}>{event.regDeadline || "—"}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>groups lock after this date</div>
        </div>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Status</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, color: "var(--color-accent-200)" }}>{status}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>spots remaining: {unlimited ? "∞" : spotsLeft}</div>
        </div>
      </div>

      <div className="card elev-sm" style={{ marginBottom: 16, gap: 12 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Invite players</span>
        <p className="text-muted" style={{ fontSize: 12, margin: "-4px 0 0" }}>
          Share the sign-up message and link. (Direct sending to a WhatsApp group needs the WhatsApp Business API —
          for now this opens a share sheet you confirm.)
        </p>
        <div className="field">
          <label>Message</label>
          <textarea className="input" rows={3} value={invite} onChange={(e) => setInvite(e.target.value)} onBlur={() => startTransition(() => setInviteMessage(invite))} style={{ resize: "vertical", fontFamily: "inherit" }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={sendWhatsApp}><i className="ph-fill ph-whatsapp-logo" /> WhatsApp</button>
          <button type="button" className="btn btn-secondary" onClick={sendSms}><i className="ph ph-chat-text" /> SMS / Text</button>
          <button type="button" className="btn btn-secondary" onClick={shareNative}><i className="ph ph-share-network" /> {copied === "share" ? "Copied" : "Share…"}</button>
          <button type="button" className="btn btn-secondary" onClick={() => copy(fullMessage, "msg")}><i className="ph ph-copy" /> {copied === "msg" ? "Copied" : "Copy message"}</button>
          <button type="button" className="btn btn-secondary" onClick={() => copy(registrationLink, "link")}><i className="ph ph-link" /> {copied === "link" ? "Copied" : "Copy link"}</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 16, alignItems: "start" }}>
        <div className="card elev-sm" style={{ gap: 10 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Add a signup</span>
          <div className="field"><label>Player name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div className="field"><label>Email</label><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email" /></div>
            <div className="field"><label>Phone</label><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1…" /></div>
          </div>
          <div className="field">
            <label>Handicap source</label>
            <div className="seg" style={{ width: "100%" }}>
              {[["ghin", "GHIN"], ["manual", "Manual"], ["none", "None"]].map(([v, l]) => (
                <label className="seg-opt" key={v} style={{ flex: 1, justifyContent: "center" }}>
                  <input type="radio" name="hsrc" checked={hSource === v} onChange={() => setHSource(v)} />{l}
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div className="field"><label>{hSource === "ghin" ? "Handicap index" : "Handicap"}</label><input className="input" type="number" value={handicap} onChange={(e) => setHandicap(e.target.value)} placeholder="12.0" disabled={hSource === "none"} /></div>
            <div className="field"><label>GHIN #</label><input className="input" value={ghin} onChange={(e) => setGhin(e.target.value)} placeholder="0000000" disabled={hSource !== "ghin"} /></div>
          </div>
          <div className="field"><label>Home club</label><input className="input" value={homeClub} onChange={(e) => setHomeClub(e.target.value)} placeholder="Optional" /></div>
          <button type="button" className="btn btn-primary btn-block" disabled={pending} onClick={submitAdd}><i className="ph ph-plus" /> Add to field</button>
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
            {hSource === "ghin"
              ? "GHIN lookup is stubbed — enter the index manually for now; live GHIN integration slots in here."
              : "Auto-confirms while under capacity; overflow goes to the waitlist."}
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
