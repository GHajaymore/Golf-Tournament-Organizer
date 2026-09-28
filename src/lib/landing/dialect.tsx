import { cloneElement, isValidElement, type ReactNode } from "react";
import { applySwaps, type WordSwap } from "./edition";

/** The attributes a reader hears or sees as words, swapped along with the text. */
const TEXT_PROPS = ["alt", "aria-label", "placeholder", "title"] as const;

/**
 * The page's words, in the visitor's edition — swapped on the SERVER, before
 * anything is sent.
 *
 * The page is authored once, in US English, as ordinary JSX. This walks the
 * element tree it builds and rewrites every string child and every spoken
 * attribute through the edition's swaps, so a British visitor's page arrives
 * saying "buggy" rather than flashing "cart" while a script catches up.
 *
 * It reads the tree as WRITTEN, not as rendered: a component's own output is
 * its own business (LandingAuth keeps its words), and only what page.tsx
 * passes as children is swapped. Anything marked `data-no-dialect` is left
 * exactly as it is — that is how a FORMAT name ("Foursomes", alternate shot in
 * Britain) is kept from ever being read as the group of four.
 */
export function inDialect(node: ReactNode, swaps: readonly WordSwap[]): ReactNode {
  if (swaps.length === 0) return node;
  if (typeof node === "string") return applySwaps(node, swaps);
  if (Array.isArray(node)) return node.map((child) => inDialect(child, swaps));
  if (!isValidElement(node)) return node;
  if (node.type === "style" || node.type === "script") return node;

  const props = node.props as Record<string, unknown>;
  if (props["data-no-dialect"] !== undefined) return node;

  const next: Record<string, unknown> = {};
  for (const name of TEXT_PROPS) {
    const value = props[name];
    if (typeof value === "string") next[name] = applySwaps(value, swaps);
  }
  const children = props.children;
  // Several children written side by side go back as separate arguments, the
  // way JSX passes them. Handed back as one array they would read to React as a
  // LIST, and every static child would be warned about for having no key.
  if (Array.isArray(children)) {
    return cloneElement(node, next, ...children.map((child) => inDialect(child as ReactNode, swaps)));
  }
  if (children !== undefined) next.children = inDialect(children as ReactNode, swaps);
  return cloneElement(node, next);
}
