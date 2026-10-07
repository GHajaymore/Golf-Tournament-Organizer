"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";

/**
 * The way back to a casual round's one screen, from the few pages its More
 * opens — the money in full, the export, the rules.
 *
 * A casual round has no tab bar and no sidebar (see `(app)/layout.tsx`), so
 * without this those pages would be dead ends with nothing but the browser's
 * back button. Not drawn on the round screen itself, which is where it leads.
 */
export function BackToTheRound() {
  const pathname = usePathname();
  if (pathname === "/entry") return null;
  return (
    <Link
      href="/entry"
      className="touch-target"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 600, color: "var(--color-accent-200)", marginBottom: 8 }}
    >
      <Icon name="caret-left" aria-hidden /> Back to the round
    </Link>
  );
}
