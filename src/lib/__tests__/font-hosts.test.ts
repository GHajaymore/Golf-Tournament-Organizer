import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * No stylesheet in this app fetches a font from somebody else's server.
 *
 * `layout.tsx` has said so in a comment since Geist was adopted — "next/font
 * emits the files from node_modules at build time and serves them same-origin,
 * so there is no CDN to block and no flash of fallback text". It was not true.
 * `globals.css` imported Fraunces from Google's CDN a second time, under the
 * same family name next/font was already serving it under, so production
 * fetched the face twice: once from `_next/static/media`, and once as 67KB
 * from fonts.gstatic.com behind a render-blocking stylesheet on two origins
 * the page otherwise never touched. `design-system.css` imported Inter on top
 * of that, for a face nothing renders.
 *
 * Swept off the filesystem rather than listed, so a stylesheet added later is
 * covered the day it is added — the same reason `e2e/layout.spec.ts` derives
 * its routes. A hand list covers the files somebody thought about.
 *
 * READ THROUGH `readSource`, which strips comments, for both reasons at once:
 * the explanations above these deletions name `fonts.gstatic.com` out loud and
 * would otherwise trip the assertion, and — the direction that actually
 * matters — a stripper that mangled a CSS `url()` would let a real import
 * through unseen. Mutation-checked below rather than assumed.
 *
 * WHAT THIS DOES NOT COVER, said plainly so the green is not read as more than
 * it is: `layout.tsx` still links two Phosphor icon stylesheets from unpkg.com
 * in the document head, and they pull a 148KB icon font from that origin. That
 * is the largest asset on the page. It is an HTML `<link>`, not a CSS import,
 * and it is a separate decision from this one.
 */

/** Every stylesheet under src, found rather than named. */
function stylesheets(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) stylesheets(full, found);
    else if (entry.name.endsWith(".css")) found.push(full);
  }
  return found;
}

const SHEETS = stylesheets(join(process.cwd(), "src")).map((f) =>
  f.slice(process.cwd().length + 1).split("\\").join("/"),
);

describe("no stylesheet pulls a font from another origin", () => {
  it("finds the stylesheets at all", () => {
    // A sweep that silently matched nothing would pass every assertion below.
    expect(SHEETS.length).toBeGreaterThan(0);
    expect(SHEETS).toContain("src/app/globals.css");
    expect(SHEETS).toContain("src/app/design-system.css");
  });

  it.each(["fonts.googleapis.com", "fonts.gstatic.com"])("never references %s", (host) => {
    const offenders = SHEETS.filter((f) => readSource(f).includes(host));
    expect(offenders, `${host} referenced in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("imports nothing over http at all", () => {
    /**
     * Banned by SHAPE rather than by host. A rule naming the two Google
     * domains is satisfied by moving to a third CDN, which is the same defect
     * with a different DNS name — an extra origin in the critical path and a
     * font this app does not control the delivery of.
     */
    const offenders = SHEETS.filter((f) => /@import\s+url\(\s*['"]?https?:/i.test(readSource(f)));
    expect(offenders, `remote @import in: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("the heading face has one source", () => {
  it("points --font-heading at the self-hosted family, not a bare name", () => {
    /**
     * The duplicate survived as long as it did because `--font-heading:
     * "Fraunces", …` looks self-sufficient — the family name resolved, so
     * nothing was visibly wrong, and the second download was invisible without
     * opening the network panel. Naming the variable instead means the token
     * cannot resolve to a copy nobody declared.
     */
    const css = readSource("src/app/globals.css");
    expect(css).toMatch(/--font-heading:\s*var\(--font-display/);
  });

  it("serves every weight the headings ask for", () => {
    /**
     * The trap in removing the CDN copy. It supplied 500, 600 and 700; the
     * self-hosted one supplied 600 and 700, and `--font-heading-weight` plus a
     * long tail of call sites set 500. Dropping the import without adding 500
     * substitutes 600 and quietly thickens every heading in the app — a
     * regression that looks like nothing in a diff and like a redesign on a
     * screen.
     */
    const layout = readSource("src/app/layout.tsx");
    const weights = layout.match(/weight:\s*\[([^\]]*)\]/);
    expect(weights, "no weight array found in layout.tsx").toBeTruthy();
    for (const w of ["500", "600", "700"]) {
      expect(weights![1], `Fraunces no longer ships weight ${w}`).toContain(w);
    }
  });
});
