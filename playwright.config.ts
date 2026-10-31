import { defineConfig, devices } from "@playwright/test";
import { E2E_OWNER_EMAIL } from "./e2e/owner-email.mjs";

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
 * ANOTHER BROWSER ENGINE, ON REQUEST (2026-10-11).
 *
 * Every run was Chromium. Most players are on an iPhone, which is WebKit, and
 * the two differ in exactly the places this app has been hurt: locale data (a
 * date the server and the browser spell differently is a hydration error),
 * layout, and what a service worker does.
 *
 * `E2E_ENGINE=webkit` or `firefox` swaps the browser UNDER the same three
 * projects — same names, same widths — so every spec's own rule about which
 * project it runs on still holds and nothing has to be taught a fourth name.
 * Unset, nothing changes; CI installs Chromium only, so this is opt-in until
 * the workflow installs the others.
 *
 * WebKit here is Playwright's build of the engine, not Safari on a phone: it
 * is the closest a Windows machine gets, and it is not the last word.
 */
const ENGINE = process.env.E2E_ENGINE ?? "";

/**
 * A TABLET, AND THE BROWSERS PEOPLE ACTUALLY INSTALL (2026-10-13).
 *
 * Ajay's list for a round: "laptop, tablet, mobile, all kind of browsers, ios,
 * google play, us and international members/organizers". Three of those had
 * never been asked of this suite, and each is a switch here rather than a
 * fourth and fifth project, for the reason `E2E_ENGINE` gives: every spec
 * already says which of the three names it runs on.
 *
 * `E2E_DEVICES=tablet` puts a tablet under each name — held upright under
 * "phone" and "small-phone" (the player's app and the public boards), on its
 * side under "desktop" (the organizer's console). An iPad on WebKit, an
 * Android tablet on Chromium. It is the one device that is BOTH wide enough
 * for the console and worked by a finger, and both widths it has fall between
 * the phone and the laptop this suite measured — 640 to 834 upright, where a
 * layout written for 393 and for 1280 has never been looked at.
 *
 * `E2E_CHANNEL=chrome` or `msedge` runs the Chromium projects on the browser
 * installed on this machine — real Chrome, real Edge — rather than the build
 * Playwright ships. The same engine a version or two apart, so it is the
 * cheapest row in the table; it is here so the table has no empty row.
 *
 * `E2E_LOCALE=de-DE` gives every page a reader whose browser is set to another
 * language and region, the way `E2E_TZ` gives it another clock. The club's
 * own country decides how the app writes a date and an amount; a screen that
 * asks the BROWSER instead writes it one way on the server and another in
 * front of that reader, and nothing here could have seen it.
 */
const DEVICES = process.env.E2E_DEVICES ?? "";
const CHANNEL = process.env.E2E_CHANNEL ?? "";
const withChannel = <T extends object>(use: T): T => (CHANNEL && ENGINE === "" ? { ...use, channel: CHANNEL } : use);

function onTablet(name: "phone" | "small-phone" | "desktop") {
  if (DEVICES !== "tablet") return null;
  if (ENGINE === "webkit") {
    if (name === "desktop") return { ...devices["iPad Pro 11 landscape"] };
    if (name === "phone") return { ...devices["iPad (gen 7)"] };
    return { ...devices["iPad Mini"] };
  }
  if (ENGINE === "firefox") {
    // No mobile emulation in Firefox: the size and a touch screen.
    const viewport = name === "desktop" ? { width: 1138, height: 712 } : name === "phone" ? { width: 712, height: 1138 } : { width: 640, height: 1024 };
    return { browserName: "firefox" as const, viewport, hasTouch: true };
  }
  if (name === "desktop") return { ...devices["Galaxy Tab S4 landscape"] };
  if (name === "phone") return { ...devices["Galaxy Tab S4"] };
  return { ...devices["Galaxy Tab S9"] };
}

function onEngine(name: "phone" | "small-phone" | "desktop") {
  const tablet = onTablet(name);
  if (tablet) return tablet;
  if (ENGINE === "webkit") {
    if (name === "desktop") return { ...devices["Desktop Safari"], viewport: { width: 1280, height: 900 } };
    if (name === "phone") return { ...devices["iPhone 13"] };
    return { ...devices["iPhone SE"], viewport: { width: 320, height: 568 } };
  }
  if (ENGINE === "firefox") {
    if (name === "desktop") return { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 900 } };
    // Firefox has no mobile emulation; the width and a touch screen are what these specs measure.
    return {
      browserName: "firefox" as const,
      viewport: name === "phone" ? { width: 393, height: 851 } : { width: 320, height: 568 },
      hasTouch: true,
    };
  }
  return null;
}

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
  // The eleven scenario tournaments (e2e/scenarios) are a layer of a round, run a phase at a time
  // by scripts/qa/round.mjs. Each takes minutes and a field of 120; the standing suite leaves them out.
  // The text-box crawl (e2e/every-text-box.spec.ts) is a layer of its own, `text-boxes`, cut into
  // shares by `--shard`; the standing suite and every other layer leave it out, so no part of the
  // suite is made an hour longer by it. `E2E_TEXT_BOXES=1` is that layer's switch.
  testIgnore: process.env.E2E_SCENARIOS === "1" ? [] : ["**/scenarios/**"].concat(process.env.E2E_TEXT_BOXES === "1" ? [] : ["**/every-text-box.spec.ts"]),
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
    /*
     * `E2E_MOTION=full` leaves the motion ON (2026-10-13) — which is what nearly everybody is shown, and
     * what the suite had never once looked at. It was meant as an exception until the first round on
     * GitHub showed it is also what Safari's engine on Linux runs with whatever is asked here: that build
     * ignores this setting, so the front door was being measured mid-animation there. A spec about how a
     * page looks at rest has to WAIT for rest; it cannot assume the page never moves.
     */
    contextOptions: { reducedMotion: process.env.E2E_MOTION === "full" ? "no-preference" : "reduce" },
    /**
     * THE READER IS SOMEWHERE ELSE (2026-10-11). Every run here had the
     * browser in the SERVER'S time zone, because both are this machine — and
     * in CI both are UTC. In production the server is on UTC and no member is.
     * A client screen that words a moment while drawing writes one day on the
     * server and another in the reader's browser, for the hours either side of
     * a midnight: the fault `MessagesClient` documents having had.
     *
     * `E2E_TZ=Pacific/Auckland` puts every page a day ahead of the server for
     * most of the working day; `Pacific/Honolulu` a day behind in the evening.
     * `e2e/coverage.ts` gives the same zone to a context a spec makes itself.
     */
    ...(process.env.E2E_TZ ? { timezoneId: process.env.E2E_TZ } : {}),
    // And in another language and region — see E2E_LOCALE at the top of this file.
    ...(process.env.E2E_LOCALE ? { locale: process.env.E2E_LOCALE } : {}),
  },

  projects: [
    {
      name: "phone",
      // Pixel 5 is 393x851 with a coarse pointer — a real device profile
      // rather than a narrow desktop window, which is the distinction the
      // touch-target rules are gated on.
      use: onEngine("phone") ?? withChannel({ ...devices["Pixel 5"] }),
    },
    {
      name: "small-phone",
      // 320px — an iPhone SE, and still the width everything breaks at first.
      // The Pixel 5 profile above is 393px and comfortably wide enough to hide
      // an overflow that a 320px screen would show, so testing only the larger
      // one proves less than it appears to.
      use: onEngine("small-phone") ?? withChannel({
        ...devices["Pixel 5"],
        viewport: { width: 320, height: 568 },
      }),
    },
    {
      name: "desktop",
      use: onEngine("desktop") ?? withChannel({ ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } }),
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
    // A round (scripts/qa/round.mjs) starts the server itself, once, from one build, and says so:
    // on CI this would otherwise build a second bundle and collide with it on the port.
    reuseExistingServer: !process.env.CI || process.env.E2E_REUSE_SERVER === "1",
    timeout: 240_000,
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      NEXT_NO_STANDALONE: "1",
      AUTH_SECRET: process.env.AUTH_SECRET!,
      // WebKit does not send a Secure cookie to plain http://localhost (Chromium
      // does), so a server that marks them Secure signs nobody in there. See
      // `src/lib/secure-cookies.ts`. A server already running — the usual case
      // locally — has to have been started with the same variable.
      ...(ENGINE === "webkit" ? { E2E_PLAIN_HTTP: "1" } : {}),
      // BILLING SWITCHED ON, WITH A KEY THAT CAN CHARGE NOTHING. With no
      // `STRIPE_SECRET_KEY` the plan panel draws none of its buying controls,
      // so the discount box and the action behind it were never reached by a
      // browser (round G149, 2026-10-18). The plan panel is the only reader of
      // `billingEnabled()`; a press that went as far as Stripe would be refused
      // by Stripe and said as "Couldn't reach the payment page". Always this
      // key, never one from the environment: a test must not reach a real
      // Stripe account.
      STRIPE_SECRET_KEY: "sk_test_e2e_charges_nothing",
      // AN OWNER FOR THIS SERVER ONLY — an invented address, so the owner console
      // can be walked (`e2e/owner-console.spec.ts`); without one `/owner` is a 404
      // to everybody and its five actions were never pressed (2026-10-21).
      // Production's own list is set in Vercel and is not this.
      OWNER_EMAILS: E2E_OWNER_EMAIL,
      // NO MAIL LEAVES FROM A TEST SERVER: an empty key beats any in .env, so the sender answers "not configured"
      // (the owner-console spec presses Send on the early list and expects exactly that).
      RESEND_API_KEY: "",
    },
  },
});
