import { Logo } from "./Logo";

/** Sticky top bar shown only on phones (hidden on desktop via .mobile-only). */
export function MobileTopBar() {
  return (
    <div className="m-topbar mobile-only">
      <Logo size={20} /> Flights
    </div>
  );
}
