"use client";
import { useState, useTransition } from "react";
import { addAccount, setAccountRole, removeAccount } from "@/app/actions/tournament";

interface AccountRow {
  id: string;
  name: string;
  email: string;
  role: string;
}

export function AccessClient({ accounts }: { accounts: AccountRow[] }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("player");
  const [pending, startTransition] = useTransition();

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
      <div className="card elev-sm">
        <span className="card-title" style={{ fontSize: 15 }}>Accounts</span>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th style={{ width: 200 }}>Role</th>
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
                    <label className="seg-opt">
                      <input
                        type="radio"
                        name={`role-${a.id}`}
                        checked={a.role === "admin"}
                        disabled={pending}
                        onChange={() => startTransition(() => setAccountRole(a.id, "admin"))}
                      />
                      Organizer
                    </label>
                    <label className="seg-opt">
                      <input
                        type="radio"
                        name={`role-${a.id}`}
                        checked={a.role !== "admin"}
                        disabled={pending}
                        onChange={() => startTransition(() => setAccountRole(a.id, "player"))}
                      />
                      Player
                    </label>
                  </div>
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className="btn btn-icon"
                    disabled={pending}
                    onClick={() => startTransition(() => removeAccount(a.id))}
                  >
                    <i className="ph ph-x" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card elev-sm" style={{ gap: 12 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Add account</span>
        <div className="field"><label>Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>Email</label><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field">
          <label>Role</label>
          <div className="seg">
            <label className="seg-opt">
              <input type="radio" name="newrole" checked={role === "admin"} onChange={() => setRole("admin")} /> Organizer
            </label>
            <label className="seg-opt">
              <input type="radio" name="newrole" checked={role === "player"} onChange={() => setRole("player")} /> Player
            </label>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={pending || !name.trim() || !email.trim()}
          onClick={() => {
            startTransition(() => addAccount(name, email, role));
            setName("");
            setEmail("");
            setRole("player");
          }}
        >
          <i className="ph ph-plus" /> Add account
        </button>
      </div>
    </div>
  );
}
