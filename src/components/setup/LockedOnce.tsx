import type { ReactNode } from "react";
import { ScopeLockBanner, scopeLockBannerDrawn } from "@/components/ScopeLockBanner";
import type { CorrectionFacts, ScopeLock } from "@/lib/domain/tournament-status";

/**
 * A LOCKED SECTION SAYS WHY ONCE (R1b): the machine's banner above, one boolean handed down.
 *
 * `children` is a function of `locked`: a `SetupField` under a lock gets `onChange={null}` and draws
 * no control, and no field repeats the reason. This wraps `ScopeLockBanner`; it does not copy its
 * rules (`scopeLockBannerDrawn`, `bannerName` stay there). `locked` is true while any lock is
 * passed: a correction or an `open` line alone draws the banner but locks nothing.
 */
export interface LockedOnceProps {
  locks: readonly ScopeLock[];
  isAdmin: boolean;
  correction: CorrectionFacts | null;
  open: readonly string[] | null;
  children: (locked: boolean) => ReactNode;
}

export function LockedOnce({ locks, isAdmin, correction, open, children }: LockedOnceProps) {
  const drawn = scopeLockBannerDrawn(locks, correction, open);
  return (
    <div data-locked-once={locks.length > 0 ? "locked" : "open"} style={{ minWidth: 0 }}>
      {drawn && <ScopeLockBanner locks={locks} isAdmin={isAdmin} correction={correction} open={open} />}
      {children(locks.length > 0)}
    </div>
  );
}
