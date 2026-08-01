"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import type { NavSection } from "@/lib/nav";
import { signOutAction, setPreviewAction } from "@/app/actions/auth";
import { Logo } from "./Logo";

type Role = "admin" | "assistant" | "player";

const roleLabel = (r: Role) => (r === "admin" ? "Organizer" : r === "assistant" ? "Assistant" : "Player");

interface Props {
  sections: NavSection[];
  name: string;
  role: Role;
  viewRole: Role;
  initials: string;
}

const TABS = [
  { href: "/dashboard", label: "Dashboard", icon: "ph ph-squares-four" },
  { href: "/leaderboard", label: "Board", icon: "ph ph-ranking" },
  { href: "/entry", label: "Scores", icon: "ph ph-pencil-simple" },
];

export function MobileTabBar({ sections, name, role, viewRole, initials }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <nav className="m-tabbar mobile-only">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="m-tab"
            aria-current={pathname === t.href ? "page" : undefined}
          >
            <i className={t.icon} />
            <span>{t.label}</span>
          </Link>
        ))}
        <button
          type="button"
          className={`m-tab ${open ? "m-active" : ""}`}
          onClick={() => setOpen(true)}
          aria-label="Open menu"
        >
          <i className="ph ph-list" />
          <span>Menu</span>
        </button>
      </nav>

      {open && (
        <>
          <div className="m-drawer-backdrop mobile-only" onClick={() => setOpen(false)} />
          <div className="m-drawer">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 9, fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 16 }}>
                <Logo size={20} /> Flights
              </span>
              <button type="button" className="btn btn-icon" onClick={() => setOpen(false)} aria-label="Close menu">
                <i className="ph ph-x" />
              </button>
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
                {sec.items.map((it) => (
                  <Link
                    key={it.key}
                    href={it.href}
                    className="side-link"
                    aria-current={pathname === it.href ? "page" : undefined}
                    onClick={() => setOpen(false)}
                  >
                    <i className={it.icon} />
                    <span>{it.label}</span>
                  </Link>
                ))}
              </div>
            ))}

            <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--color-divider)", display: "flex", flexDirection: "column", gap: 10 }}>
              {role === "admin" && (
                <div>
                  <div className="text-muted" style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>
                    Viewing as
                  </div>
                  <div className="seg" style={{ width: "100%" }}>
                    <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                      <input type="radio" name="mroleview" checked={viewRole === "admin"} disabled={pending} onChange={() => startTransition(() => setPreviewAction(false))} />
                      Organizer
                    </label>
                    <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                      <input type="radio" name="mroleview" checked={viewRole === "player"} disabled={pending} onChange={() => startTransition(() => setPreviewAction(true))} />
                      Player
                    </label>
                  </div>
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--color-accent-800)", color: "var(--color-accent-100)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600 }}>
                  {initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13 }}>{name}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{roleLabel(viewRole)}</div>
                </div>
                <button type="button" className="btn btn-icon" title="Sign out" onClick={() => startTransition(() => signOutAction())}>
                  <i className="ph ph-sign-out" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
