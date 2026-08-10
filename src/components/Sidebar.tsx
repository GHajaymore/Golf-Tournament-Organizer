"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import type { NavSection } from "@/lib/nav";
import { signOutAction, setPreviewAction } from "@/app/actions/auth";
import { Logo, LOGO_SIZE } from "@/components/Logo";
import { BrandMark } from "@/components/BrandMark";
import { OrgBrand, type Brand } from "@/components/OrgBrand";

type Role = "admin" | "assistant" | "player";

const roleLabel = (r: Role) => (r === "admin" ? "Organizer" : r === "assistant" ? "Assistant" : "Player");

interface Props {
  sections: NavSection[];
  name: string;
  role: Role;
  viewRole: Role;
  initials: string;
  /** Owning organization's branding; falls back to TourneyHQ when unset. */
  brand?: Brand | null;
}

export function Sidebar({ sections, name, role, viewRole, initials, brand }: Props) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <aside
      className="app-sidebar"
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
          padding: "6px 8px 14px",
          fontFamily: "var(--font-heading)",
          fontWeight: 700,
          fontSize: 18,
          letterSpacing: "-0.01em",
        }}
      >
        {brand?.name ? (
          <OrgBrand brand={brand} size={20} />
        ) : (
          <>
            <div
              style={{
                width: 30,
                height: 30,
                flex: "none",
                display: "grid",
                placeItems: "center",
                borderRadius: 8,
                background: "color-mix(in srgb, var(--color-accent) 16%, transparent)",
              }}
            >
              <Logo size={LOGO_SIZE.sm} style={{ color: "var(--color-accent)" }} />
            </div>
            <BrandMark size={LOGO_SIZE.sm} />
          </>
        )}
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
            <select
              className="input"
              value={viewRole}
              disabled={pending}
              onChange={(e) => startTransition(() => setPreviewAction(e.target.value))}
              style={{ width: "100%", padding: "6px 8px" }}
            >
              <option value="admin">Organizer</option>
              <option value="assistant">Assistant</option>
              <option value="player">Player</option>
            </select>
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
              {roleLabel(viewRole)}
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
