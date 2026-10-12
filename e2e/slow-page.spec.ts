import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { seed, teardown } from "../scripts/seed-club.mjs";

/**
 * A PAGE THAT ARRIVES SLOWLY IS STILL THE PAGE THE SERVER SENT.
 *
 * Every spec in this suite is served by a machine next door: a page's HTML and
 * the data that follows it down the same connection arrive whole, before the
 * browser has started on them. A phone on a golf course is not served that
 * way. Its pages arrive in pieces — and for as long as this suite has existed
 * it has, about once in several hundred page loads and never on the same
 * screen twice, seen React throw a page away and draw it again (error #418)
 * for no reason anybody could find. It was written up as a fourth intermittent
 * fault, re-run, and re-run.
 *
 * It was never random. On 2026-10-12 the same screens were opened through a
 * proxy that hands the HTML over 1,200 bytes at a time: opened directly, 0 of
 * 84 loads threw; through the proxy, 11 of 84, 14 of 84 and 15 of 84 at three
 * speeds, on every screen tried. The development build then said what it had
 * tripped on, and it was always the same shape — React expecting an element
 * and standing on that element's own first child. React loses its place when
 * it comes back to an element whose data had not arrived the first time
 * (facebook/react#35494, fixed in React 19.3.0, not in the React Next 15.5
 * bundles). `scripts/react-hydration-replay-backport.cjs` puts that fix into
 * the build; this is the test that it is there and that it works.
 *
 * WHAT IT DOES. Seeds the club, stands a proxy in front of the server under
 * test that delivers HTML slowly and everything else at once, and opens the
 * heaviest player and console screens through it, again and again. No load may
 * throw a hydration error.
 *
 * WHY THAT MANY LOADS. Unfixed, about one slow load in seven throws. Thirty
 * loads all passing by luck is under two in a hundred; one load would pass six
 * times in seven and prove nothing.
 *
 * THREE CONTROLS, because each of the ways this could pass without testing
 * anything was met while it was being written:
 *  - the pages really were delivered slowly (the proxy counts its pieces, and
 *    the browser's own clock says how long the document took to arrive);
 *  - they really were the signed-in screens, not thirty sign-in redirects;
 *  - the React running really is the one built with the fix in it — a build
 *    cache handing back yesterday's bundle would otherwise only be caught by
 *    the odds.
 *
 * One project only: the fault is in how a document is wired up, not in how
 * wide it is, and at three seconds a load it is the slowest spec there is.
 */

const PIECE = 1200;
const PAUSE = 4;
const ROUNDS = 5;
const SCREENS: Array<["player" | "organizer", string]> = [
  ["player", "/me"],
  ["player", "/me/help"],
  ["player", "/me/rules"],
  ["player", "/me/board"],
  ["organizer", "/dashboard"],
  ["organizer", "/cup"],
];

const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Club = Awaited<ReturnType<typeof seed>>;
let club: Club;
let proxy: http.Server;
let pieces = 0;

test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== "phone") return;
  club = await seed();
});
test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== "phone") return;
  await new Promise((r) => (proxy ? proxy.close(r) : r(null)));
  await teardown();
});

/** Hands HTML over a piece at a time with a pause between pieces; passes everything else straight through. */
function slowly(upstream: URL): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const headers = { ...req.headers, host: upstream.host, "accept-encoding": "identity" };
    const up = http.request({ hostname: upstream.hostname, port: upstream.port, method: req.method, path: req.url, headers }, async (back) => {
      const html = String(back.headers["content-type"] ?? "").includes("text/html");
      const out = { ...back.headers };
      if (html) delete out["content-length"];
      res.writeHead(back.statusCode ?? 502, out);
      if (!html) return void back.pipe(res);
      try {
        for await (const chunk of back as AsyncIterable<Buffer>) {
          for (let at = 0; at < chunk.length; at += PIECE) {
            res.write(chunk.subarray(at, at + PIECE));
            pieces += 1;
            await sleep(PAUSE);
          }
        }
      } catch {
        /* the browser left for the next page */
      }
      res.end();
    });
    up.on("error", () => {
      res.statusCode = 502;
      res.end();
    });
    req.pipe(up);
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

test("no page delivered slowly is thrown away and drawn again", async ({ browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "one project: the fault is in how a document is wired up, not in how wide it is");
  test.setTimeout(600_000);
  proxy = await slowly(new URL(baseURL!));
  const slow = `http://localhost:${(proxy.address() as AddressInfo).port}`;
  const landing = sign(club.landing.id);

  const threw: string[] = [];
  let loads = 0;
  let slowest = 0;
  let marked: unknown = null;

  for (const who of ["player", "organizer"] as const) {
    const context = await browser.newContext({ ...testInfo.project.use, baseURL: slow, storageState: undefined });
    await context.addCookies([
      { name: "ng_session", value: club[who].session, url: slow },
      { name: "ng_active_event", value: landing, url: slow },
    ]);
    const page = await context.newPage();
    let at = "";
    page.on("pageerror", (e) => {
      if (/#418|#42[1-5]|Hydration failed|hydrat/i.test(String(e))) threw.push(`${at}: ${String(e).slice(0, 110)}`);
    });
    try {
      for (let round = 0; round < ROUNDS; round += 1) {
        for (const [whose, path] of SCREENS) {
          if (whose !== who) continue;
          at = `${who} ${path} (load ${round + 1})`;
          const res = await page.goto(`${path}?slow=${Date.now()}`, { waitUntil: "domcontentloaded" });
          await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
          loads += 1;
          // CONTROL: the screen itself, signed in — not a redirect to the front door.
          expect(res?.status(), `${at} answered`).toBe(200);
          expect(new URL(page.url()).pathname, `${at} was sent elsewhere`).toBe(path);
          expect(await page.locator("h1").count(), `${at} has no heading`).toBeGreaterThan(0);
          const timing = await page.evaluate(() => {
            const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
            return {
              arriving: nav ? Math.round(nav.responseEnd - nav.responseStart) : 0,
              marked: (window as unknown as { __thqHydrationReplayBackport?: unknown }).__thqHydrationReplayBackport,
            };
          });
          slowest = Math.max(slowest, timing.arriving);
          marked = timing.marked;
        }
      }
    } finally {
      await context.close();
    }
  }

  console.log(`[slow-page] ${loads} loads through the proxy in ${pieces} pieces; the slowest document took ${slowest}ms to arrive; ${threw.length} threw`);
  // CONTROL: slow delivery happened. A proxy that passed pages straight through would pass this spec every time.
  expect(pieces, "the proxy handed over almost nothing piece by piece").toBeGreaterThan(loads * 20);
  expect(slowest, "no document took any time to arrive: this was not slow delivery").toBeGreaterThan(400);
  expect(loads).toBe(ROUNDS * SCREENS.length);
  // CONTROL: the bundle under test is the one built with the fix.
  expect(marked, "the React running was not built with scripts/react-hydration-replay-backport.cjs in it").toBe(1);
  expect(threw, "pages React threw away and drew again").toEqual([]);
});
