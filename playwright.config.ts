import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests, for the class of bug the unit suite cannot see.
 *
 * The 1387 vitest tests check domain logic and now render components to
 * static markup. Neither measures a laid-out page, and that is where this
 * project keeps losing: a scorecard 418px wide inside a 315px column with no
 * scroller, buttons below the platform touch minimum, a fixed bar sitting
 * under the notch, a card that opens blank over a round already played.
 * Every one of those shipped with a green suite and a clean build.
 *
 * So these run a real browser against a real server and a real database, at
 * the widths phones actually are.
 *
 * Two projects rather than one, because the most valuable assertions here are
 * about the DIFFERENCE between them: the console must stay dense on a desktop
 * pointer, and the app must have 44px targets on a touch one. A single
 * viewport cannot prove that.
 */

const PORT = Number(process.env.E2E_PORT ?? 3101);

/**
 * A signing key for the run, shared by the seeded cookies and the server.
 *
 * `next start` runs as NODE_ENV=production, and lib/auth.ts deliberately
 * REFUSES to sign with its development fallback there — a deploy missing its
 * key must fail loudly rather than run on a secret published in this repo.
 * That is correct, and it means an end-to-end run has to bring its own.
 *
 * Set here so global-setup (which mints the cookies) and the web server
 * (which verifies them) cannot disagree. Not a production secret and never
 * used as one: it exists for the length of one test run.
 */
process.env.AUTH_SECRET ??= "e2e-only-signing-key-not-for-deployment";

export default defineConfig({
  testDir: "./e2e",
  // A real database and one dev server: parallel workers would race on the
  // shared fixture. Correctness over speed for a suite this small.
  workers: 1,
  fullyParallel: false,
  // A failing e2e test in CI is a real failure, not something to retry until
  // it passes — flakiness here is a bug in the test, and retrying hides it.
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    /**
     * THE CAUSE OF THE `offline.spec:245` INTERMITTENT, found 2026-09-15 by
     * measuring rather than guessing.
     *
     * `globals.css` sets `html { scroll-behavior: smooth }`, overridden to
     * `auto` only inside `@media (prefers-reduced-motion: reduce)`. Playwright
     * does not emulate that preference by default, so every test ran with
     * ANIMATED scrolling.
     *
     * Playwright scrolls an element into view before clicking it and then
     * checks the box is stable across two consecutive animation frames. The
     * card chooser sits about 215px below the fold on a phone, so every click
     * on it scrolls — and the box was still moving when it was measured.
     * Sampled every frame after a `scrollIntoView`, at 320px:
     *
     *     t=0   y=783    t=93  y=669    t=143 y=369
     *     t=27  y=781    t=110 y=574    t=160 y=303
     *     t=60  y=755    t=127 y=460    t=176 y=253
     *
     * 114 pixels between two frames at t=110 and t=127. That is exactly
     * `element is not stable`, and while the animation is in flight the
     * element really is `outside of the viewport` — the two lines of that
     * signature, in the order every failing log has them.
     *
     * It explains the rest too: intermittent because it is a race between a
     * ~300ms animation and a stability check, sensitive to machine load; all
     * three viewports because the property is on the document; and only that
     * test, because it is the only click on something far enough below the
     * fold to need a real scroll.
     *
     * WHAT THIS TRADES. The suite no longer exercises animated scrolling, and
     * that is a genuine loss — but it is a loss of nondeterminism, not of
     * coverage anybody was getting deliberately. Nothing asserts an animation.
     * It is also a configuration real users have, so the app is still being
     * tested as somebody actually runs it.
     *
     * The app's own reduced-motion CSS does the work: `design-system.css` sets
     * `scroll-behavior: auto !important` under the same query. Nothing here
     * reaches into the product to make a test pass.
     *
     * Under `contextOptions` rather than at the top level: in Playwright 1.62
     * `reducedMotion` is a `BrowserContextOptions` property and is NOT one of
     * the `PlaywrightTestOptions` that sit directly on `use` — `colorScheme`
     * is, which makes the omission easy to miss. Written at the top level it
     * is a type error, and the failure arrives from `next build` type-checking
     * this file rather than from Playwright.
     */
    contextOptions: { reducedMotion: "reduce" },
  },

  projects: [
    {
      name: "phone",
      // Pixel 5 is 393x851 with a coarse pointer — a real device profile
      // rather than a narrow desktop window, which is the distinction the
      // touch-target rules are gated on.
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "small-phone",
      // 320px — an iPhone SE, and still the width everything breaks at first.
      // The Pixel 5 profile above is 393px and comfortably wide enough to hide
      // an overflow that a 320px screen would show, so testing only the larger
      // one proves less than it appears to.
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 320, height: 568 },
      },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
  ],

  webServer: {
    // The production build, not `next dev`: dev serves unminified CSS in a
    // different order and would not catch a cascade bug that only appears
    // once the chunker has run — which is exactly how the 44px touch rule
    // silently lost to design-system.css.
    //
    // `next start` is the closer match to what ships on the web: standalone
    // output exists for the ELECTRON shell, and Vercel uses neither. If the
    // desktop build ever needs covering, it wants its own project running
    // `node <distDir>/standalone/server.js` — not a change to this one.
    //
    // This used to build standalone anyway and treat the resulting "next start
    // does not work with output: standalone" warning as noise. It was not
    // noise: see next.config.mjs. `NEXT_NO_STANDALONE` below turns the
    // standalone output off for THIS build only, so the server here is one
    // Next actually supports.
    command: `npm run build && npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      NEXT_NO_STANDALONE: "1",
      AUTH_SECRET: process.env.AUTH_SECRET!,
    },
  },
});
