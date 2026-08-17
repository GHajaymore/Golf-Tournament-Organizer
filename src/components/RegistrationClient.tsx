"use client";
import { registrationStatus, formatDeadline } from "@/lib/registration";
import { parseHandicapInput } from "@/lib/domain/registration-intake";
import { setRegistrationOverride, setRegistrationOpen, setRegistrationApproval, setRequirePhone, approveSignup } from "@/app/actions/tournament";
import { useState, useRef, useTransition } from "react";
import { addSignup, removeSignup, removeSignups, updateSignup, importCsvSignups, setInviteMessage, type CsvImportResult } from "@/app/actions/tournament";
import { SetupLockBanner } from "./SetupLockBanner";
import { RosterPicker } from "./RosterPicker";
import type { RosterCandidate } from "@/lib/services/roster";
import { PHONE_REQUIRED_FREE } from "@/lib/plans";
import { contactGaps } from "@/lib/domain/contact-gaps";

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
  /** draft | registration | ready | live | completed — a finished tournament
   *  takes no more entries, whatever the switch and the deadline say. */
  status: string;
  regDeadline: string;
  /** Organizer overriding the deadline: null follows it, true closes, false extends. */
  registrationOverride: boolean | null;
  inviteMessage: string;
  /** Owning club's name, used to sign invitations. */
  organizationName?: string;
  dates: string;
  course: string;
  city: string;
  /** Self-service registration: whether the public link is live. */
  registrationOpen: boolean;
  /** auto | approve — whether entries land confirmed or wait for the organizer. */
  registrationApproval: string;
  requirePhone: boolean;
  /**
   * Whether the mobile requirement is fixed by the plan rather than chosen.
   * True on free, where every entrant gives a number; false on a paid plan,
   * where `requirePhone` above is the organizer's own per-tournament decision.
   */
  phoneLocked: boolean;
  /** Opaque token for the public /register/[token] link. Empty until first opened. */
  registrationToken: string;
}

export function RegistrationClient({
  event,
  confirmed,
  waitlist,
  pendingEntries,
  locked,
  isAdmin,
  roster,
}: {
  event: EventInfo;
  confirmed: Signup[];
  waitlist: Signup[];
  /** Self-service entries awaiting the organizer's approval (approve mode). */
  pendingEntries: Signup[];
  locked: boolean;
  isAdmin: boolean;
  /** The club's members, for filling the field without retyping anyone. */
  roster: RosterCandidate[];
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
  const [pending, startTransition] = useTransition();
  // Fixed by the plan on free, the organizer's own choice on a paid plan.
  const phoneLocked = event.phoneLocked;
  // What the import and the public form will actually insist on — the resolved
  // rule, not the raw setting, so the hint can't promise something the action
  // then refuses.
  const phoneRequired = phoneLocked || event.requirePhone;
  const commitUpdate = (playerId: string, patch: Parameters<typeof updateSignup>[1]) =>
    startTransition(async () => {
      const result = await updateSignup(playerId, patch);
      setRowError(result.ok ? "" : result.error ?? "Couldn't save that change.");
    });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const unlimited = event.capacity <= 0;
  const spotsLeft = unlimited ? Infinity : Math.max(0, event.capacity - confirmed.length);
  // Was computed from capacity alone, so a tournament whose deadline passed a
  // week ago still read "Open · unlimited" — the screen stating something
  // false about the organizer's own event.
  const reg = registrationStatus({
    eventStatus: event.status,
    deadline: event.regDeadline,
    capacity: event.capacity,
    confirmedCount: confirmed.length,
    override: event.registrationOverride,
  });
  const status = reg.label;
  // Both halves of the same rule, reported together — see contactGaps for why
  // the phone line is conditional, and why it says outright that the existing
  // entries are not a mistake.
  const gaps = contactGaps([...confirmed, ...waitlist], phoneRequired);

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
  /**
   * Delete the selected rows OF THIS TABLE.
   *
   * One `selected` Set is shared by the confirmed, waitlist and pending tables
   * — which is fine, ids are unique — but this used to delete every id in it
   * while the button counted only the rows in front of you. Tick three
   * confirmed and two waitlisted, press "Delete 2 selected", and all five went,
   * with no confirmation and no undo. The rows are the ones the label counted.
   */
  const deleteSelected = (rows: Signup[]) => {
    const ids = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
    if (ids.length === 0) return;
    const names = ids.map((id) => rows.find((r) => r.id === id)?.name ?? "").filter(Boolean);
    // Deleting a signup can end someone's tournament. It is worth a sentence.
    if (!window.confirm(`Remove ${names.length === 1 ? names[0] : `${names.length} players`} from this tournament?\n\nAnyone who has already played is withdrawn instead, so their results stay.`)) {
      return;
    }
    startTransition(async () => {
      const res = await removeSignups(ids);
      setRowError(
        res.withdrawn
          ? `${res.withdrawn} ${res.withdrawn === 1 ? "player has" : "players have"} played, so ${res.withdrawn === 1 ? "that entry was" : "those entries were"} withdrawn rather than deleted — their results are kept.`
          : "",
      );
    });
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  };

  const submitAdd = () => {
    if (!name.trim() || !email.trim()) {
      setAddError(!name.trim() ? "Enter a player name." : "Email is required — it's how this player signs in.");
      return;
    }
    // The same reading as the public form and both importers: "+2.4" is a plus
    // handicap, 2.4 better than scratch, and parseFloat gets that backwards.
    const h = parseHandicapInput(handicap);
    if (!h.ok) {
      setAddError(h.error);
      return;
    }
    setAddError("");
    startTransition(async () => {
      const result = await addSignup({
        name,
        handicap: h.value,
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
  // The public self-service sign-up link. Empty until registration has been
  // opened at least once (the token is minted then).
  const registerUrl = event.registrationToken ? `${registrationLink}/register/${event.registrationToken}` : "";
  const approveMode = event.registrationApproval === "approve";
  // Sign the invitation with the club's name so the recipient recognises who
  // it's from — a bare link from an unknown app reads like spam.
  const signature = event.organizationName ? `\n— ${event.organizationName}` : "";
  const fullMessage = `${invite}${signature}${registrationLink ? `\n\nSign up: ${registrationLink}` : ""}`;

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
            <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: "4px 10px" }} disabled={pending || locked} onClick={() => deleteSelected(rows)}>
              <i className="ph ph-trash" /> Delete {rows.filter((r) => selected.has(r.id)).length} selected
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
                    <button type="button" className="btn btn-icon" disabled={pending || locked} onClick={() => startTransition(() => void removeSignup(p.id))}>
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

      {gaps.lines.length > 0 && (
        <div
          className="card elev-sm"
          style={{
            marginBottom: 16,
            flexDirection: "row",
            alignItems: gaps.lines.length > 1 ? "flex-start" : "center",
            gap: 10,
            borderColor: "var(--color-accent)",
          }}
        >
          <i
            className="ph ph-warning-circle"
            style={{ color: "var(--color-accent)", fontSize: 18, marginTop: gaps.lines.length > 1 ? 1 : 0 }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {gaps.lines.map((line) => (
              <span key={line} style={{ fontSize: 13 }}>
                {line}
              </span>
            ))}
          </div>
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
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 18 }}>{formatDeadline(event.regDeadline) || "—"}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>groups lock after this date</div>
        </div>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Status</span>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 18,
              color: reg.acceptingEntries ? "var(--color-accent-200)" : "var(--color-danger)",
            }}
          >
            {status}
          </div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {reg.acceptingEntries ? `spots remaining: ${unlimited ? "∞" : spotsLeft}` : reg.detail}
          </div>
        </div>
      </div>

      {/* The organizer's own decision about the deadline, in both directions.
          Adding a player by hand is never blocked by this — that is how a
          closed event still takes a late entry, and it is the organizer's job.
          What this governs is what the screen tells everyone else. */}
      <div
        className="card elev-sm"
        style={{
          marginBottom: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          background: reg.acceptingEntries
            ? "color-mix(in srgb, var(--color-text) 3%, transparent)"
            : "var(--color-danger-bg)",
          boxShadow: reg.acceptingEntries
            ? "inset 0 0 0 1px color-mix(in srgb, var(--color-text) 10%, transparent)"
            : "inset 0 0 0 1px color-mix(in srgb, var(--color-danger) 30%, transparent)",
        }}
      >
        <i
          className={reg.acceptingEntries ? "ph ph-door-open" : "ph ph-lock-simple"}
          style={{
            fontSize: 16,
            color: reg.acceptingEntries ? "var(--color-accent-400)" : "var(--color-danger)",
          }}
        />
        <span style={{ fontSize: 12.5, flex: 1, minWidth: 220, lineHeight: 1.5 }}>
          {reg.detail || `Entries are open${event.regDeadline ? ` until ${formatDeadline(event.regDeadline)}` : ""}.`}
          {!reg.acceptingEntries && (
            <>
              {" "}
              <strong>You can still add players below</strong> — closing only changes what this says.
            </>
          )}
        </span>

        {reg.state === "closed-deadline" && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || locked}
            onClick={() => startTransition(() => void setRegistrationOverride(false))}
          >
            <i className="ph ph-calendar-plus" /> Keep taking entries
          </button>
        )}
        {reg.state === "open-extended" && (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending || locked}
            onClick={() => startTransition(() => void setRegistrationOverride(null))}
          >
            <i className="ph ph-arrow-counter-clockwise" /> Follow the deadline again
          </button>
        )}
        {reg.state === "closed-manual" ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || locked}
            onClick={() => startTransition(() => void setRegistrationOverride(null))}
          >
            <i className="ph ph-door-open" /> Reopen registration
          </button>
        ) : (
          reg.acceptingEntries && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pending || locked}
              onClick={() => startTransition(() => void setRegistrationOverride(true))}
            >
              <i className="ph ph-lock-simple" /> Close registration
            </button>
          )
        )}
      </div>

      {/* Self-service registration: share a link and people register themselves.
          Separate from the invite message above — that hands someone this
          console's sign-up; this hands anyone a public, no-account entry form. */}
      <div className="card elev-sm" style={{ marginBottom: 16, gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <span className="card-title" style={{ fontSize: 15 }}>Open registration</span>
            <p className="text-muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
              Share a link and people sign themselves up — no account needed. Entries appear in the field below.
            </p>
          </div>
          <button
            type="button"
            className={event.registrationOpen ? "btn btn-secondary" : "btn btn-primary"}
            disabled={pending || locked}
            onClick={() => startTransition(() => void setRegistrationOpen(!event.registrationOpen))}
          >
            <i className={event.registrationOpen ? "ph ph-lock-simple" : "ph ph-door-open"} />
            {event.registrationOpen ? "Close sign-ups" : "Open registration"}
          </button>
        </div>

        {event.registrationOpen && (
          <>
            {registerUrl && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  className="input"
                  readOnly
                  value={registerUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ flex: 1, minWidth: 220, fontSize: 12.5, fontFamily: "var(--font-mono, monospace)" }}
                />
                <button type="button" className="btn btn-secondary" onClick={() => copy(registerUrl, "reg")}>
                  <i className="ph ph-copy" /> {copied === "reg" ? "Copied" : "Copy link"}
                </button>
              </div>
            )}

            {/* Auto-confirm vs approve-each-entry. */}
            <div className="field" style={{ marginTop: 2 }}>
              <label>When someone registers</label>
              <div className="seg" style={{ width: "100%" }}>
                {[
                  ["auto", "Auto-confirm to capacity"],
                  ["approve", "Approve each entry"],
                ].map(([v, l]) => (
                  <label className="seg-opt" key={v} style={{ flex: 1, justifyContent: "center" }}>
                    <input
                      type="radio"
                      name="regapproval"
                      checked={approveMode ? v === "approve" : v === "auto"}
                      disabled={pending || locked}
                      onChange={() => startTransition(() => void setRegistrationApproval(v))}
                    />
                    {l}
                  </label>
                ))}
              </div>
              <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
                {approveMode
                  ? "Every entry lands in “Pending approval” below for you to accept — nobody joins the field until you do."
                  : "Entries fill the field up to capacity and confirm automatically; once full, further entries go to the waitlist."}
              </p>
            </div>

            {/* Per tournament on a paid plan; forced on and not editable on
                free. The switch is shown either way rather than hidden, so a
                free club can see what the choice would be — the same reasoning
                as every other locked feature. A phone number is not needed to
                run a competition, so being able to stop asking for one is a
                real thing to buy: every extra required field costs entries,
                and the members it turns away are the ones least likely to have
                a mobile at all. */}
            <div className="field" style={{ marginTop: 2 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 9,
                  cursor: phoneLocked ? "default" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={phoneLocked ? true : event.requirePhone}
                  disabled={pending || locked || phoneLocked}
                  onChange={(e) =>
                    startTransition(() => void setRequirePhone(e.target.checked))
                  }
                  style={{ marginTop: 3, accentColor: "var(--color-accent)" }}
                />
                <span>
                  <span style={{ fontWeight: 500 }}>
                    Require a mobile number{" "}
                    {phoneLocked && (
                      <span
                        className="text-muted"
                        style={{ fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase" }}
                      >
                        <i className="ph ph-lock-simple" /> Always on — free plan
                      </span>
                    )}
                  </span>
                  <span className="text-muted" style={{ display: "block", fontSize: 12, lineHeight: 1.6 }}>
                    {phoneLocked
                      ? PHONE_REQUIRED_FREE
                      : event.requirePhone
                        ? "The sign-up form asks for a mobile and won't accept an entry without one. Use this for a shotgun start, where you may need to ring a group that hasn't arrived."
                        : "The sign-up form asks for a mobile but accepts an entry without one. Most tournaments don't need it — every extra required field costs you entries."}
                  </span>
                </span>
              </label>
            </div>
          </>
        )}
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

      <div className="page-split" style={{ display: "grid", gridTemplateColumns: "340px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <RosterPicker candidates={roster} eventName={event.name} locked={locked} />
        <div className="card elev-sm" style={{ gap: 10 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Add someone new</span>
          <p className="text-muted" style={{ fontSize: 12, margin: "-4px 0 0" }}>
            Anyone added here joins the club roster too, so you only enter their details once.
          </p>
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
            <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>
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
              First row must be a header. Recognized columns:{" "}
              {phoneRequired ? "name, email and phone (all three required" : "name and email (both required"} — email
              is how each player signs in
              {phoneRequired
                ? ", and this tournament collects a mobile for every entrant), handicap, handicap type (9/18)."
                : "), handicap, phone, handicap type (9/18)."}{" "}
              Rows missing a required column, or duplicating a name or email already in the field, are skipped
              automatically.
            </p>
            {importResult && (
              importResult.error ? (
                <p style={{ fontSize: 12, margin: "8px 0 0", color: "var(--color-danger)" }}>
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
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rowError && (
            <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>
              <i className="ph ph-warning-circle" /> {rowError}
            </p>
          )}
          {pendingEntries.length > 0 && (
            <div className="card elev-sm" style={{ borderColor: "var(--color-accent)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <i className="ph ph-hourglass-medium" style={{ color: "var(--color-accent)" }} />
                <span className="card-title" style={{ fontSize: 15 }}>Pending approval ({pendingEntries.length})</span>
              </div>
              <p className="text-muted" style={{ fontSize: 12, margin: "-2px 0 2px" }}>
                Self-service entries waiting for you. Accepting one puts it in the field (or the waitlist if full).
              </p>
              <div className="table-scroll">
                <table className="table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th style={{ width: 70, textAlign: "right" }}>Hcp</th>
                      <th>Email</th>
                      <th style={{ width: 150 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {pendingEntries.map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 500 }}>{p.name}</td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {p.handicap}
                          {p.handicapType === "9" ? " (9h)" : ""}
                        </td>
                        <td className="text-muted" style={{ fontSize: 12 }}>{p.email || "—"}</td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ fontSize: 12, padding: "4px 10px", marginRight: 6 }}
                            disabled={pending || locked}
                            onClick={() => startTransition(() => void approveSignup(p.id))}
                          >
                            <i className="ph ph-check" /> Accept
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ fontSize: 12, padding: "4px 10px" }}
                            disabled={pending || locked}
                            onClick={() => startTransition(() => void removeSignup(p.id))}
                          >
                            Decline
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {table(confirmed, "Confirmed field", true)}
          {table(waitlist, "Waitlist", false)}
        </div>
      </div>
    </>
  );
}
