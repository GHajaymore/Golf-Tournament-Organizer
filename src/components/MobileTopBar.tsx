import { LOGO_SIZE } from "./Logo";
import { Lockup } from "./Lockup";

/** Sticky top bar shown only on phones (hidden on desktop via .mobile-only). */
export function MobileTopBar() {
  return (
    // The one lockup, at the scale's dense-bar step; it sizes the mark itself.
    <div className="m-topbar mobile-only">
      <Lockup size={LOGO_SIZE.sm} />
    </div>
  );
}
