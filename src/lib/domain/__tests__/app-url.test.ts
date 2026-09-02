import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appUrlFrom, DEV_FALLBACK_URL } from "@/lib/domain/app-url";

/**
 * The address inside every email this app sends.
 *
 * `?? "http://localhost:3000"` is correct on a laptop and silently wrong on a
 * deploy. With the variable unset, a password-reset link and a staff invitation
 * both point at localhost — the provider accepts the message, reports success,
 * and the recipient gets a link that opens nothing. Nothing failed anywhere.
 *
 * That is not hypothetical: the variable was deleted and recreated on
 * 2026-09-01 to change its type, and a variable that gets recreated can be
 * absent for a window.
 */
describe("appUrlFrom", () => {
  describe("when it is configured", () => {
    it("uses the configured address", () => {
      const r = appUrlFrom({ NEXT_PUBLIC_APP_URL: "https://tourneyhq.club" });
      expect(r).toEqual({ base: "https://tourneyhq.club", brokenLinks: false });
    });

    it("strips a trailing slash", () => {
      /**
       * Every caller appends a path that starts with "/", and
       * `https://host//reset-password` is a different URL — one some routers
       * redirect and others simply do not recognise. A trailing slash is the
       * most likely thing for somebody to paste into a dashboard field.
       */
      expect(appUrlFrom({ NEXT_PUBLIC_APP_URL: "https://tourneyhq.club/" }).base).toBe(
        "https://tourneyhq.club",
      );
    });

    it("ignores surrounding whitespace", () => {
      expect(appUrlFrom({ NEXT_PUBLIC_APP_URL: "  https://tourneyhq.club  " }).base).toBe(
        "https://tourneyhq.club",
      );
    });

    it("is never broken when a real address is set, deployed or not", () => {
      const env = { NEXT_PUBLIC_APP_URL: "https://tourneyhq.club", VERCEL: "1" };
      expect(appUrlFrom(env).brokenLinks).toBe(false);
    });
  });

  describe("when it is missing", () => {
    it("falls back locally without complaining", () => {
      // A dev server has to work, and localhost is genuinely right there.
      const r = appUrlFrom({ NODE_ENV: "development" });
      expect(r).toEqual({ base: DEV_FALLBACK_URL, brokenLinks: false });
    });

    it("reports broken links on a Vercel deploy", () => {
      const r = appUrlFrom({ VERCEL: "1" });
      expect(r.base).toBe(DEV_FALLBACK_URL);
      expect(r.brokenLinks).toBe(true);
    });

    it("reports broken links on any production build", () => {
      // Covers a self-hosted or container deploy, where VERCEL is unset.
      expect(appUrlFrom({ NODE_ENV: "production" }).brokenLinks).toBe(true);
    });

    it("counts a PREVIEW deploy as broken too", () => {
      /**
       * Gating on production alone would leave every preview quietly broken and
       * looking fine. A reset requested from a preview build has to open that
       * preview, not the reviewer's laptop.
       */
      expect(appUrlFrom({ VERCEL: "1", NODE_ENV: "production" }).brokenLinks).toBe(true);
    });

    it("treats an EMPTY value as missing", () => {
      /**
       * The shape a half-finished dashboard edit leaves behind. Treating it as
       * configured would build links like "/reset-password" with no origin at
       * all — worse than localhost, because it looks like a relative path and
       * some clients will happily resolve it against their own host.
       */
      expect(appUrlFrom({ NEXT_PUBLIC_APP_URL: "", VERCEL: "1" }).brokenLinks).toBe(true);
      expect(appUrlFrom({ NEXT_PUBLIC_APP_URL: "   ", VERCEL: "1" }).brokenLinks).toBe(true);
    });
  });

  it("always returns a usable base, whatever the environment", () => {
    // Callers interpolate this straight into a URL. Returning empty would
    // produce a malformed link rather than an obviously wrong one.
    for (const env of [{}, { VERCEL: "1" }, { NODE_ENV: "production" }, { NEXT_PUBLIC_APP_URL: "" }]) {
      expect(appUrlFrom(env).base).toMatch(/^https?:\/\/.+/);
    }
  });
});

describe("the organizer is told when links are broken", () => {
  const email = readFileSync(join(process.cwd(), "src", "lib", "email.ts"), "utf8");
  const auth = readFileSync(join(process.cwd(), "src", "app", "actions", "auth.ts"), "utf8");

  it("surfaces it on the screen that already reports mail problems", () => {
    /**
     * The send succeeds and the provider reports no error, so this is invisible
     * from every other direction — exactly like the two problems emailConfig
     * already reports, and the reason it belongs beside them.
     */
    expect(email).toMatch(/if \(appUrl\(\)\.brokenLinks\)/);
    expect(email).toContain("points at localhost");
  });

  it("leaves no raw fallback anywhere else", () => {
    // One rule, one reader. A second copy of `?? "http://localhost:3000"` would
    // be a link nobody checks.
    expect(email).not.toContain('?? "http://localhost:3000"');
    expect(auth).not.toContain('?? "http://localhost:3000"');
  });

  it("builds both outbound links from the same resolver", () => {
    // The reset link and the staff invitation are the two emails carrying a
    // URL; both must agree about what this site is called.
    expect(auth).toMatch(/const base = appUrl\(\)\.base;/);
    expect(email).toMatch(/const base = appUrl\(\)\.base;/);
  });
});
