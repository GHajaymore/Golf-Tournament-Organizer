"use client";
import { useEffect } from "react";

/**
 * A FIGURE'S "WHY" CLOSES THE WAY A POPOVER DOES (2026-10-24): a tap anywhere
 * outside it, Escape, or opening another. `FigureWhy` is the platform's
 * `<details>`, which only closes on its own summary — so a sentence opened over
 * the controls beneath the card's running strip stayed over them until the
 * figure was found and tapped again. Measured, not guessed: the first browser
 * run of `every-figure-explains-itself.spec.ts` could not press "Full card"
 * under an open Net.
 *
 * One listener for the whole page, in the root layout, and nothing else: the
 * sentence still opens with no script at all, and a page that never draws a
 * figure pays a function call per tap.
 */
export function FigureWhyCloser() {
  useEffect(() => {
    const close = (keep: Node | null) => {
      document.querySelectorAll<HTMLDetailsElement>("details.why[open]").forEach((d) => {
        if (!keep || !d.contains(keep)) d.open = false;
      });
    };
    const onDown = (e: PointerEvent) => close(e.target as Node | null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(null);
    };
    /**
     * AND IT OPENS WHERE IT CAN BE READ. Under a row at the foot of a phone's
     * screen the sentence opened below the fold — measured on the public board
     * at 393 and 320 wide, the DQ and the shared place both — so a tap seemed
     * to do nothing. `nearest` moves the page only as far as the sentence needs.
     * `toggle` does not bubble, so it is caught on the way down.
     */
    const onToggle = (e: Event) => {
      const d = e.target;
      if (!(d instanceof HTMLDetailsElement) || !d.classList.contains("why") || !d.open) return;
      d.querySelector(".why-says")?.scrollIntoView({ block: "nearest" });
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("toggle", onToggle, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("toggle", onToggle, true);
    };
  }, []);
  return null;
}
