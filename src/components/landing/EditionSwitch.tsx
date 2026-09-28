"use client";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { US_OVERRIDE_COOKIE } from "@/lib/landing/edition";

/**
 * "Show US $ and US terms", and the way back.
 *
 * Ajay, 2026-09-27: local by default, with a switch to US dollars and US golf
 * words. The choice is a cookie so the SERVER renders the page in it — prices,
 * words and screenshots together, with nothing flashing — and it is kept for
 * a year on this device. The label comes in as children so the page's own
 * word swaps reach it like any other text.
 */
export function EditionSwitch({ toUs, children }: { toUs: boolean; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const flip = () => {
    document.cookie = toUs
      ? `${US_OVERRIDE_COOKIE}=1; path=/; max-age=31536000; samesite=lax`
      : `${US_OVERRIDE_COOKIE}=; path=/; max-age=0; samesite=lax`;
    startTransition(() => router.refresh());
  };

  return (
    <button type="button" onClick={flip} disabled={pending} aria-busy={pending}>
      {children}
    </button>
  );
}
