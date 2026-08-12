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
    // `next start` warns because next.config sets output:"standalone". That
    // output exists for the ELECTRON shell, which needs a self-contained
    // server bundle; the web app deploys to Vercel, which uses neither. So
    // `next start` is the closer match to what actually ships on the web, and
    // the warning is noise here rather than a defect to chase. If the desktop
    // build ever needs covering, it wants its own project running
    // `node <distDir>/standalone/server.js` — not a change to this one.
    command: `npm run build && npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { NEXT_DIST_DIR: ".next-e2e", AUTH_SECRET: process.env.AUTH_SECRET! },
  },
});
