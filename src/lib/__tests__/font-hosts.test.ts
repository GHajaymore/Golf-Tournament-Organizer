import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource, readVerbatim } from "./source";

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
 * The gap this file used to declare is now closed. It said, in this comment:
 * "layout.tsx still links two Phosphor icon stylesheets from unpkg.com, and
 * they pull a 148KB icon font from that origin." Those `<link>` tags are gone
 * — the package is a dependency and the CSS is imported, so Next emits both
 * fonts under `_next/static/media` and no third-party origin is left in the
 * critical path. The `<link>` ban below is what keeps them gone.
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

describe("nothing in the document head loads from another origin", () => {
  /**
   * The stylesheets, not just the fonts. Two `<link rel="stylesheet">` tags
   * pointed at unpkg.com for the Phosphor icon set: render-blocking, on an
   * origin the page otherwise never touched, each one a DNS lookup and a TLS
   * handshake before a single icon could be measured — and then a 147KB font
   * from that same third party, the largest asset on the page. A CDN outage or
   * a proxy blocking unpkg took every icon in the product with it.
   *
   * Banned by SHAPE — any absolute `href` on a `<link>` — rather than by host,
   * for the same reason the CSS rule above is: naming unpkg is satisfied by
   * moving to jsdelivr, which is the identical defect somewhere else.
   */
  it("has no external <link> in the root layout", () => {
    const layout = readSource("src/app/layout.tsx");
    const offenders = [...layout.matchAll(/<link[^>]*href=["'](https?:)?\/\/[^"']+["']/g)].map(
      (m) => m[0],
    );
    expect(offenders, `external <link> in layout.tsx: ${offenders.join(", ")}`).toEqual([]);
  });

  /**
   * THE OTHER HALF, which used to be "and it still imports the icon font".
   *
   * Removing a `<link>` without importing the package would pass the assertion
   * above and ship an app with no icons at all, so something had to check that
   * icons still came from somewhere. That somewhere is no longer a font: the
   * webfont was 272.6 KB of woff2 for about 120 glyphs out of roughly 1,500,
   * and `font-display: block`, so every icon was invisible until it arrived.
   *
   * The sprite carries only what the app uses and is already in the document.
   * So the rule is the same rule — icons must come from somewhere, and that
   * somewhere must not be a third party — and only its subject has changed.
   */
  it("mounts the icon sprite in the root layout", () => {
    const layout = readSource("src/app/layout.tsx");
    expect(layout, "nothing renders IconSprite; every <use href> would dangle").toMatch(
      /<IconSprite\s*\/>/,
    );
    expect(layout).toMatch(/from "@\/components\/IconSprite"/);
  });

  it("no longer ships the icon webfont it replaced", () => {
    const layout = readSource("src/app/layout.tsx");
    expect(layout, "the icon webfont is back alongside the sprite — that is both").not.toMatch(
      /@phosphor-icons\/web/,
    );
    const pkg = JSON.parse(readVerbatim("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(
      pkg.dependencies?.["@phosphor-icons/web"],
      "@phosphor-icons/web is a runtime dependency again",
    ).toBeUndefined();
    // The SVG source the sprite is generated FROM is a build-time dependency,
    // and belongs in devDependencies — nothing in it is shipped.
    expect(
      pkg.devDependencies?.["@phosphor-icons/core"],
      "the sprite generator's source is not a declared devDependency",
    ).toBeTruthy();
  });
});

describe("every font token names a face the app actually serves", () => {
  /**
   * `--font-body` said `"Inter", system-ui, sans-serif` and rendered no Inter.
   * Nothing was broken enough to notice: the stack simply fell through to
   * system-ui, so the app looked slightly different on every machine and
   * looked fine on all of them. Meanwhile GeistSans and GeistMono were fetched
   * on every page — ~141KB together — and rendered essentially nothing.
   *
   * A font stack whose FIRST family is never served is the failure mode here,
   * because the fallback hides it completely. So the rule is: the families
   * these tokens name must be ones this app loads — a next/font variable, or a
   * generic/system keyword as a fallback. A bare quoted family name is the
   * shape that went wrong.
   */
  const TOKENS = ["--font-body", "--font-mono", "--font-heading"];
  const DS = readSource("src/app/design-system.css");

  it.each(TOKENS)("%s leads with a served face, not a bare family name", (token) => {
    const m = DS.match(new RegExp(`${token}\\s*:\\s*([^;]+);`));
    expect(m, `${token} is not declared in design-system.css`).toBeTruthy();
    const first = m![1].split(",")[0].trim();
    expect(
      first,
      `${token} leads with ${first}, a family nothing in this app loads`,
    ).toMatch(/^var\(--font-/);
  });

  it("declares --font-mono at all", () => {
    /**
     * It was ABSENT, not wrong. Eight components ask for
     * `var(--font-mono, monospace)`, and an undeclared custom property makes
     * the fallback the thing that renders — silently, forever, while GeistMono
     * was downloaded on every page. An assertion that only checked the VALUE
     * would have passed on the empty string.
     */
    expect(DS, "--font-mono is undeclared; the fallback is what renders").toMatch(/--font-mono\s*:/);
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
