import { Logo, LOGO_SIZE } from "./Logo";
import { BrandMark } from "./BrandMark";

/** Sticky top bar shown only on phones (hidden on desktop via .mobile-only). */
export function MobileTopBar() {
  return (
    // Typography lives on BrandMark now; the bar only positions the lockup.
    <div className="m-topbar mobile-only">
      <Logo size={LOGO_SIZE.sm} style={{ color: "var(--color-accent)" }} /> <BrandMark size={LOGO_SIZE.sm} />
    </div>
  );
}
