"use client";
import { useState, useRef, useTransition } from "react";
import { addSignup, removeSignup, removeSignups, updateSignup, importCsvSignups, setInviteMessage, type CsvImportResult } from "@/app/actions/tournament";
import { SetupLockBanner } from "./SetupLockBanner";

interface Signup {
  id: string;
  name: string;
  handicap: number;
  handicapType?: string;
  seed: number;
  email?: string;
  phone?: string;
  flight?: string;
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
  locked,
  isAdmin,
}: {
  event: EventInfo;
  confirmed: Signup[];
  waitlist: Signup[];
  locked: boolean;
  isAdmin: boolean;
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
  const [newHandicapType, setNewHandicapType] = useState("18");
  const [importResult, setImportResult] = useState<CsvImportResult | null>(null);
  const [addError, setAddError] = useState("");
  const [rowError, setRowError] = useState("");
  const commitUpdate = (playerId: string, patch: Parameters<typeof updateSignup>[1]) =>
    startTransition(async () => {
      const result = await updateSignup(playerId, patch);
      setRowError(result.ok ? "" : result.error ?? "Couldn't save that change.");
    });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const unlimited = event.capacity <= 0;
  const spotsLeft = unlimited ? Infinity : Math.max(0, event.capacity - confirmed.length);
  const status = unlimited ? "Open · unlimited" : spotsLeft === 0 ? "Full — waitlist active" : "Open";
  const missingEmailCount = [...confirmed, ...waitlist].filter((p) => !p.email?.trim()).length;

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleSelectAll = (rows: Signup[]) =>
    setSelected((prev) => {
      const allSelected = rows.every((r) => prev.has(r.id));
      const next = new Set(prev);
      for (const r of rows) {
        if (allSelected) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  const deleteSelected = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    startTransition(() => removeSignups(ids));
    setSelected(new Set());
  };

  const submitAdd = () => {
    if (!name.trim() || !email.trim()) {
      setAddError(!name.trim() ? "Enter a player name." : "Email is required — it's how this player signs in.");
      return;
    }
    const h = parseFloat(handicap);
    setAddError("");
    startTransition(async () => {
      const result = await addSignup({
        name,
        handicap: Number.isFinite(h) ? h : 0,
        email,
        phone,
        ghin,
        homeClub,
        handicapSource: hSource,
        handicapType: newHandicapType,
      });
      if (!result.ok) {
        setAddError(result.error ?? "Couldn't add that signup.");
        return;
      }
      setName("");
      setHandicap("");
      setEmail("");
      setPhone("");
      setGhin("");
      setHomeClub("");
    });
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setImportResult(null);
    startTransition(async () => {
      const result = await importCsvSignups(text);
      setImportResult(result);
    });
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

  const table = (rows: Signup[], title: string, showFlight: boolean) => {
    const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
    const anySelected = rows.some((r) => selected.has(r.id));
    return (
      <div className="card elev-sm">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="card-title" style={{ fontSize: 15 }}>{title} ({rows.length})</span>
          {anySelected && (
            <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: "4px 10px" }} disabled={pending || locked} onClick={deleteSelected}>
              <i className="ph ph-trash" /> Delete {[...selected].filter((id) => rows.some((r) => r.id === id)).length} selected
            </button>
          )}
        </div>
        <div className="table-scroll">
          <table className="table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ width: 26 }}>
                  <input type="checkbox" checked={allSelected} disabled={rows.length === 0} onChange={() => toggleSelectAll(rows)} />
                </th>
                <th style={{ width: 32 }}>#</th>
                <th>Player</th>
                <th style={{ width: 96, textAlign: "right" }}>Hcp</th>
                <th>Email</th>
                <th>Phone</th>
                {showFlight && <th>Flight</th>}
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={p.id}>
                  <td><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} /></td>
                  <td className="text-muted">{i + 1}</td>
                  <td style={{ fontWeight: 500 }}>{p.name}</td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 3, justifyContent: "flex-end", alignItems: "center" }}>
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        defaultValue={p.handicap}
                        disabled={pending || locked}
                        style={{ width: 52, padding: "3px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                        onBlur={(e) => {
                          const v = parseFloat(e.target.value);
                          if (Number.isFinite(v) && v !== p.handicap) commitUpdate(p.id, { handicap: v });
                        }}
                      />
                      <select
                        className="input"
                        value={p.handicapType === "9" ? "9" : "18"}
                        disabled={pending || locked}
                        style={{ width: 46, padding: "3px 2px", fontSize: 11 }}
                        onChange={(e) => commitUpdate(p.id, { handicapType: e.target.value })}
                        title="Whether this handicap index is a 9-hole or 18-hole index"
                      >
                        <option value="18">18h</option>
                        <option value="9">9h</option>
                      </select>
                    </div>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    <input
                      className="input"
                      type="email"
                      defaultValue={p.email ?? ""}
                      disabled={pending || locked}
                      placeholder="Required for sign-in"
                      style={{
                        padding: "3px 6px",
                        fontSize: 12,
                        width: 150,
                        borderColor: p.email ? undefined : "var(--color-accent)",
                      }}
                      title={p.email ? undefined : "No email on file — this player can't sign in until one is added."}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (p.email ?? "")) commitUpdate(p.id, { email: v });
                      }}
                    />
                  </td>
                  <td className="text-muted" style={{ fontSize: 12 }}>{p.phone || "—"}</td>
                  {showFlight && <td className="text-muted">{p.flight || "—"}</td>}
                  <td style={{ textAlign: "right" }}>
                    <button type="button" className="btn btn-icon" disabled={pending || locked} onClick={() => startTransition(() => removeSignup(p.id))}>
                      <i className="ph ph-x" />
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={showFlight ? 8 : 7} className="text-muted" style={{ padding: "10px 6px" }}>None yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Set up</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Registration &amp; field</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Collect the details you need to run the event. Confirmed players fill up to capacity; overflow waitlists.
        </p>
      </div>

      <SetupLockBanner locked={locked} isAdmin={isAdmin} />

      {missingEmailCount > 0 && (
        <div className="card elev-sm" style={{ marginBottom: 16, flexDirection: "row", alignItems: "center", gap: 10, borderColor: "var(--color-accent)" }}>
          <i className="ph ph-warning-circle" style={{ color: "var(--color-accent)", fontSize: 18 }} />
          <span style={{ fontSize: 13 }}>
            {missingEmailCount} player{missingEmailCount === 1 ? "" : "s"} {missingEmailCount === 1 ? "has" : "have"} no email on file — access is email-based, so
            {missingEmailCount === 1 ? " they" : " they"} can&rsquo;t sign in until one&rsquo;s added below.
          </span>
        </div>
      )}

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
            <div className="field">
              <label>Email <span style={{ color: "var(--color-accent-300)" }}>· required, grants sign-in</span></label>
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email" style={!email.trim() ? { borderColor: "var(--color-accent)" } : undefined} />
            </div>
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
          <div className="field">
            <label>Handicap is a…</label>
            <div className="seg" style={{ width: "100%" }}>
              {[["18", "18-hole index"], ["9", "9-hole index"]].map(([v, l]) => (
                <label className="seg-opt" key={v} style={{ flex: 1, justifyContent: "center" }}>
                  <input type="radio" name="hctype" checked={newHandicapType === v} onChange={() => setNewHandicapType(v)} disabled={hSource === "none"} />{l}
                </label>
              ))}
            </div>
          </div>
          <div className="field"><label>Home club</label><input className="input" value={homeClub} onChange={(e) => setHomeClub(e.target.value)} placeholder="Optional" /></div>
          <button type="button" className="btn btn-primary btn-block" disabled={pending || !name.trim() || !email.trim()} onClick={submitAdd}><i className="ph ph-plus" /> Add to field</button>
          {addError && (
            <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger, #e0665a)" }}>
              <i className="ph ph-warning-circle" /> {addError}
            </p>
          )}
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
            <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
              First row must be a header. Recognized columns: name and email (both required — email is how each
              player signs in), handicap, phone, handicap type (9/18). Rows missing either, or duplicating a name or
              email already in the field, are skipped automatically.
            </p>
            {importResult && (
              importResult.error ? (
                <p style={{ fontSize: 12, margin: "8px 0 0", color: "var(--color-danger, #e0665a)" }}>
                  <i className="ph ph-warning-circle" /> {importResult.error}
                </p>
              ) : (
                <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
                  <i className="ph ph-check-circle" style={{ color: "var(--color-accent-2-300)" }} /> Imported {importResult.imported}
                  {importResult.skippedDuplicates > 0 ? `, skipped ${importResult.skippedDuplicates} duplicate${importResult.skippedDuplicates === 1 ? "" : "s"}` : ""}
                  {importResult.skippedInvalid > 0 ? `, skipped ${importResult.skippedInvalid} invalid row${importResult.skippedInvalid === 1 ? "" : "s"}` : ""}.
                </p>
              )
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rowError && (
            <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger, #e0665a)" }}>
              <i className="ph ph-warning-circle" /> {rowError}
            </p>
          )}
          {table(confirmed, "Confirmed field", true)}
          {table(waitlist, "Waitlist", false)}
        </div>
      </div>
    </>
  );
}
