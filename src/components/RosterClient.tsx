"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import {
  addMember,
  updateMember,
  setMemberStatus,
  deleteMember,
  addMembersToEvent,
  importCsvMembers,
  type MemberInput,
  type MemberImportResult,
} from "@/app/actions/roster";

export interface RosterRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  ghin: string;
  homeClub: string;
  gender: string;
  preferredTee: string;
  memberNumber: string;
  handicap: number;
  handicapType: string;
  handicapSource: string;
  status: string;
  notes: string;
  entryCount: number;
  lastEvent: string;
  /** Already in the tournament currently open. */
  entered: boolean;
}

interface Props {
  clubName: string;
  isClub: boolean;
  eventName: string;
  fieldLocked: boolean;
  members: RosterRow[];
}

const BLANK: MemberInput = {
  name: "",
  email: "",
  phone: "",
  ghin: "",
  homeClub: "",
  memberNumber: "",
  handicap: 0,
  handicapType: "18",
  notes: "",
};

export function RosterClient({ clubName, isClub, eventName, fieldLocked, members }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<MemberImportResult | null>(null);
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<MemberInput>(BLANK);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (!showInactive && m.status !== "active") return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.memberNumber.toLowerCase().includes(q) ||
        m.homeClub.toLowerCase().includes(q)
      );
    });
  }, [members, query, showInactive]);

  const activeCount = members.filter((m) => m.status === "active").length;
  const inactiveCount = members.length - activeCount;
  // Only members not already entered can be added, so the button count matches
  // what will actually happen.
  const addable = visible.filter((m) => selected.has(m.id) && !m.entered && m.status === "active");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setError("");
    setNotice("");
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      after?.();
    });
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = visible.length > 0 && visible.every((m) => selected.has(m.id));
  const toggleAll = () => {
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((m) => m.id)));
  };

  const startEdit = (m: RosterRow) => {
    setAdding(false);
    setEditing(m.id);
    setError("");
    setForm({
      name: m.name,
      email: m.email,
      phone: m.phone,
      ghin: m.ghin,
      homeClub: m.homeClub,
      memberNumber: m.memberNumber,
      handicap: m.handicap,
      handicapType: m.handicapType,
      notes: m.notes,
    });
  };

  const closeForm = () => {
    setEditing(null);
    setAdding(false);
    setForm(BLANK);
    setError("");
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setImportResult(null);
    setError("");
    startTransition(async () => {
      setImportResult(await importCsvMembers(text));
    });
    // Cleared so re-picking the same file after a correction still fires
    // onChange — otherwise the second upload silently does nothing.
    if (fileRef.current) fileRef.current.value = "";
  };

  const submitForm = () => {
    const fn = editing ? () => updateMember(editing, form) : () => addMember(form);
    run(fn, () => {
      setNotice(editing ? "Member updated." : `${form.name.trim()} added to the roster.`);
      closeForm();
    });
  };

  const addSelectedToEvent = () => {
    const ids = addable.map((m) => m.id);
    if (ids.length === 0) return;
    run(
      async () => {
        const r = await addMembersToEvent(ids);
        if (r.ok) {
          const bits = [`${r.added} added to ${eventName}`];
          if (r.waitlisted) bits.push(`${r.waitlisted} waitlisted (field is full)`);
          if (r.skipped) bits.push(`${r.skipped} already entered`);
          setNotice(bits.join(" · "));
          setSelected(new Set());
        }
        return r;
      },
    );
  };

  const set = (patch: Partial<MemberInput>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Club</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Members</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Everyone who plays at {clubName}. Tournaments draw their field from this list, so contact details
          and handicaps are kept once, here — not retyped for every event.
        </p>
      </div>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Active members</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{activeCount}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>available for any tournament</div>
        </div>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Inactive</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{inactiveCount}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>kept for past results</div>
        </div>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">In {eventName}</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>
            {members.filter((m) => m.entered).length}
          </div>
          <div className="text-muted" style={{ fontSize: 12 }}>entered in the open tournament</div>
        </div>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Type</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 18 }}>{isClub ? "Club" : "Personal"}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {isClub ? "shared roster" : "your own list of players"}
          </div>
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 13, margin: "0 0 12px", color: "var(--color-danger, #e0665a)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
      {notice && (
        <p style={{ fontSize: 13, margin: "0 0 12px", color: "var(--color-accent)" }}>
          <i className="ph ph-check-circle" /> {notice}
        </p>
      )}

      {/* ── Add / edit form ─────────────────────────────────────────────── */}
      {(adding || editing) && (
        <div className="card elev-sm" style={{ gap: 12, marginBottom: 16 }}>
          <span className="card-title" style={{ fontSize: 15 }}>
            {editing ? "Edit member" : "Add a member"}
          </span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
            <div className="field">
              <label>Name</label>
              <input
                className="input"
                value={form.name}
                disabled={pending}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. Priya Nair"
              />
            </div>
            <div className="field">
              <label>
                Email <span className="text-muted">· how they sign in</span>
              </label>
              <input
                className="input"
                value={form.email}
                disabled={pending}
                onChange={(e) => set({ email: e.target.value })}
                placeholder="name@example.com"
              />
            </div>
            <div className="field">
              <label>Phone</label>
              <input
                className="input"
                value={form.phone}
                disabled={pending}
                onChange={(e) => set({ phone: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Handicap index</label>
              <input
                className="input"
                type="number"
                step="0.1"
                value={form.handicap}
                disabled={pending}
                onChange={(e) => set({ handicap: parseFloat(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>Handicap is for</label>
              <select
                className="input"
                value={form.handicapType}
                disabled={pending}
                onChange={(e) => set({ handicapType: e.target.value })}
              >
                <option value="18">18 holes</option>
                <option value="9">9 holes</option>
              </select>
            </div>
            <div className="field">
              <label>
                Member number <span className="text-muted">· optional</span>
              </label>
              <input
                className="input"
                value={form.memberNumber}
                disabled={pending}
                onChange={(e) => set({ memberNumber: e.target.value })}
              />
            </div>
            <div className="field">
              <label>
                GHIN <span className="text-muted">· optional</span>
              </label>
              <input
                className="input"
                value={form.ghin}
                disabled={pending}
                onChange={(e) => set({ ghin: e.target.value })}
              />
            </div>
            <div className="field">
              <label>
                Home club <span className="text-muted">· optional</span>
              </label>
              <input
                className="input"
                value={form.homeClub}
                disabled={pending}
                onChange={(e) => set({ homeClub: e.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label>
              Notes <span className="text-muted">· visible to organizers only</span>
            </label>
            <input
              className="input"
              value={form.notes}
              disabled={pending}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="e.g. prefers early tee times"
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={submitForm}>
              <i className="ph ph-check" /> {pending ? "Saving…" : editing ? "Save changes" : "Add member"}
            </button>
            <button type="button" className="btn" disabled={pending} onClick={closeForm}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Roster table ────────────────────────────────────────────────── */}
      <div className="card elev-sm">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="card-title" style={{ fontSize: 15, marginRight: "auto" }}>
            Roster ({visible.length})
          </span>
          <input
            className="input"
            style={{ width: 220 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, number…"
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }} className="text-muted">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
          {!adding && !editing && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setAdding(true);
                  setEditing(null);
                  setForm(BLANK);
                }}
              >
                <i className="ph ph-user-plus" /> Add member
              </button>
              {/* A club with a membership list already has it in a spreadsheet.
                  Typing it in one member at a time is the reason a roster never
                  gets filled in. */}
              <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
                <i className="ph ph-upload-simple" /> Import CSV
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={onFile}
                  style={{ display: "none" }}
                />
              </label>
            </>
          )}
        </div>

        {importResult && <ImportSummary result={importResult} onDismiss={() => setImportResult(null)} />}

        {addable.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 12px",
              marginTop: 10,
              borderRadius: "var(--radius-md)",
              background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
              fontSize: 13,
            }}
          >
            <span>
              <b>{addable.length}</b> selected
            </span>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginLeft: "auto" }}
              disabled={pending || fieldLocked}
              onClick={addSelectedToEvent}
              title={fieldLocked ? "Unlock the tournament to change the field" : undefined}
            >
              <i className="ph ph-user-plus" /> Add to {eventName}
            </button>
          </div>
        )}

        <div className="table-scroll" style={{ marginTop: 10 }}>
          <table className="table" style={{ fontSize: 13, minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th style={{ minWidth: 190 }}>Name</th>
                <th style={{ width: 70 }}>Index</th>
                <th style={{ minWidth: 150 }}>Contact</th>
                <th style={{ width: 66 }}>Played</th>
                <th style={{ minWidth: 150 }}>Last event</th>
                <th style={{ width: 122 }} />
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr key={m.id} style={{ opacity: m.status === "active" ? 1 : 0.55 }}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(m.id)}
                      onChange={() => toggle(m.id)}
                      aria-label={`Select ${m.name}`}
                    />
                  </td>
                  <td style={{ fontWeight: 500 }}>
                    {m.name}
                    {m.memberNumber && (
                      <span className="text-muted" style={{ fontSize: 11, marginLeft: 6 }}>
                        #{m.memberNumber}
                      </span>
                    )}
                    {/* The event is named once in the header stat — repeating it
                        on every row wrapped the tag and crushed the name column. */}
                    {m.entered && (
                      <span
                        className="tag tag-neutral"
                        style={{ marginLeft: 6, fontSize: 10, whiteSpace: "nowrap" }}
                        title={`Already in ${eventName}`}
                      >
                        in field
                      </span>
                    )}
                    {m.status !== "active" && (
                      <span
                        className="tag tag-neutral"
                        style={{ marginLeft: 6, fontSize: 10, whiteSpace: "nowrap" }}
                      >
                        inactive
                      </span>
                    )}
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>
                    {m.handicap}
                    {m.handicapType === "9" && (
                      <span className="text-muted" style={{ fontSize: 10 }}> (9)</span>
                    )}
                  </td>
                  <td className="text-muted" style={{ fontSize: 12 }}>
                    {m.email || "—"}
                    {m.phone && <div>{m.phone}</div>}
                  </td>
                  <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{m.entryCount}</td>
                  <td className="text-muted" style={{ fontSize: 12 }}>{m.lastEvent || "—"}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      className="btn btn-icon"
                      title="Edit"
                      disabled={pending}
                      onClick={() => startEdit(m)}
                    >
                      <i className="ph ph-pencil-simple" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon"
                      title={m.status === "active" ? "Set inactive" : "Reactivate"}
                      disabled={pending}
                      onClick={() =>
                        run(() => setMemberStatus(m.id, m.status === "active" ? "inactive" : "active"))
                      }
                    >
                      <i className={m.status === "active" ? "ph ph-archive" : "ph ph-arrow-counter-clockwise"} />
                    </button>
                    {m.entryCount === 0 && (
                      <button
                        type="button"
                        className="btn btn-icon"
                        title="Remove from roster"
                        disabled={pending}
                        onClick={() => run(() => deleteMember(m.id))}
                      >
                        <i className="ph ph-trash" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-muted" style={{ textAlign: "center", padding: "18px 0" }}>
                    {members.length === 0
                      ? "No members yet. Add one above, or import a field on Registration — everyone you enter joins the roster automatically."
                      : "No members match that search."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/**
 * What the upload actually did.
 *
 * Reports updates separately from additions, because those are different
 * events to an organizer: "142 added" after re-uploading a corrected export
 * would mean the roster had just doubled. It also names the columns it didn't
 * recognise — a file whose handicaps all imported as zero because the column
 * was headed "Playing Hcp" is otherwise a silent, plausible-looking failure.
 */
/**
 * Exported so the render tests can drive each outcome directly. It is a pure
 * function of its props, and the copy is the part most likely to be wrong —
 * reporting 142 "added" after a re-upload would tell an organizer their roster
 * had just doubled.
 */
export function ImportSummary({
  result,
  onDismiss,
}: {
  result: MemberImportResult;
  onDismiss: () => void;
}) {
  const bad = !!result.error;
  const parts = [
    result.imported > 0 ? `${result.imported} added` : "",
    result.updated > 0 ? `${result.updated} updated` : "",
    result.skippedDuplicates > 0 ? `${result.skippedDuplicates} already up to date` : "",
    result.skippedInvalid > 0 ? `${result.skippedInvalid} skipped (no name, or a bad email)` : "",
  ].filter(Boolean);

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px",
        marginTop: 10,
        borderRadius: "var(--radius-md)",
        fontSize: 13,
        lineHeight: 1.5,
        color: bad ? "var(--color-danger)" : "var(--color-text)",
        background: bad ? "var(--color-danger-bg)" : "color-mix(in srgb, var(--color-accent-2) 12%, transparent)",
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${bad ? "var(--color-danger)" : "var(--color-accent-2)"} 30%, transparent)`,
      }}
    >
      <i
        className={bad ? "ph ph-warning-circle" : "ph ph-check-circle"}
        style={{ fontSize: 15, marginTop: 1, flex: "none" }}
      />
      <div style={{ flex: 1 }}>
        {bad ? (
          result.error
        ) : (
          <>
            <span>{parts.length ? parts.join(" · ") : "Nothing to import — every row was already on the roster."}</span>
            {result.unknownColumns.length > 0 && (
              <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                Ignored {result.unknownColumns.length === 1 ? "column" : "columns"}:{" "}
                {result.unknownColumns.join(", ")}. Rename to a recognised heading and upload again to
                bring {result.unknownColumns.length === 1 ? "it" : "them"} in.
              </div>
            )}
          </>
        )}
      </div>
      <button
        type="button"
        className="btn btn-icon"
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{ width: 24, height: 24, flex: "none" }}
      >
        <i className="ph ph-x" style={{ fontSize: 12 }} />
      </button>
    </div>
  );
}
