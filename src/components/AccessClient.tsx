"use client";
import { useState, useTransition } from "react";
import { addAccount, setAccountRole, removeAccount } from "@/app/actions/tournament";

interface AccountRow {
  id: string;
  name: string;
  email: string;
  role: string;
}

const ROLE_OPTS = [
  { v: "admin", l: "Organizer" },
  { v: "assistant", l: "Assistant" },
  { v: "player", l: "Player" },
];

export function AccessClient({ accounts }: { accounts: AccountRow[] }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("player");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const doSetRole = (accountId: string, next: string) => {
    setError("");
    startTransition(async () => {
      const result = await setAccountRole(accountId, next);
      if (!result.ok) setError(result.error ?? "Something went wrong.");
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
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
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
              {accounts.map((a) => (
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
                            checked={a.role === o.v}
                            disabled={pending}
                            onChange={() => doSetRole(a.id, o.v)}
                          />
                          {o.l}
                        </label>
                      ))}
                    </div>
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
              ))}
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
