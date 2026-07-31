"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import type { NavSection } from "@/lib/nav";
import { signOutAction, setPreviewAction } from "@/app/actions/auth";

interface Props {
  sections: NavSection[];
  name: string;
  role: "admin" | "player";
  viewRole: "admin" | "player";
  initials: string;
}

export function Sidebar({ sections, name, role, viewRole, initials }: Props) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <aside
      style={{
        width: 250,
        flex: "none",
        borderRight: "1px solid var(--color-divider)",
        padding: "16px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        position: "sticky",
        top: 0,
        height: "100vh",
        overflow: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "6px 8px 12px",
          fontFamily: "var(--font-heading)",
          fontWeight: 500,
          fontSize: 16,
        }}
      >
        <i className="ph-fill ph-golf" style={{ color: "var(--color-accent)", fontSize: 21 }} />{" "}
        Nocturne Golf
      </div>

      {sections.map((sec) => (
        <div key={sec.label}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.13em",
              textTransform: "uppercase",
              color: "var(--color-neutral-500)",
              margin: "12px 8px 3px",
            }}
          >
            {sec.label}
          </div>
          {sec.items.map((it) => {
            const active = pathname === it.href;
            return (
              <Link
                key={it.key}
                href={it.href}
                className="side-link"
                aria-current={active ? "page" : undefined}
              >
                <i className={it.icon} />
                <span>{it.label}</span>
              </Link>
            );
          })}
        </div>
      ))}

      <div
        style={{
          marginTop: "auto",
          paddingTop: 12,
          borderTop: "1px solid var(--color-divider)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {role === "admin" && (
          <div>
            <div
              className="text-muted"
              style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}
            >
              Viewing as
            </div>
            <div className="seg" style={{ width: "100%" }}>
              <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                <input
                  type="radio"
                  name="roleview"
                  checked={viewRole === "admin"}
                  disabled={pending}
                  onChange={() => startTransition(() => setPreviewAction(false))}
                />
                Organizer
              </label>
              <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                <input
                  type="radio"
                  name="roleview"
                  checked={viewRole === "player"}
                  disabled={pending}
                  onChange={() => startTransition(() => setPreviewAction(true))}
                />
                Player
              </label>
            </div>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "var(--color-accent-800)",
              color: "var(--color-accent-100)",
              display: "grid",
              placeItems: "center",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13 }}>{name}</div>
            <div className="text-muted" style={{ fontSize: 11 }}>
              {viewRole === "admin" ? "Organizer" : "Player"}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-icon"
            title="Sign out"
            onClick={() => startTransition(() => signOutAction())}
          >
            <i className="ph ph-sign-out" />
          </button>
        </div>
      </div>
    </aside>
  );
}
