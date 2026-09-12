"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import { PLAYER_TABS, PLAYER_MONEY_TAB } from "@/lib/player-nav";

/**
 * The four tabs, and the conditional fifth, come from `player-nav.ts` — the
 * same list `screenName` titles these screens from. They used to live here as
 * a constant in a "use client" component, which is unreachable from a server
 * component, which is why five of the six player screens had no browser-tab
 * title at all and read the marketing sentence instead.
 */

export function PlayTabs({ showMoney = false }: { showMoney?: boolean }) {
  const path = usePathname();
  const tabs = showMoney ? [...PLAYER_TABS, PLAYER_MONEY_TAB] : PLAYER_TABS;

  return (
    <nav
      aria-label="Sections"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 30,
        display: "flex",
        justifyContent: "space-around",
        background: "color-mix(in srgb, var(--color-bg) 94%, transparent)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderTop: "1px solid var(--color-divider)",
        // The home-indicator strip, and the side insets in landscape.
        padding:
          "6px calc(4px + env(safe-area-inset-right, 0px)) calc(6px + env(safe-area-inset-bottom, 0px)) calc(4px + env(safe-area-inset-left, 0px))",
      }}
    >
      {tabs.map((t) => {
        // Exact match for the root tab, prefix for the rest — otherwise
        // "Today" stays lit on every screen because every path starts /me.
        const active = t.href === "/me" ? path === "/me" : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            style={{
              flex: 1,
              minHeight: 52,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              textDecoration: "none",
              color: active ? "var(--color-accent)" : "var(--color-neutral-400)",
              fontSize: 11,
              fontWeight: active ? 700 : 500,
            }}
          >
            {/* Falls back to the outline for a screen with no filled variant.
                Every TAB has one; the fallback is for a screen that reaches
                this bar without being one, where drawing nothing would be a
                silent empty box. */}
            <Icon name={active ? (t.iconActive ?? t.icon) : t.icon} style={{ fontSize: 21 }} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
