import { Logo } from "./Logo";
import { BrandMark } from "./BrandMark";

/** Sticky top bar shown only on phones (hidden on desktop via .mobile-only). */
export function MobileTopBar() {
  return (
    <div className="m-topbar mobile-only" style={{ fontWeight: 700, letterSpacing: "-0.01em" }}>
      <Logo size={19} style={{ color: "var(--color-accent)" }} /> <BrandMark />
    </div>
  );
}
