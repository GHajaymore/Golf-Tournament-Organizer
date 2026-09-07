"use client";
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { reorderShifts } from "@/lib/reorder";

/**
 * An ordered list whose rows slide when they change places.
 *
 * FLIP: measure where each row was, let React redraw it wherever it now
 * belongs, then start it back at the old offset and animate to zero. Nothing
 * is ever positioned by hand — the layout is React's, and this only plays the
 * difference.
 *
 * WHERE IT ACTUALLY BITES is the public spectator board, and only there,
 * because that is the one page in the app that updates itself: `LiveRefresh`
 * polls and calls `router.refresh()`, which re-renders the server components
 * in place without remounting this one. The console leaderboard has no poll,
 * so its rows only reorder across a full navigation — where the component
 * remounts, there is no previous board in memory, and this correctly does
 * nothing. Wiring it in there would animate a page load, which is the failure
 * this is meant to avoid.
 *
 * `offsetTop`, not `getBoundingClientRect().top`: the second is relative to
 * the viewport, so a spectator who scrolls between two polls would see every
 * row on the board leap by the distance they scrolled.
 *
 * The Web Animations API rather than a CSS class, because the rows carry
 * React-owned inline styles — writing `transform` onto them and taking it off
 * again races the next render. `animate()` composites outside that entirely
 * and cleans up after itself.
 */
/**
 * `useLayoutEffect` in the browser, `useEffect` on the server.
 *
 * A layout effect is what keeps a row from painting once at its new position
 * before sliding — but React warns about it during server rendering, and this
 * component IS server-rendered before it hydrates. The alias is the standard
 * way out and is deliberately named so nobody "simplifies" it back.
 *
 * Declared above the component rather than below it because a `const` is not
 * hoisted the way a function declaration is, and lint is right to say so.
 */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function FlipList({
  children,
  style,
  className,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  "aria-label"?: string;
}) {
  const ref = useRef<HTMLOListElement>(null);
  const previous = useRef<Map<string, number>>(new Map());

  useIsomorphicLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    const rows = [...root.querySelectorAll<HTMLElement>("[data-flip-key]")];
    const after = new Map<string, number>();
    for (const row of rows) after.set(row.dataset.flipKey!, row.offsetTop);

    const reduceMotion =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    for (const { key, dy } of reorderShifts(previous.current, after, { reduceMotion })) {
      const row = rows.find((r) => r.dataset.flipKey === key);
      row?.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
        // Long enough to be followed by eye, short enough that a board with
        // several changes has settled before anybody reads a number off it.
        { duration: 420, easing: "cubic-bezier(.2,.7,.2,1)" },
      );
    }

    previous.current = after;
  });

  return (
    <ol ref={ref} style={style} className={className} aria-label={ariaLabel}>
      {children}
    </ol>
  );
}

