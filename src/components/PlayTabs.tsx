"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Four tabs, and deliberately only four.
 *
 * The console's sidebar has fifteen entries because an organizer genuinely
 * does fifteen things. A player does four, and every extra one is something
 * to read past while standing on a tee. If a fifth is ever needed, something
 * here should have to leave.
 *
 * Money is the exception, and it earns it by being CONDITIONAL: it appears
 * only for a tournament that is actually splitting costs, so a Wednesday
 * league that never buys a round together still has four. Nothing had to
 * leave, and nobody is asked to read past a tab their event does not use.
 */
const TABS = [
  { href: "/me", label: "Today", icon: "ph-flag" },
  { href: "/me/board", label: "Board", icon: "ph-ranking" },
  { href: "/me/card", label: "My card", icon: "ph-cards" },
  { href: "/me/rules", label: "Rules", icon: "ph-book-open" },
];

const MONEY_TAB = { href: "/me/money", label: "Money", icon: "ph-receipt" };

export function PlayTabs({ showMoney = false }: { showMoney?: boolean }) {
  const path = usePathname();
  const tabs = showMoney ? [...TABS, MONEY_TAB] : TABS;

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
            <i className={`${active ? "ph-fill" : "ph"} ${t.icon}`} style={{ fontSize: 21 }} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
