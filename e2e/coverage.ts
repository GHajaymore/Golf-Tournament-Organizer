import { test as base, expect, type BrowserContext, type Page, type Request as PageRequest } from "@playwright/test";
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
 *   R <role> <path> … a refusal appeared after a press with none of it on the
 *                   screen (see `watchRefusals`)
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
/**
 * AND IT ASKS BEFORE THE SAVE IT HAS JUST MADE IS BACK.
 *
 * The other half of the same sentence. A box that saves when it is left sends
 * its save as the spec's next line runs, and that line is very often `goto` —
 * a whole new document, which CANCELS a request still on its way. The save
 * never lands, the reloaded page shows the old value, and the spec reports the
 * app losing an edit. `members.spec` typed a handicap of +3.1, pressed Enter,
 * reloaded, and read +2.4 (round 7 on the second batch, 2026-10-13; it had
 * passed every round before, and this batch makes pages answer sooner).
 *
 * A person who leaves a screen by its menu does not do this: the app moves
 * without a new document and the save carries on. So before a spec asks for an
 * address, any server action that page still has in flight is let come back.
 *
 * Measured, with every save held a second and a half: a stake typed and Enter
 * pressed, then the browser's own reload at once — nothing stored; then `goto`
 * at once — stored, the `goto` 1.9s late; `page.reload()` the same; and a
 * `goto` with nothing in flight, 0.2s.
 *
 * WHAT THIS GIVES UP, said plainly: no spec that goes through here can observe
 * an edit lost to a hard reload mid-save. Nothing in the app promises to keep
 * one; a test that wants to see it must hold the save back itself
 * (`slow-signal-scoring.spec.ts` does, with `page.route`).
 */
const savesInFlight = new WeakMap<Page, Set<PageRequest>>();
function watchSaves(context: BrowserContext): void {
  // Whose it was is remembered from when it left: a save cancelled by a reload has no frame to ask
  // by the time it fails.
  const owner = new WeakMap<PageRequest, Page>();
  const pageOf = (request: PageRequest): Page | null => {
    try {
      return request.frame().page();
    } catch {
      return null; // a worker's request, or a frame already gone
    }
  };
  context.on("request", (request) => {
    if (!request.headers()["next-action"]) return;
    const page = pageOf(request);
    if (!page) return;
    owner.set(request, page);
    if (!savesInFlight.has(page)) savesInFlight.set(page, new Set());
    savesInFlight.get(page)!.add(request);
  });
  const done = (request: PageRequest) => {
    const page = owner.get(request);
    if (page) savesInFlight.get(page)?.delete(request);
  };
  context.on("requestfinished", done);
  context.on("requestfailed", done);
}
async function savesAreBack(page: Page): Promise<void> {
  const until = Date.now() + 10_000;
  while ((savesInFlight.get(page)?.size ?? 0) > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
}

function waitsItsTurn(page: Page): void {
  // A new document has no saves of the old one's left to wait for. Without this, a save that a spec
  // was HOLDING BACK when the page was reloaded is never reported finished or failed, and every later
  // `goto` on that page waited the full ten seconds for it (measured by this wait's own control).
  page.on("domcontentloaded", () => savesInFlight.get(page)?.clear());
  // Asking for the same page again cancels a save exactly as asking for another does.
  const reload = page.reload.bind(page);
  page.reload = async (...args: Parameters<Page["reload"]>) => {
    await savesAreBack(page);
    return reload(...args);
  };
  const goto = page.goto.bind(page);
  page.goto = async (...args: Parameters<Page["goto"]>) => {
    await savesAreBack(page);
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

/**
 * A REFUSAL NOBODY CAN SEE IS A BUTTON THAT DOES NOTHING.
 *
 * Found twice in one morning (2026-10-13), by the first browser tests to use
 * two screens. In the course editor a card with a stroke index used twice was
 * refused in a line printed above the whole form; in Club settings "Enter a
 * valid email address." was printed above the roster while the button that
 * had been pressed was at the bottom of the page. Measured at laptop size,
 * both times: NONE of the sentence was on the screen. The person presses, and
 * nothing appears to happen.
 *
 * Twice is a class, and walking screens to find the rest finds them at a
 * constant rate for ever. So every page of every context in the suite watches
 * for it: when words that look like a refusal appear within four seconds of a
 * press and none of them is on the screen, a line goes in the ledger —
 *
 *   R <role> <path> | pressed: <what> | <marked or red> | <the words>
 *
 * — and `scripts/e2e-coverage.mjs` prints them with the reach. Every spec that
 * ever provokes a refusal is now a probe for this, without knowing it.
 *
 * WHAT COUNTS AS A REFUSAL: an element marked as one (`role="alert"`, or the
 * shared `.form-error`), or a short line drawn in the danger colour. The
 * second kind is a guess, and is labelled "red" for that reason — neither of
 * the two that started this was marked at all, so a watcher of marked
 * refusals alone would have seen neither. A red line can be something else (a
 * kitty that is short, a negative amount): the report prints the words so a
 * person can tell, and it is a list to READ, not a count to fail on.
 *
 * WHAT IT CANNOT SEE: a refusal that is on the screen and still far from the
 * button; one that appears with no press before it; and anything a spec never
 * provokes. It measures, like the rest of this file. It does not prove.
 */
const OUT_OF_SIGHT = "[refusal out of sight] ";
const WATCH_STOPPED = "[refusal watch] stopped on ";
async function watchRefusals(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as { __thqRefusalWatch?: boolean };
    if (w.__thqRefusalWatch) return;
    w.__thqRefusalWatch = true;
    let pressedAt = -1e9;
    let pressedWhat = "";
    // CAPPED BEFORE THE REGEX (2026-10-30). This ran over the whole text of whatever element the
    // page added, and on the team cup's final report Firefox overflowed its stack inside it:
    // "InternalError: too much recursion", counted as the SCREEN throwing (#968's round, Firefox
    // at phone size). Nothing longer than 400 characters is a refusal anyway (`kindOf`).
    const words = (el: Element | null) => ((el?.textContent ?? "") || (el?.getAttribute("aria-label") ?? "")).slice(0, 2_000).replace(/\s+/g, " ").trim();
    document.addEventListener(
      "click",
      (e) => {
        const at = e.target instanceof Element ? e.target : null;
        pressedAt = performance.now();
        pressedWhat = words(at?.closest("button, a, [role=button], summary, label") ?? at).slice(0, 40);
      },
      true,
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Enter") return;
        pressedAt = performance.now();
        pressedWhat = "Enter";
      },
      true,
    );
    // The danger colour WHERE THE WORDS ARE, not at the top of the document: a club's look is hung on
    // the screen's own wrapper, and the document underneath keeps the app's default. The first draft
    // asked the document, was told a dark theme's red, and saw nothing on a light screen — found by
    // its own control, on a refusal known to be off the screen.
    const dangerColourAt = (el: HTMLElement) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--color-danger)";
      (el.parentElement ?? document.body).appendChild(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    };
    const kindOf = (el: Element): "" | "marked" | "red" => {
      if (!(el instanceof HTMLElement) || el.closest("#__next-route-announcer__")) return "";
      const text = words(el);
      if (text.length < 6 || text.length > 400) return "";
      if (el.matches('[role="alert"], .form-error')) return "marked";
      if (!/^(P|SPAN|DIV)$/.test(el.tagName) || el.children.length > 2 || el.closest("button, a, table")) return "";
      // A refusal is a sentence. The first full run with this on (746 tests) recorded one thing, and it
      // was "-$13.34": a figure owed, drawn in the same red. Words, and more than one of them.
      if (text.replace(/[^A-Za-z]/g, "").length < 8 || !text.includes(" ")) return "";
      return getComputedStyle(el).color === dangerColourAt(el) ? "red" : "";
    };
    const told = new WeakSet<Element>();
    const look = (el: Element | null) => {
      if (!el || told.has(el)) return;
      if (performance.now() - pressedAt > 4_000) return;
      const kind = kindOf(el);
      if (!kind) return;
      told.add(el);
      const what = pressedWhat;
      // A moment for the screen to bring it into view itself, if it is going to.
      setTimeout(() => {
        if (!el.isConnected) return;
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) {
          // DRAWN IN A SECTION THE PERSON HAS LEFT: a tab of Club settings that is not the one
          // open (2026-10-21). Out of sight by definition, so it counts as seen only if the tab
          // it is behind is marked — which `SettingsTabs` does for exactly this.
          const panel = el.closest('[role="tabpanel"][hidden]');
          const tab = panel ? document.getElementById(panel.getAttribute("aria-labelledby") ?? "") : null;
          if (panel && !tab?.hasAttribute("data-refused")) {
            console.info(`[refusal out of sight] ${location.pathname} | pressed: ${what || "?"} | ${kind}, in a hidden tab with no mark | ${words(el).slice(0, 140)}`);
          }
          return;
        }
        const onScreen = box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth;
        if (!onScreen) console.info(`[refusal out of sight] ${location.pathname} | pressed: ${what || "?"} | ${kind} | ${words(el).slice(0, 140)}`);
      }, 400);
    };
    const start = () =>
      new MutationObserver((records) => {
        // AN INSTRUMENT NEVER THROWS INTO THE PAGE. Anything thrown here lands in the page's own
        // error list and fails the test as "a screen threw", blaming the app for the ruler.
        try {
          for (const r of records) {
            if (r.type === "characterData") {
              look(r.target.parentElement);
              continue;
            }
            r.addedNodes.forEach((n) => {
              if (n.nodeType === Node.TEXT_NODE) return look(n.parentElement);
              if (!(n instanceof HTMLElement)) return;
              look(n);
              const inside = n.querySelectorAll('[role="alert"], .form-error, p, span');
              for (let i = 0; i < inside.length && i < 40; i += 1) look(inside[i]);
            });
          }
        } catch (e) {
          console.info(`[refusal watch] stopped on ${location.pathname}: ${String(e).slice(0, 120)}`);
        }
      }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    if (document.documentElement) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  });
}

export function recordCoverage(context: BrowserContext): void {
  if (watched.has(context)) return;
  watched.add(context);
  watchSaves(context);
  const hear = (page: Page) =>
    page.on("console", (message) => {
      const text = message.text();
      if (text.startsWith(OUT_OF_SIGHT)) void who(context).then((role) => note(`R ${role} ${text.slice(OUT_OF_SIGHT.length)}`));
      // A watcher that stopped is said, not swallowed (the QA & Test Lead, 30 Oct): a watcher dead
      // on every page would otherwise read as "no refusals out of sight", which looks like clean.
      if (text.startsWith(WATCH_STOPPED)) note(`W ${text.slice(WATCH_STOPPED.length)}`);
    });
  // Every page of every context explains a hydration mismatch if one lands on
  // it — see `explainHydration`. Here, because this is the one place every
  // spec's every context passes through.
  for (const page of context.pages()) {
    explainHydration(page);
    waitsItsTurn(page);
    hear(page);
  }
  context.on("page", (page) => {
    explainHydration(page);
    waitsItsTurn(page);
    hear(page);
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
    await watchRefusals(context);
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
        await watchRefusals(context);
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
