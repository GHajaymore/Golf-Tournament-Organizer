"use client";
import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import { ClubHandicapPanel } from "@/components/ClubHandicapPanel";
import { listNames } from "@/lib/format";
import { fieldRosterSummary } from "@/lib/domain/roster-link";
import { csvSizeRefusal } from "@/lib/csv";
import { orgProfile } from "@/lib/domain/org-profile";
import { rosterSelection } from "@/lib/domain/roster-selection";
import {
  addMember,
  updateMember,
  setMemberStatus,
  deleteMember,
  addMembersToEvent,
  addFieldToRoster,
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
  /** Has an entry of any kind in the tournament currently open. */
  entered: boolean;
  /**
   * Whether that entry is a place in the field or a place in the queue.
   *
   * "in field" was shown for both, which is wrong for the waitlisted member
   * and misleading for the organizer deciding who else to add.
   */
  entryStatus: "in" | "waitlisted" | "out";
}

interface Props {
  clubName: string;
  /**
   * The stored kind, asked via `orgProfile` rather than compared here.
   *
   * This was `isClub: boolean`, filled in by the page with `kind === "club"`.
   * That is a second place deciding what a kind means, and it got the answer
   * wrong for every kind but the two it knew: a society has a shared roster
   * and would have been labelled "Personal — your own list of players" while
   * looking at the shared list.
   */
  orgKind: string;
  eventName: string;
  fieldLocked: boolean;
  members: RosterRow[];
  /** Everyone in the open tournament, entered and waitlisted. */
  fieldSize: number;
  /** How many of them have no roster member behind them. */
  unlinkedCount: number;
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

export function RosterClient({
  clubName,
  orgKind,
  eventName,
  fieldLocked,
  members,
  fieldSize,
  unlinkedCount,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<MemberImportResult | null>(null);
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  /** all | in this tournament | not in it. Not everyone plays every event. */
  const [entryFilter, setEntryFilter] = useState<"all" | "in" | "out">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  /** Whose handicap record is open. One at a time — see the trigger below. */
  const [recordFor, setRecordFor] = useState<string | null>(null);
  const [form, setForm] = useState<MemberInput>(BLANK);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const summary = fieldRosterSummary(fieldSize, unlinkedCount);
  const profile = orgProfile(orgKind);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (!showInactive && m.status !== "active") return false;
      // Not everyone plays every tournament, and signing a field up means
      // looking at the ones who are NOT in it yet. Searching a name at a time
      // was the only way to find them.
      if (entryFilter === "in" && m.entryStatus === "out") return false;
      if (entryFilter === "out" && m.entryStatus !== "out") return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.memberNumber.toLowerCase().includes(q) ||
        m.homeClub.toLowerCase().includes(q)
      );
    });
  }, [members, query, showInactive, entryFilter]);

  const activeCount = members.filter((m) => m.status === "active").length;
  const inactiveCount = members.length - activeCount;
  // Only members not already entered can be added, so the button count matches
  // what will actually happen.
  const chosen = visible.filter((m) => selected.has(m.id));
  const addable = chosen.filter((m) => !m.entered && m.status === "active");
  // What ticking those boxes will actually do, and why the rest will not —
  // decided in the domain, because a static render cannot tick a checkbox and
  // a refusal no test can reach is a refusal nobody checks.
  const pick = rosterSelection(chosen, eventName);

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
    setImportResult(null);
    setError("");
    // Same reason as the entry import: over the body limit the request never
    // reaches the server, so this is the only place it can be explained.
    const tooBig = csvSizeRefusal(file.size);
    if (tooBig) {
      setError(tooBig);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const text = await file.text();
    startTransition(async () => {
      try {
        setImportResult(await importCsvMembers(text));
      } catch {
        setError("That import didn't go through. Check your connection and try again — nothing was added.");
      }
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

  const bringFieldOnto = () => {
    run(async () => {
      const r = await addFieldToRoster();
      if (r.ok) {
        setNotice(
          r.added > 0
            ? `${r.added} added to the roster from the field.`
            : "Everyone in the field was already on the roster — the entries are linked to them now.",
        );
      }
      return r;
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
          // Named, and split by what is actually missing. The organizer's next
          // move is to open those members and fill the detail in, and neither a
          // count nor a merged list tells them which detail or whose.
          if (r.needEmail.length) bits.push(`no email for ${listNames(r.needEmail)} — not entered`);
          if (r.needPhone.length) bits.push(`no mobile for ${listNames(r.needPhone)} — not entered`);
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

      {/* A screen that reports a gap and offers no way to close it is half a
          fix. This is the whole remedy: everyone playing becomes a member, and
          the entries point at them, so next season's field is a few clicks
          rather than a retype — which is what the paragraph above promises. */}
      {summary.unlinked > 0 && (
        <div
          className="card elev-sm"
          style={{ marginBottom: 16, borderLeft: "3px solid var(--color-accent)", gap: 8 }}
        >
          <span className="card-title" style={{ fontSize: 14 }}>
            <i className="ph ph-users-three" /> {summary.unlinked} in {eventName}{" "}
            {summary.unlinked === 1 ? "isn’t" : "aren’t"} on the roster
          </span>
          <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.6 }}>
            Their entries are fine and the tournament is unaffected — they were just added before the club
            list existed, so nothing here knows about them. Adding them keeps their details for next season
            instead of retyping the field.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending}
            onClick={bringFieldOnto}
            style={{ alignSelf: "flex-start" }}
          >
            <i className="ph ph-user-plus" />{" "}
            {pending ? "Adding…" : `Add ${summary.unlinked} to the roster`}
          </button>
        </div>
      )}

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
          {/* "of N" rather than a bare count. The number alone answers "how
              many of my members are playing" while being read as "how many
              people are playing", which is how an empty roster beside a full
              field produced a 0 that flatly contradicted Registration. */}
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>
            {summary.linked}
            {summary.fieldSize > 0 && (
              <span className="text-muted" style={{ fontSize: 15 }}> of {summary.fieldSize}</span>
            )}
          </div>
          <div className="text-muted" style={{ fontSize: 12 }}>{summary.note}</div>
        </div>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Type</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 18 }}>{profile.label}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {profile.sharedRoster ? "shared roster" : "your own list of players"}
          </div>
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 13, margin: "0 0 12px", color: "var(--color-danger)" }}>
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
          {/* "Members", the name the sidebar and the page heading use. The
              card called the same list "Roster", so one screen gave one list
              two names — the duplicate door nav.ts warns about in its own
              comment. The word survives in prose, where a synonym is just
              English, but not as a second label. */}
          <span className="card-title" style={{ fontSize: 15, marginRight: "auto" }}>
            Members ({visible.length})
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
          {/* Which of these members are in THIS tournament. A club roster
              outlives any one event and most of it is usually not playing, so
              signing a field up means looking at the people who are not in it
              yet — and searching one name at a time was the only way. */}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }} className="text-muted">
            <span>Show</span>
            <select
              className="input"
              style={{ width: "auto", fontSize: 12, padding: "3px 8px" }}
              value={entryFilter}
              onChange={(e) => setEntryFilter(e.target.value as "all" | "in" | "out")}
            >
              <option value="all">everyone</option>
              <option value="in">only those in {eventName}</option>
              <option value="out">only those not in it</option>
            </select>
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

        {/* Shown whenever anything is ticked, not only when something can be
            added. It used to render on `addable.length > 0`, so ticking three
            members who are already in the field made the whole bar VANISH —
            boxes tick, nothing appears, and there is nothing on screen saying
            why. That is the failure this codebase names outright: refuse with
            an explanation, never silently disappear.

            And the count said "<b>{addable.length}</b> selected", which is not
            what was selected. Tick five where two can be added and it read "2
            selected", which reads as the checkboxes being broken. Both numbers
            are stated now — the selection, and what will actually happen. */}
        {chosen.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              padding: "9px 12px",
              marginTop: 10,
              borderRadius: "var(--radius-md)",
              background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
              fontSize: 13,
            }}
          >
            <span>
              <b>{pick.selected}</b> selected
              {pick.problem && (
                <span className="text-muted" style={{ marginLeft: 6, fontSize: 12 }}>
                  · {pick.problem}
                </span>
              )}
            </span>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginLeft: "auto" }}
              disabled={pending || fieldLocked || addable.length === 0}
              onClick={addSelectedToEvent}
            >
              <i className="ph ph-user-plus" /> Add {addable.length} to {eventName}
            </button>
            {fieldLocked && (
              // Was a `title` only, which never appears on a phone and is not
              // announced to a screen reader — the exact weak pattern called
              // out when the draw button was fixed.
              <span className="text-muted" style={{ fontSize: 12, flexBasis: "100%" }}>
                <i className="ph ph-lock-simple" /> The tournament is locked — unlock it on Tournament
                details to change the field.
              </span>
            )}
          </div>
        )}

        {/* No rows, no table.
            The table is 820px wide by declaration, so an empty one still
            claimed 820px and put a horizontal scrollbar under a list with
            nothing in it — and the empty-state sentence, living in a colSpan
            cell, inherited that width and ran off the right edge. The one
            message a club most needs to read on their first visit was the one
            sentence the screen cut in half. Six columns of headings above no
            rows tell nobody anything anyway. */}
        {visible.length === 0 ? (
          <p
            className="text-muted"
            style={{ fontSize: 13, textAlign: "center", padding: "20px 4px", margin: "10px 0 0" }}
          >
            {members.length === 0
              ? "No members yet. Add one above, or import a field on Registration — everyone you enter joins the roster automatically."
              : "No members match that search."}
          </p>
        ) : (
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
                <Fragment key={m.id}>
                <tr style={{ opacity: m.status === "active" ? 1 : 0.55 }}>
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
                    {m.entryStatus !== "out" && (
                      <span
                        className="tag tag-neutral"
                        style={{ marginLeft: 6, fontSize: 10, whiteSpace: "nowrap" }}
                        title={
                          m.entryStatus === "waitlisted"
                            ? `Signed up for ${eventName}, waiting for a place`
                            : `Already in ${eventName}`
                        }
                      >
                        {m.entryStatus === "waitlisted" ? "waitlisted" : "in field"}
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
                    {/* What this member's own approved cards say they should
                        play off. Opened one member at a time: the record costs
                        several queries each, and a club of two hundred would
                        pay six hundred of them to draw a list nobody has asked
                        a question about. */}
                    <button
                      type="button"
                      className="btn btn-icon"
                      aria-label={`Handicap record for ${m.name}`}
                      disabled={pending}
                      onClick={() => setRecordFor(recordFor === m.id ? null : m.id)}
                    >
                      <i className="ph ph-list-numbers" />
                    </button>
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
                    {/* Present and refusing, rather than absent. It used to
                        render only when entryCount was 0, so the control simply
                        was not there for anybody who had played — and an
                        organizer wondering why they cannot remove a member had
                        nothing on screen to read. The reason is in the
                        accessible name, and in a sentence under the table for
                        everybody else; a `title` alone never appears on a phone
                        and is not announced to a screen reader. */}
                    <button
                      type="button"
                      className="btn btn-icon"
                      aria-label={
                        m.entryCount > 0
                          ? `Cannot remove ${m.name} — they have played in ${m.entryCount} tournament${m.entryCount === 1 ? "" : "s"}. Set them inactive instead.`
                          : `Remove ${m.name} from the roster`
                      }
                      disabled={pending || m.entryCount > 0}
                      onClick={() => run(() => deleteMember(m.id))}
                    >
                      <i className="ph ph-trash" />
                    </button>
                  </td>
                </tr>
                {recordFor === m.id && (
                  <tr>
                    <td colSpan={7} style={{ paddingTop: 0 }}>
                      <ClubHandicapPanel
                        memberId={m.id}
                        memberName={m.name}
                        currentHandicap={m.handicap}
                        onClose={() => setRecordFor(null)}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        )}

        {/* The rule behind the greyed-out bin, said once for the whole table
            rather than not at all. It is the same answer the "Inactive · kept
            for past results" stat card gives, and the archive button that does
            it is in the same row. */}
        {visible.some((m) => m.entryCount > 0) && (
          <p className="text-muted" style={{ fontSize: 12, margin: "10px 0 0", lineHeight: 1.5 }}>
            <i className="ph ph-info" /> A member who has played cannot be removed — their results
            would lose the person they belong to. Set them inactive instead: they drop out of every
            field and stay in the record.
          </p>
        )}
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
