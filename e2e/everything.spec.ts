import { test, expect, type Page, type BrowserContext } from "./coverage";
import { createHmac } from "node:crypto";
import { consoleScreens, playerScreens } from "./routes";
import { overflowing } from "./overflow";
import { watchPageErrors } from "./page-errors";
// The club with eleven tournaments in eleven states — see its own header.
import { seed, teardown } from "../scripts/seed-club.mjs";

/**
 * EVERY SCREEN, IN EVERY TOURNAMENT THE CLUB HAS, AS EVERYONE WHO CAN OPEN IT.
 *
 * Ajay, 2026-10-10: "When you test, you test across the board — that's the
 * e2e… it should cover EVERYTHING IN THE APP." What prompted it: eleven
 * scripted tournaments had passed three times and been called three clean
 * rounds, while every screen the suite rendered it rendered in ONE state — the
 * standard fixture's single tournament — and every script walked one careful
 * path.
 *
 * This is the first layer of the answer, and it is deliberately dumb: no
 * script, no path. The seeded club holds eleven tournaments — a live medal, a
 * completed championship with a cut, a knockout mid-bracket, a weekly league,
 * a four-ball finishing away, a nine-hole Stableford, three still taking
 * entries, a bare draft and a festival of every other format — and this opens
 * EVERY console screen on EVERY one of them as the secretary, EVERY player
 * screen on every one as a member, and every public board signed out. The
 * screen lists are read from the filesystem, so a screen added tomorrow is
 * walked tomorrow.
 *
 * What it can see, on each of those several hundred renders: a screen that
 * answers with an error; one that throws in the browser; one that prints a
 * programmer's value at a golfer ("NaN", "undefined", "Invalid Date"); one
 * with no heading; one that scrolls sideways.
 *
 * What it cannot: whether a number is RIGHT. That is the next layer's job —
 * controls that round-trip, and scenarios held to the Rules — and
 * `scripts/e2e-coverage.mjs` prints what no layer has reached yet.
 */

const sign = (v: string) =>
  `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

type Club = Awaited<ReturnType<typeof seed>>;
let club: Club;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  club = await seed();
});

test.afterAll(async () => {
  await teardown();
});

/** Words no golfer should ever be shown: a value the code failed to turn into one. */
const PROGRAMMER_VALUE = /\bNaN\b|\bundefined\b|\[object Object\]|Invalid Date|\bnull\b/;

interface Finding {
  where: string;
  what: string;
}

async function signIn(context: BrowserContext, baseURL: string, session: string | null, eventId: string | null) {
  await context.clearCookies();
  const cookies = [];
  if (session) cookies.push({ name: "ng_session", value: session, url: baseURL });
  if (eventId) cookies.push({ name: "ng_active_event", value: sign(eventId), url: baseURL });
  if (cookies.length) await context.addCookies(cookies);
}

/**
 * Open one screen and say everything that is wrong with it.
 *
 * `mustStay` is for a screen this visitor is entitled to: being sent somewhere
 * else is then a finding, and it is also the control that the cookie worked —
 * a walk of four hundred sign-in redirects would otherwise pass.
 */
/**
 * SCREENS THAT ARE ABOUT ONE THING A TOURNAMENT MAY NOT HAVE — a knockout
 * draw. Where the menu withholds one, a typed address must not open it as
 * though the tournament had that thing: the bracket manager drew an empty
 * Final and "0 players qualify for the knockout round" for a 36-hole
 * stroke-play championship (2026-10-10). Such a screen sends the visitor back.
 *
 * `/week` is NOT in this list, and was for one run. The menu withholds "This
 * week" from a one-round tournament because it would be a second name for the
 * leaderboard, not because the sheet is wrong there: it reports that one
 * round's real results, read-only. A duplicate door is a menu decision; a
 * screen describing something that does not exist is a defect. `/cup` is out
 * for the same reason — it says in words what is missing and where to add it.
 */
const ABOUT_ONE_THING = ["/bracket"];

async function look(page: Page, path: string, who: string, findings: Finding[], mustStay: boolean, mustLeave = false) {
  const where = `${who} ${path}`;
  const failed: string[] = [];
  const onResponse = (r: { status(): number; url(): string }) => {
    if (r.status() >= 500) failed.push(`${r.status()} ${new URL(r.url()).pathname}`);
  };
  page.on("response", onResponse);
  let status = 0;
  try {
    const res = await page.goto(`${path}${path.includes("?") ? "&" : "?"}walk=${Date.now()}`, { waitUntil: "domcontentloaded" });
    status = res?.status() ?? 0;
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  } catch (e) {
    findings.push({ where, what: `did not load: ${String(e).slice(0, 120)}` });
    page.off("response", onResponse);
    return;
  }
  page.off("response", onResponse);

  const landed = new URL(page.url()).pathname;
  if (status >= 400) findings.push({ where, what: `answered ${status}` });
  for (const f of failed) findings.push({ where, what: `a request failed: ${f}` });
  if (mustStay && landed !== path.split("?")[0]) {
    findings.push({ where, what: `sent to ${landed}` });
    return;
  }
  if (landed !== path.split("?")[0]) return; // a redirect this visitor is meant to get
  if (mustLeave) findings.push({ where, what: "opened as though this tournament had one — the menu withholds it here" });

  const seen = await page.evaluate(() => ({
    text: document.body.innerText,
    h1: document.querySelectorAll("h1").length,
  }));
  const bad = PROGRAMMER_VALUE.exec(seen.text);
  if (bad) {
    const at = Math.max(0, bad.index - 40);
    findings.push({ where, what: `prints "${bad[0]}": …${seen.text.slice(at, bad.index + 30).replace(/\s+/g, " ")}…` });
  }
  if (/Application error|This page could not be found/i.test(seen.text)) findings.push({ where, what: "shows the framework's error page" });
  if (seen.h1 === 0) findings.push({ where, what: "has no heading" });
  const wide = await overflowing(page);
  if (wide.length) findings.push({ where, what: `scrolls sideways: ${wide[0].cls || wide[0].text} to ${wide[0].right}px` });
}

function report(findings: Finding[], looked: number, what: string) {
  // Printed whether or not it passes: a walk reports its reach with its result.
  console.log(`[everything] ${what}: ${looked} screens opened, ${findings.length} findings`);
  expect(
    findings.map((f) => `${f.where} — ${f.what}`),
    `${findings.length} findings across ${looked} screens`,
  ).toEqual([]);
}

test("the secretary can open every console screen on every tournament the club has", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the console is walked at the desktop width; its phone layout is layout.spec's");
  test.setTimeout(900_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const findings: Finding[] = [];
  const screens = consoleScreens();
  let looked = 0;
  let offeredTotal = 0;
  for (const event of club.events) {
    await signIn(context, baseURL!, club.organizer.session, event.id);
    // WHAT THE MENU OFFERS FOR THIS TOURNAMENT, read off the menu. A screen it
    // offers must open; one it does not offer may properly send a typed
    // address elsewhere (the week sheet on a tournament with no rounds), and
    // is still opened so that it cannot answer with an error.
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle").catch(() => {});
    const offered = new Set(
      await page.locator("aside.app-sidebar a[href]").evaluateAll((links) =>
        links.map((a) => new URL((a as HTMLAnchorElement).href).pathname),
      ),
    );
    if (offered.size < 5) findings.push({ where: `secretary · ${event.slug}`, what: `the menu offered only ${offered.size} screens` });
    offeredTotal += screens.filter((p) => offered.has(p)).length;
    for (const path of screens) {
      await look(
        page, path, `secretary · ${event.slug} (${event.status})`, findings,
        offered.has(path) || path === "/dashboard",
        !offered.has(path) && ABOUT_ONE_THING.includes(path),
      );
      looked += 1;
    }
  }
  console.log(`[everything] of those, ${offeredTotal} were screens the menu offered for that tournament`);
  for (const e of errors) findings.push({ where: "secretary", what: `threw in the browser: ${e.slice(0, 200)}` });
  // CONTROL: the walk is every screen times every tournament, or it is not the walk.
  expect(club.events.length, "the seeded club lost its tournaments").toBeGreaterThanOrEqual(11);
  expect(looked).toBe(screens.length * club.events.length);
  report(findings, looked, "secretary, every console screen x every tournament");
});

test("a member can open every player screen on every tournament the club has", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the player app is walked at a phone's width");
  test.setTimeout(900_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "member");
  const findings: Finding[] = [];
  const screens = playerScreens();
  let looked = 0;
  let stayed = 0;
  for (const event of club.events) {
    await signIn(context, baseURL!, club.player.session, event.id);
    for (const path of screens) {
      const before = findings.length;
      // Not `mustStay`: a member who is not in a tournament is properly sent
      // elsewhere from some screens. The control below is that MOST stayed.
      await look(page, path, `member · ${event.slug} (${event.status})`, findings, false);
      looked += 1;
      if (new URL(page.url()).pathname === path && findings.length === before) stayed += 1;
    }
  }
  for (const e of errors) findings.push({ where: "member", what: `threw in the browser: ${e.slice(0, 200)}` });
  expect(looked).toBe(screens.length * club.events.length);
  // CONTROL: a cookie that did not work sends every screen to sign-in, and a
  // walk of redirects finds nothing. The member is in eight of the eleven.
  expect(stayed, `only ${stayed} of ${looked} player screens were actually reached`).toBeGreaterThan(looked / 2);
  report(findings, looked, "member, every player screen x every tournament");
});

test("anyone can open every public board the club has published", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "small-phone", "public boards are walked on the smallest phone");
  test.setTimeout(300_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "visitor");
  const findings: Finding[] = [];
  await signIn(context, baseURL!, null, null);
  let looked = 0;
  for (const [name, token] of Object.entries(club.shareTokens)) {
    await look(page, `/live/${token}`, `visitor · ${name}`, findings, true);
    looked += 1;
  }
  for (const e of errors) findings.push({ where: "visitor", what: `threw in the browser: ${e.slice(0, 200)}` });
  expect(looked).toBeGreaterThanOrEqual(5);
  report(findings, looked, "signed out, every public board");
});
