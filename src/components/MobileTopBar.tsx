import { LOGO_SIZE } from "./Logo";
import { Lockup } from "./Lockup";

/**
 * Sticky top bar shown only on phones (hidden on desktop via .mobile-only) —
 * or at every width with `always`, for a casual round, which has no sidebar to
 * carry the mark on a desktop.
 */
export function MobileTopBar({ always = false }: { always?: boolean }) {
  return (
    // The one lockup, at the scale's dense-bar step; it sizes the mark itself.
    <div className={always ? "m-topbar" : "m-topbar mobile-only"} style={always ? { display: "flex" } : undefined}>
      <Lockup size={LOGO_SIZE.sm} />
    </div>
  );
}
