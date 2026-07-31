"use client";
import { useState, useTransition } from "react";
import { signInAction } from "@/app/actions/auth";

interface AccountCard {
  id: string;
  name: string;
  role: string;
}
interface EventCard {
  id: string;
  name: string;
  meta: string;
  status: string;
  tagClass: string;
  accounts: AccountCard[];
}

export function LoginPanel({ events }: { events: EventCard[] }) {
  const [openId, setOpenId] = useState<string | null>(events[0]?.id ?? null);
  const [pending, startTransition] = useTransition();

  return (
    <div style={{ width: "min(400px, 100%)", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div
          className="text-muted"
          style={{ fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase" }}
        >
          Organizer sign-in
        </div>
        <h3 style={{ margin: "6px 0 0", fontSize: 22 }}>Choose an event to manage</h3>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {events.map((evt) => {
          const open = openId === evt.id;
          return (
            <div key={evt.id}>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : evt.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "var(--color-surface)",
                  border: `1px solid ${open ? "var(--color-accent)" : "var(--color-divider)"}`,
                  borderRadius: "var(--radius-md)",
                  padding: "14px 16px",
                  cursor: "pointer",
                  color: "var(--color-text)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span>
                  <span
                    style={{
                      display: "block",
                      fontFamily: "var(--font-heading)",
                      fontWeight: 500,
                      fontSize: 15,
                    }}
                  >
                    {evt.name}
                  </span>
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    {evt.meta}
                  </span>
                </span>
                <span className={`tag ${evt.tagClass}`}>{evt.status}</span>
              </button>
              {open && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "10px 4px 2px",
                  }}
                >
                  <div className="text-muted" style={{ fontSize: 11, paddingLeft: 4 }}>
                    Sign in as
                  </div>
                  {evt.accounts.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      disabled={pending}
                      className="btn btn-secondary"
                      style={{ justifyContent: "space-between" }}
                      onClick={() => startTransition(() => signInAction(a.id))}
                    >
                      <span>{a.name}</span>
                      <span className={`tag ${a.role === "admin" ? "tag-accent" : "tag-neutral"}`}>
                        {a.role === "admin" ? "Organizer" : "Player"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
