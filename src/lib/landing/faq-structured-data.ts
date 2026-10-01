import { isValidElement, type ReactNode } from "react";
import { applySwaps, type WordSwap } from "./edition";
import type { FaqContext, FaqGroup } from "./faq";

/**
 * /faq IN SCHEMA.ORG TERMS (Ajay, 2026-09-30: "fix it", after a production
 * audit found the page carried no structured data at all).
 *
 * A FAQPage lets a search engine show the questions and answers themselves.
 * It must say exactly what the page says, or the result shown in search
 * disagrees with the answer a visitor opens. So it is built from the same
 * `FAQ` list the page renders, with the same prices (`ctx`) and the same
 * edition's words (`swaps`), which the page applies with `inDialect` and which
 * a <script> is deliberately left out of.
 */

/** Elements whose text starts a new line of the answer, not a run-on word. */
const BLOCKS = new Set(["p", "li", "ul", "ol", "div", "br", "h3", "h4", "table", "tr"]);

/** The words in a written JSX tree, as a reader would read them. */
export function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  // Two elements side by side are two things (a row of format chips), so a
  // space goes between them; an element inside a sentence keeps its place.
  if (Array.isArray(node)) {
    return node.map((n, i) => (i > 0 && isValidElement(n) && isValidElement(node[i - 1]) ? " " : "") + nodeText(n)).join("");
  }
  if (!isValidElement(node)) return "";
  const props = node.props as { children?: ReactNode };
  const inner = nodeText(props.children);
  return typeof node.type === "string" && BLOCKS.has(node.type) ? ` ${inner} ` : inner;
}

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

export function faqStructuredData(groups: readonly FaqGroup[], ctx: FaqContext, swaps: readonly WordSwap[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: groups.flatMap((g) =>
      g.items.map((item) => ({
        "@type": "Question",
        name: applySwaps(tidy(item.q), swaps),
        acceptedAnswer: { "@type": "Answer", text: applySwaps(tidy(nodeText(item.a(ctx))), swaps) },
      })),
    ),
  };
}

/** JSON for a <script> body: a "<" in an answer can never close the tag. */
export function scriptJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
