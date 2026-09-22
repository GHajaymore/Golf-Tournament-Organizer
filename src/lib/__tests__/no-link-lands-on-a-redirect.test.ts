import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readSource } from "./source";

/**
 * NOTHING IN THE APP LINKS AT A ROUTE THAT ONLY REDIRECTS.
 *
 * Ajay, 2026-09-22: "when I click on the print scorecards on the reports menu,
 * it takes me to teesheet and not the actual scorecards to print for players
 * to use on the course" — then, about the class: "please check all these kind
 * of issues in your screen walks."
 *
 * THE MECHANISM, which is what makes this checkable rather than a matter of
 * taste. Reports offered "Scorecards — open printable scorecards for the
 * field" and pushed `/scorecard`. That route had become a bare
 * `redirect("/foursomes")` when card printing was folded into the tee sheet —
 * correctly, because two print buttons producing different groupings is how
 * somebody prints the wrong thing on a Sunday morning. But the label stayed
 * where it was, so the click promised cards and delivered a pairing editor
 * with the print button below the fold.
 *
 * A LABEL GOES STALE SILENTLY. The route still answers, the page still
 * renders, every test still passes — the only thing that broke is the promise,
 * and nothing reads promises. What CAN be read is the shape underneath it: a
 * link whose destination is a route that exists only to send you somewhere
 * else is a link whose text describes a screen the user will not arrive at.
 *
 * So the rule is the shape, not the wording: point links at where the thing
 * IS. The three redirect routes here are kept deliberately for old bookmarks
 * and outside links, which is why they are not simply deleted — but nothing
 * inside the app may aim at one.
 */

const SRC = path.join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Routes whose page is nothing but a redirect.
 *
 * Detected rather than listed, so a route that becomes one later is covered
 * the day it does. The test is that the file calls `redirect(` and contains no
 * JSX — a page with a real screen in it always returns markup, and one that
 * redirects conditionally (an auth guard) has a screen to fall through to.
 */
function redirectOnlyRoutes(): Array<{ route: string; to: string }> {
  const out: Array<{ route: string; to: string }> = [];
  const appDir = path.join(SRC, "app");
  for (const file of walk(appDir)) {
    if (path.basename(file) !== "page.tsx") continue;
    /**
     * Read through `readSource` here too, which does the stripping this file
     * must not do for itself — and does it better: a page whose only JSX is
     * inside a commented-out block would otherwise read as a real screen and
     * be skipped.
     */
    const src = readSource(...path.relative(process.cwd(), file).split(path.sep));
    if (!src.includes("redirect(")) continue;
    // A real screen returns JSX. A bare redirect page has none.
    if (/return\s*\(/.test(src) || /<[A-Za-z]/.test(src)) continue;
    const to = (src.match(/redirect\("([^"]+)"\)/) || [])[1] ?? "?";
    const route = path
      .relative(appDir, path.dirname(file))
      .replace(/\\/g, "/")
      .replace(/\([^/]*\)\/?/g, "")
      .replace(/^/, "/")
      .replace(/\/$/, "");
    out.push({ route: route || "/", to });
  }
  return out;
}

describe("no link lands on a route that only redirects", () => {
  const redirects = redirectOnlyRoutes();

  /**
   * THE CONTROL. If the detector finds nothing the rule below is vacuous and
   * would stay green through any amount of the fault it is meant to catch.
   * `/scorecard`, `/scoring` and `/qualification` are all bare redirects kept
   * for old bookmarks, so finding none means the detector broke.
   */
  it("finds the redirect-only routes it is meant to police", () => {
    const routes = redirects.map((r) => r.route);
    expect(routes.length, "the detector found no redirect-only routes at all").toBeGreaterThanOrEqual(3);
    for (const known of ["/scorecard", "/scoring", "/qualification"]) {
      expect(routes, `${known} should be detected as a redirect-only route`).toContain(known);
    }
  });

  it("is not linked to from anywhere in the app", () => {
    const offenders: string[] = [];
    const files = walk(SRC).filter((f) => !f.includes("__tests__"));

    for (const { route, to } of redirects) {
      for (const file of files) {
        // The route's own page is allowed to name itself; so is the file that
        // redirects TO it, which cannot happen here but costs nothing to skip.
        if (file.includes(path.join("app", ...route.split("/").filter(Boolean)))) continue;
        /**
         * `readSource`, not a stripper of this file's own — `source-guard`
         * bans those and caught this one on its first full run. The naive pair
         * also eats the back half of every URL in a file, so a component whose
         * only mention of a redirect route sat after a link would have been
         * excused rather than checked.
         */
        const src = readSource(...path.relative(process.cwd(), file).split(path.sep));
        // `"/scorecard"` as a whole string — not `/scorecards`, and comments
        // are already gone, so prose naming the old route cannot trip it.
        const linked = new RegExp(`["'\`]${route}(?:[?#][^"'\`]*)?["'\`]`).test(src);
        if (linked) {
          offenders.push(`${path.relative(SRC, file).replace(/\\/g, "/")} links to ${route}, which only redirects to ${to}`);
        }
      }
    }

    expect(
      offenders,
      `point these at where the thing actually is — a label beside a redirect describes a screen the user never reaches:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
