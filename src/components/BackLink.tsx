"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

/**
 * The way back.
 *
 * The player shell has four tabs and no back button, which is fine for the
 * tabs themselves and wrong for everything one level deeper — a card, the
 * money screen, a rules page. On a phone that leaves the browser's own
 * gesture as the only way out, and inside an installed PWA there is no browser
 * chrome at all: the app becomes a room with no door.
 *
 * Prefers real history so it behaves the way the device does, and falls back
 * to a known parent when there is none — arriving from a shared link, a
 * notification, or a cold start into a sub-screen. "Back" that lands nowhere
 * is worse than no back at all.
 *
 * Renders nothing on a tab root, where "back" would be leaving the app.
 */
export function BackLink({
  /** Where to go when this screen was opened directly. */
  fallback = "/me",
  label = "Back",
}: {
  fallback?: string;
  label?: string;
}) {
  const router = useRouter();
  const path = usePathname();

  // The tab roots. Nothing above these belongs to the player app.
  if (["/me", "/me/board", "/me/card", "/me/rules", "/me/money"].includes(path)) return null;

  return (
    <Link
      href={fallback}
      onClick={(e) => {
        // History if there is any, so Back means what the phone's own back
        // means. `history.length > 1` is the only signal available, and it is
        // right often enough; the href is what makes the failure harmless.
        if (typeof window !== "undefined" && window.history.length > 1) {
          e.preventDefault();
          router.back();
        }
      }}
      className="touch-target"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 44,
        fontSize: 13.5,
        textDecoration: "none",
        color: "var(--color-neutral-400)",
      }}
    >
      <i className="ph ph-caret-left" style={{ fontSize: 18 }} aria-hidden />
      {label}
    </Link>
  );
}
