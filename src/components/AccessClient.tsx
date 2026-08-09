"use client";
import { useState, useTransition } from "react";
import { addAccount, setAccountRole, removeAccount } from "@/app/actions/tournament";
import { ROLE_OPTS, describeRoleChange, type RoleChange } from "@/lib/access-roles";

interface AccountRow {
  id: string;
  name: string;
  email: string;
  role: string;
}

/**
 * The inline confirmation for a role change.
 *
 * A separate press, not a dialog — dialogs get dismissed on reflex, and the
 * whole point is that a re-role has to be read before it happens. The button
 * restates the change in full, and a demotion (especially the last organizer's)
 * says what is being given up rather than just "Confirm".
 */
export function RoleChangeConfirm({
  change,
  pending,
  onConfirm,
  onCancel,
}: {
  change: RoleChange;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      <p style={{ fontSize: 12.5, margin: 0, lineHeight: 1.45 }}>
        Change <b>{change.name}</b> from {change.from} to <b>{change.to}</b>?
        {change.lastAdmin ? (
          <span style={{ display: "block", color: "var(--color-danger, #e0665a)", marginTop: 2 }}>
            <i className="ph ph-warning" /> This is the only Organizer on the event — promote someone else first,
            or this will be refused.
          </span>
        ) : change.demotion ? (
          <span className="text-muted" style={{ display: "block", marginTop: 2 }}>
            {change.name} loses {change.from} access.
          </span>
        ) : null}
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn"
          style={
            change.demotion
              ? {
                  fontSize: 12.5,
                  color: "var(--color-danger)",
                  borderColor: "color-mix(in srgb, var(--color-danger) 50%, transparent)",
                }
              : { fontSize: 12.5 }
          }
          disabled={pending}
          onClick={onConfirm}
        >
          <i className="ph ph-check" /> {pending ? "Saving…" : `Yes — make ${change.name} ${change.to}`}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: 12.5 }}
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function AccessClient({ accounts }: { accounts: AccountRow[] }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("player");
  const [error, setError] = useState("");
  // The role change awaiting a second, deliberate press. Only ever one at a
  // time — picking a role on another row moves the confirmation there.
  const [confirm, setConfirm] = useState<{ accountId: string; next: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // Same count the server guards on, so "the only Organizer" reads the same way
  // in the warning as it does in the refusal.
  const adminCount = accounts.filter((a) => a.role === "admin").length;

  // The role a row's radios should show: the pending choice if this row is the
  // one being changed, otherwise the committed role.
  const shownRole = (a: AccountRow) => (confirm?.accountId === a.id ? confirm.next : a.role);

  const requestRole = (a: AccountRow, next: string) => {
    setError("");
    // Re-picking the current role just cancels any pending confirmation.
    if (a.role === next) {
      setConfirm(null);
      return;
    }
    setConfirm({ accountId: a.id, next });
  };

  const commitRole = () => {
    if (!confirm) return;
    const { accountId, next } = confirm;
    setError("");
    startTransition(async () => {
      const result = await setAccountRole(accountId, next);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setConfirm(null);
    });
  };

  const doRemove = (accountId: string) => {
    setError("");
    startTransition(async () => {
      const result = await removeAccount(accountId);
      if (!result.ok) setError(result.error ?? "Something went wrong.");
    });
  };

  return (
    <div className="page-split" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 16, alignItems: "start" }}>
      <div className="card elev-sm">
        <span className="card-title" style={{ fontSize: 15 }}>Accounts</span>
        <p className="text-muted" style={{ fontSize: 12, margin: "-2px 0 4px" }}>
          <b>Organizer</b> — full control. <b>Assistant</b> — operational tasks (players, flights, rounds,
          scores), but not event setup, access, or deletion. <b>Player</b> — schedule, scores, leaderboard.
        </p>
        {error && (
          <p style={{ fontSize: 13, margin: "0 0 4px", color: "var(--color-danger, #e0665a)" }}>
            <i className="ph ph-warning-circle" /> {error}
          </p>
        )}
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th style={{ width: 260 }}>Role</th>
                <th style={{ width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const change =
                  confirm?.accountId === a.id ? describeRoleChange(a, confirm.next, adminCount) : null;
                return (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 500 }}>{a.name}</td>
                    <td className="text-muted">{a.email}</td>
                    <td>
                      <div className="seg">
                        {ROLE_OPTS.map((o) => (
                          <label className="seg-opt" key={o.v}>
                            <input
                              type="radio"
                              name={`role-${a.id}`}
                              checked={shownRole(a) === o.v}
                              disabled={pending}
                              onChange={() => requestRole(a, o.v)}
                            />
                            {o.l}
                          </label>
                        ))}
                      </div>
                      {change && (
                        <RoleChangeConfirm
                          change={change}
                          pending={pending}
                          onConfirm={commitRole}
                          onCancel={() => setConfirm(null)}
                        />
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn btn-icon"
                        disabled={pending}
                        onClick={() => doRemove(a.id)}
                      >
                        <i className="ph ph-x" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card elev-sm" style={{ gap: 12 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Add account</span>
        <div className="field"><label>Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>Email</label><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field">
          <label>Role</label>
          <div className="seg">
            {ROLE_OPTS.map((o) => (
              <label className="seg-opt" key={o.v}>
                <input type="radio" name="newrole" checked={role === o.v} onChange={() => setRole(o.v)} />
                {o.l}
              </label>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={pending || !name.trim() || !email.trim()}
          onClick={() => {
            setError("");
            startTransition(async () => {
              const result = await addAccount(name, email, role);
              if (!result.ok) {
                setError(result.error ?? "Something went wrong.");
                return;
              }
              setName("");
              setEmail("");
              setRole("player");
            });
          }}
        >
          <i className="ph ph-plus" /> Add account
        </button>
      </div>
    </div>
  );
}
