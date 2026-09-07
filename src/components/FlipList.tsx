"use client";
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { reorderShifts } from "@/lib/reorder";

/**
 * `useLayoutEffect` in the browser, `useEffect` on the server.
 *
 * A layout effect is what keeps a row from painting once at its new position
 * before sliding — but React warns about it during server rendering, and these
 * components ARE server-rendered before they hydrate. The alias is the standard
 * way out and is deliberately named so nobody "simplifies" it back.
 *
 * Declared above its users rather than below because a `const` is not hoisted
 * the way a function declaration is, and lint is right to say so.
 */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Slide the rows inside `root` when they change places.
 *
 * FLIP: measure where each row was, let React redraw it wherever it now
 * belongs, then start it back at the old offset and animate to zero. Nothing is
 * ever positioned by hand — the layout is React's, and this only plays the
 * difference.
 *
 * `offsetTop`, not `getBoundingClientRect().top`: the second is relative to the
 * viewport, so someone who scrolls between two polls would see every row on the
 * board leap by the distance they scrolled.
 *
 * The Web Animations API rather than a CSS class, because the rows carry
 * React-owned inline styles — writing `transform` onto them and taking it off
 * again races the next render. `animate()` composites outside that entirely and
 * cleans up after itself.
 *
 * Inert unless the list updates IN PLACE. On a full navigation the component
 * remounts, `previous` is empty, and `reorderShifts` correctly returns nothing.
 */
function useRowReorder(root: RefObject<HTMLElement | null>) {
  const previous = useRef<Map<string, number>>(new Map());

  useIsomorphicLayoutEffect(() => {
    const el = root.current;
    if (!el) return;

    const rows = [...el.querySelectorAll<HTMLElement>("[data-flip-key]")];
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
}

/**
 * An ordered list whose rows slide when they change places — the player and
 * spectator board.
 */
export function FlipList({
  children,
  style,
  className,
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  const ref = useRef<HTMLOListElement>(null);
  useRowReorder(ref);
  return (
    <ol ref={ref} style={style} className={className}>
      {children}
    </ol>
  );
}

/**
 * The same, for a table — the organizer's console board.
 *
 * A separate component rather than a prop, because `<tbody>` cannot be produced
 * by a generic wrapper without breaking table semantics: anything between
 * `<table>` and `<tbody>` is hoisted out by the HTML parser, and a `<div>` in
 * that position silently destroys the layout.
 *
 * Transforming a `<tr>` is well-supported and is what makes this possible at
 * all; a decade ago it was not, which is why FLIP examples are usually lists.
 */
export function FlipTableBody({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLTableSectionElement>(null);
  useRowReorder(ref);
  return <tbody ref={ref}>{children}</tbody>;
}
