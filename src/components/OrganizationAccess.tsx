"use client";
import { useState, useTransition } from "react";
import {
  addOrganizationMember,
  setOrganizationMemberRole,
  removeOrganizationMember,
} from "@/app/actions/organization";
import type { AccessReport } from "@/lib/services/access";

const ORG_ROLE_OPTS = [
  { v: "owner", l: "Owner" },
  { v: "admin", l: "Admin" },
  { v: "member", l: "Member" },
];

const ORG_ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };
const EVENT_ROLE_LABEL: Record<string, string> = { admin: "Organizer", assistant: "Assistant", player: "Player" };

export function OrganizationAccess({ report, canEdit }: { report: AccessReport; canEdit: boolean }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("member");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setError("");
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      after?.();
    });
  };

  const staff = report.people.filter((p) => p.orgRole);
  const eventOnly = report.people.filter((p) => !p.orgRole);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && (
        <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger, #e0665a)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}

      {/* ── Staff ─────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
        <div className="card elev-sm">
          <span className="card-title" style={{ fontSize: 15 }}>Organization staff ({staff.length})</span>
          <p className="text-muted" style={{ fontSize: 12, margin: "-2px 0 4px" }}>
            <b>Owner</b> — billing and ownership. <b>Admin</b> — organizer on every tournament this
            organization runs, without being added to each one. <b>Member</b> — staff pool; access only where
            explicitly given on an event.
          </p>
          <div className="table-scroll">
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th style={{ width: 210 }}>Organization role</th>
                  <th style={{ width: 90 }}>Tournaments</th>
                  <th style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {staff.map((p) => (
                  <tr key={p.email}>
                    <td style={{ fontWeight: 500 }}>
                      {p.name || "—"}
                      {!p.hasLogin && (
                        <span className="tag tag-neutral" style={{ marginLeft: 6, fontSize: 10 }} title="Hasn't set a password yet">
                          invited
                        </span>
                      )}
                    </td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{p.email}</td>
                    <td>
                      <div className="seg">
                        {ORG_ROLE_OPTS.map((o) => (
                          <label className="seg-opt" key={o.v}>
                            <input
                              type="radio"
                              name={`orgrole-${p.memberId}`}
                              checked={p.orgRole === o.v}
                              disabled={!canEdit || pending}
                              onChange={() => run(() => setOrganizationMemberRole(p.memberId!, o.v))}
                            />
                            {o.l}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                      {Object.keys(p.access).length}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn btn-icon"
                        disabled={!canEdit || pending}
                        title="Remove from organization"
                        onClick={() => run(() => removeOrganizationMember(p.memberId!))}
                      >
                        <i className="ph ph-x" />
                      </button>
                    </td>
                  </tr>
                ))}
                {staff.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-muted" style={{ padding: "10px 6px" }}>
                      No staff yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card elev-sm" style={{ gap: 12 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Add staff</span>
          <p className="text-muted" style={{ fontSize: 12, margin: "-4px 0 0" }}>
            Pro shop staff and co-organizers. Players are added per tournament on Registration — they never
            take a staff seat.
          </p>
          <div className="field">
            <label>Name</label>
            <input className="input" value={name} disabled={!canEdit || pending} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Email</label>
            <input
              className="input"
              type="email"
              value={email}
              disabled={!canEdit || pending}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@club.com"
            />
          </div>
          <div className="field">
            <label>Role</label>
            <div className="seg">
              {ORG_ROLE_OPTS.map((o) => (
                <label className="seg-opt" key={o.v}>
                  <input
                    type="radio"
                    name="neworgrole"
                    checked={role === o.v}
                    disabled={!canEdit || pending}
                    onChange={() => setRole(o.v)}
                  />
                  {o.l}
                </label>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={!canEdit || pending || !email.trim()}
            onClick={() =>
              run(
                () => addOrganizationMember(email, name, role),
                () => {
                  setEmail("");
                  setName("");
                  setRole("member");
                },
              )
            }
          >
            <i className="ph ph-plus" /> Add staff
          </button>
          {!canEdit && (
            <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
              Only an owner or admin can manage staff.
            </p>
          )}
        </div>
      </div>

      {/* ── Access report ─────────────────────────────────────────────── */}
      <div className="card elev-sm">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Who can access what</span>
          <span className="text-muted" style={{ fontSize: 12 }}>
            {report.people.length} people · {report.events.length} tournaments
          </span>
        </div>
        <p className="text-muted" style={{ fontSize: 12, margin: "-2px 0 6px" }}>
          Effective access, including roles inherited from an organization role. A
          <span className="tag tag-neutral" style={{ margin: "0 4px", fontSize: 10 }}>club</span>
          marker means the person was never added to that tournament directly.
        </p>

        {report.events.length === 0 ? (
          <span className="text-muted" style={{ fontSize: 13 }}>No tournaments yet.</span>
        ) : (
          <div className="table-scroll">
            <table className="table" style={{ fontSize: 12, minWidth: 520 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 170 }}>Person</th>
                  <th style={{ width: 90 }}>Org role</th>
                  {report.events.map((e) => (
                    <th key={e.id} style={{ textAlign: "center", minWidth: 110 }}>
                      {e.name || "Untitled"}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.people.map((p) => (
                  <tr key={p.email}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{p.name || p.email}</div>
                      {p.name && <div className="text-muted" style={{ fontSize: 11 }}>{p.email}</div>}
                    </td>
                    <td>
                      {p.orgRole ? (
                        <span className={`tag ${p.orgRole === "owner" ? "tag-accent" : "tag-neutral"}`}>
                          {ORG_ROLE_LABEL[p.orgRole] ?? p.orgRole}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    {report.events.map((e) => {
                      const a = p.access[e.id];
                      return (
                        <td key={e.id} style={{ textAlign: "center" }}>
                          {a ? (
                            <span
                              className={`tag ${a.role === "admin" ? "tag-accent" : "tag-neutral"}`}
                              title={a.source === "organization" ? "Inherited from organization role" : "Granted on this tournament"}
                            >
                              {EVENT_ROLE_LABEL[a.role] ?? a.role}
                              {a.source === "organization" ? " · club" : ""}
                            </span>
                          ) : (
                            <span className="text-muted">·</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {eventOnly.length > 0 && (
          <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
            {eventOnly.length} of these hold access through individual tournaments only, and are not
            organization staff — mostly players.
          </p>
        )}
      </div>
    </div>
  );
}
