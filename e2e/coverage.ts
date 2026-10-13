import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { explainHydration, keepWhatTheServerSent } from "./page-errors";

/**
 * WHAT THE BROWSER TESTS ACTUALLY TOUCH, WRITTEN DOWN AS THEY RUN.
 *
 * On 2026-10-10 eleven scripted tournaments passed three times running and
 * were reported as "three clean rounds". An hour later a different kind of
 * look found about forty candidate defects in options and inputs those scripts
 * never used. Ajay's answer: "When you test, you test across the board —
 * that's the e2e." A pass count says how the paths walked behaved, and nothing
 * about the paths nobody walked — and nothing was measuring those.
 *
 * So every spec imports `test` from here instead of from Playwright, and every
 * browser context it opens — the default one and any made by hand — records:
 *
 *   A <id>          a server action was called (the `next-action` header;
 *                   the build's manifest names it)
 *   P <role> <path> a screen was opened, and as whom
 *
 * `scripts/e2e-coverage.mjs` reads the ledger against the app's own lists —
 * every action the build exports, every screen it routes — and prints what was
 * exercised and, by name, what never was. A run is not "a round" unless that
 * report says so.
 *
 * It records REACH, not correctness: an action that was called is not thereby
 * right. It exists to stop "clean" being said about code no test went near.
 */
const DIR = join(process.cwd(), ".e2e", "coverage");
const FILE = join(DIR, `${process.pid}.txt`);
let ready = false;

function note(line: string) {
  if (!ready) {
    mkdirSync(DIR, { recursive: true });
    ready = true;
  }
  appendFileSync(FILE, line + "\n");
}

const watched = new WeakSet<BrowserContext>();

/** Who a context is signed in as, read off its own cookies — never assumed. */
async function who(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies().catch(() => []);
  if (cookies.some((c) => c.name === "ng_session")) return "signed-in";
  if (cookies.some((c) => c.name === "ng_play")) return "round-code";
  return "anonymous";
}

/**
 * A SPEC ASKS FOR AN ADDRESS WHILE THE SCREEN IS STILL REDRAWING ITSELF.
 *
 * A screen that has just saved something refreshes itself, and a spec's next
 * line is very often `goto` — to read the result on another screen, or the
 * same one afresh. Chromium waits its turn. Safari's engine (and Firefox, as
 * `NS_BINDING_ABORTED`) reports the second navigation as "interrupted by
 * another navigation" and fails the test on a line that does nothing wrong.
 * A person cannot do this: they tap after the screen has settled.
 *
 * It was fixed spec by spec twice (`named-side-bet`, `play-with`) and then
 * failed a counted round from a third (`round-day`, on an iPhone's engine,
 * 2026-10-13). So it is answered here, where every page of every context
 * passes: the redraw is let finish and the address is asked for again. Any
 * other failure to navigate is the test's to hear, at once.
 */
function waitsItsTurn(page: Page): void {
  const goto = page.goto.bind(page);
  page.goto = async (...args: Parameters<Page["goto"]>) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await goto(...args);
      } catch (e) {
        if (attempt >= 2 || !/interrupted by another navigation|NS_BINDING_ABORTED/.test(String(e))) throw e;
        await page.waitForLoadState("networkidle").catch(() => {});
      }
    }
  };
}

export function recordCoverage(context: BrowserContext): void {
  if (watched.has(context)) return;
  watched.add(context);
  // Every page of every context explains a hydration mismatch if one lands on
  // it — see `explainHydration`. Here, because this is the one place every
  // spec's every context passes through.
  for (const page of context.pages()) {
    explainHydration(page);
    waitsItsTurn(page);
  }
  context.on("page", (page) => {
    explainHydration(page);
    waitsItsTurn(page);
  });
  context.on("request", (request) => {
    const action = request.headers()["next-action"];
    if (action) {
      note(`A ${action}`);
      return;
    }
    if (request.isNavigationRequest() && request.frame().parentFrame() === null) {
      const url = new URL(request.url());
      void who(context).then((role) => note(`P ${role} ${url.pathname}`));
    }
  });
}

/**
 * NO PUSH ON WEBKIT — a limit of the bench, not of the app (2026-10-11).
 *
 * Playwright's WebKit build on Windows offers `PushManager` and then HANGS
 * inside it: `registration.pushManager.getSubscription()` never answers and
 * takes the whole page with it. The player's Today asks exactly that the
 * second time it loads (once the service worker is there), so on this engine
 * the screen froze on every second visit — which read, for an hour, as the
 * app freezing on an iPhone. Taking `PushManager` away before the page runs
 * makes the switch say "unavailable", which is what it says on any browser
 * without push.
 *
 * So push notifications are NOT covered on WebKit. Real Safari implements
 * that call; the real-phone push test is still owed.
 */
async function noPushOnWebKit(context: BrowserContext): Promise<void> {
  if (context.browser()?.browserType().name() !== "webkit") return;
  await context.addInitScript(() => {
    try {
      delete (window as unknown as { PushManager?: unknown }).PushManager;
    } catch {
      /* not configurable: the page will hang, and the spec will say so */
    }
  });
}

export const test = base.extend<object, { coverageOfHandMadeContexts: void }>({
  // The default context every `page` fixture uses.
  context: async ({ context }, use) => {
    recordCoverage(context);
    await noPushOnWebKit(context);
    await keepWhatTheServerSent(context);
    await use(context);
  },
  // And any context a spec makes for itself — a second player, a signed-out
  // visitor — which is where the multi-role flows live.
  coverageOfHandMadeContexts: [
    async ({ browser }, use) => {
      const make = browser.newContext.bind(browser);
      browser.newContext = async (...args: Parameters<typeof make>) => {
        // A context a spec makes for itself does not inherit the config's
        // `use`, so the reader's time zone (see playwright.config.ts) is
        // handed to it here, unless the spec named one of its own.
        const zone = process.env.E2E_TZ;
        // …and the reader's language and region (E2E_LOCALE), on the same terms.
        const lang = process.env.E2E_LOCALE;
        const context = await (zone || lang
          ? make({ ...(zone ? { timezoneId: zone } : {}), ...(lang ? { locale: lang } : {}), ...args[0] })
          : make(...args));
        recordCoverage(context);
        await noPushOnWebKit(context);
        await keepWhatTheServerSent(context);
        return context;
      };
      await use();
      browser.newContext = make;
    },
    { scope: "worker", auto: true },
  ],
});

export { expect };
export type { Page, Locator, Browser, BrowserContext, TestInfo } from "@playwright/test";
