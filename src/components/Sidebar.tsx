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
    /**
     * THREE BANDS, and only the middle one scrolls.
     *
     * This used to be one scrolling column: `overflow: auto` on the aside with
     * the footer pushed down by `margin-top: auto`. That works only while the
     * content fits. Once it does not, `margin-top: auto` has no free space to
     * distribute, so the footer stops being "at the bottom of the screen" and
     * becomes "after the last link" — below the fold, reachable only by
     * scrolling a sidebar most people never think to scroll.
     *
     * Measured on the running app against the seeded demo club, sidebar at
     * scrollTop 0:
     *
     *   1440x900   172px hidden — Sign out at y=1020, "Viewing as" at y=974,
     *              and the last link, Group games, ending at 938
     *   1366x768   304px hidden — the same, plus Messages, Reports & export,
     *              Prizes & payouts and Group games all below the fold
     *
     * So on the commonest laptop screen there is no visible way to sign out,
     * the role preview is invisible, and the whole Money section is gone.
     *
     * Now: the brand and the footer are fixed bands that cannot scroll away,
     * and the nav between them takes the leftover height and scrolls on its
     * own. `min-height: 0` is the load-bearing part — a flex child's default
     * `min-height: auto` refuses to shrink below its content, which would push
     * the footer straight back off the screen and leave this looking unchanged.
     */
    <aside
      className="app-sidebar"
      style={{
        width: 250,
        flex: "none",
        borderRight: "1px solid var(--color-divider)",
        display: "flex",
        flexDirection: "column",
        position: "sticky",
        top: 0,
        height: "100vh",
        // The aside itself never scrolls now; the nav band inside it does.
        overflow: "hidden",
      }}
    >
      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 9,
          // 22/20 rather than 6/8: the aside's own 16px/12px padding moved onto
          // the three bands when it stopped being a single scrolling column, so
          // these absorb it and the mark sits exactly where it did.
          padding: "22px 20px 14px",
          fontFamily: "var(--font-heading)",
          fontWeight: 700,
          fontSize: 18,
          letterSpacing: "-0.01em",
        }}
      >
        {/* sm: the scale's "beside a nav label or in a dense bar". A bare 20
            was a fifth size nobody chose and no guard was catching. */}
        {brand?.name ? (
          <OrgBrand brand={brand} size={LOGO_SIZE.sm} />
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

      {/* The only band that scrolls. min-height:0 is what allows it to. */}
      <nav
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "0 12px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
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
      </nav>

      <div
        style={{
          /**
           * `marginTop: auto` is GONE, and its absence is the fix. It only ever
           * placed this at the bottom while everything fitted; once the nav
           * overflowed there was no free space to push with, and this landed
           * below the fold. The nav band above now takes the slack instead, so
           * this sits on the bottom edge at any height.
           */
          flex: "none",
          // Horizontal margin rather than padding, so the divider stays inset
          // from the sidebar's edges exactly as it did when the aside's own
          // 12px padding was doing it.
          margin: "0 12px",
          paddingTop: 12,
          paddingBottom: 16,
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
