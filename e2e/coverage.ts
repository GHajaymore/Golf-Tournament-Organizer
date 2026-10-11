import { test as base, expect, type BrowserContext } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { explainHydration } from "./page-errors";

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

export function recordCoverage(context: BrowserContext): void {
  if (watched.has(context)) return;
  watched.add(context);
  // Every page of every context explains a hydration mismatch if one lands on
  // it — see `explainHydration`. Here, because this is the one place every
  // spec's every context passes through.
  for (const page of context.pages()) explainHydration(page);
  context.on("page", (page) => explainHydration(page));
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

export const test = base.extend<object, { coverageOfHandMadeContexts: void }>({
  // The default context every `page` fixture uses.
  context: async ({ context }, use) => {
    recordCoverage(context);
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
        const context = await (zone ? make({ timezoneId: zone, ...args[0] }) : make(...args));
        recordCoverage(context);
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
