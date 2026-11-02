import { describe, it, expect, afterEach } from "vitest";
import robots from "@/app/robots";
import { readSource } from "./source";

/**
 * SEARCH ENGINES ARE KEPT OFF THE DEMO CLUB (2026-10-24; docs/claude/demo-club.md).
 *
 * The demo's pages are `/demo`, `/demo/<door>` and the demo club's `/live/<token>` pages. Each is
 * kept out twice over: robots.txt disallows the prefix in production, and every page says noindex
 * itself — the `/live/` pages already did for every club, and the browser walk
 * (`e2e/demo-club.spec.ts`) reads the robots meta off each demo page as a visitor opens it.
 */

const was = process.env.VERCEL_ENV;
afterEach(() => {
  if (was === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = was;
});

function disallowed(): string[] {
  const rules = robots().rules;
  const list = Array.isArray(rules) ? rules : [rules];
  return list.flatMap((r) => (Array.isArray(r.disallow) ? r.disallow : r.disallow ? [r.disallow] : []));
}

describe("the demo club is not indexed", () => {
  it("robots.txt keeps crawlers off /demo and the boards in production", () => {
    process.env.VERCEL_ENV = "production";
    const off = disallowed();
    expect(off).toContain("/demo");
    expect(off).toContain("/live/");
    // CONTROL: the front door is not disallowed — the list is not "everything".
    expect(off).not.toContain("/");
  });

  it("every demo page says noindex itself", () => {
    expect(readSource("src/app/demo/page.tsx")).toMatch(/robots:\s*NOINDEX/);
    expect(readSource("src/app/demo/[door]/route.ts")).toMatch(/"X-Robots-Tag":\s*"noindex, nofollow"/);
    for (const page of ["src/app/live/[token]/page.tsx", "src/app/live/[token]/event/page.tsx", "src/app/live/[token]/report/page.tsx"]) {
      const src = readSource(page);
      // Every return of its metadata says noindex, whatever the board's state.
      const returns = src.split("\n").filter((line) => line.includes("return { title:"));
      expect(returns.length, `${page}: CONTROL — no metadata returns found`).toBeGreaterThan(0);
      for (const r of returns) expect(r, page).toContain("robots: NOINDEX");
    }
  });
});
