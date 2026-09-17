import type { Page } from "@playwright/test";

/**
 * Everything on the page whose right edge is past the viewport's.
 *
 * Lifted out of `layout.spec.ts` when a second spec needed it. One copy on
 * purpose: the interesting part is the EXEMPTION below, and two copies of a
 * rule with an exemption in it is two rules the first time somebody edits one.
 */
export async function overflowing(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: { cls: string; right: number; text: string }[] = [];
    document.querySelectorAll("body *").forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return;
      const r = el.getBoundingClientRect();
      if (!r.width || r.right <= vw + 1) return;
      // Inside something that scrolls horizontally is fine — that is a table
      // in its wrapper doing exactly what it should.
      let n = el.parentElement;
      let scrollable = false;
      while (n && n !== document.body) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === "auto" || ox === "scroll") { scrollable = true; break; }
        n = n.parentElement;
      }
      if (!scrollable) {
        out.push({
          cls: String((el as HTMLElement).className ?? "").slice(0, 40),
          right: Math.round(r.right),
          text: (el.textContent ?? "").trim().slice(0, 40),
        });
      }
    });
    return out;
  });
}
