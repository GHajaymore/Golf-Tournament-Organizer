import { test, expect, type Browser, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { seedClubhouse, teardownClubhouse } from "./clubhouse-fixture.mjs";

/**
 * THE CLUBHOUSE SCREEN AND THE EVENT PAGE, USED BY THE PEOPLE WHO USE THEM (2026-10-24).
 *
 * Its own throwaway club (`clubhouse-fixture.mjs`, mark `zz-clubhouse-<project>`),
 * seeded before and removed after, so it shares no row with the standing fixture.
 *
 *   the secretary, on Tournament details    → finds "Event page" and "Clubhouse
 *                                             screen" beside the public board link,
 *                                             each pointing under the board's token
 *   a TV in the bar, signed out             → the board, large, no picker and no
 *                                             buttons; a 30-player field in pages
 *                                             that never cut a row; the page turns
 *                                             on its own and comes back to the first;
 *                                             it refreshes on the board's 30 seconds;
 *                                             the same names as the board, no more;
 *                                             no slide under reduced motion, a slide
 *                                             without it; 1920x1080 and 1280x720
 *   a visitor, signed out, on the event page → before: entries open, the entry link
 *                                             and its QR poster; during: the board and
 *                                             the clubhouse screen, the straightest
 *                                             drive and its sponsor; after: the
 *                                             report's summary and link, no amounts
 *   CONTROL: a board held from players      → the clubhouse screen and the event page
 *            (results not released), and      both 404 and print nothing of it — and
 *            a board kept to players          the same requests on a public board are
 *                                             200, so the 404 is not the test's own
 *
 * WHAT IT CANNOT SEE: a real TV's browser (it is Chromium at the TV's size), a
 * printed poster (the page the Print button prints is checked), and copying to
 * the clipboard (the text that would be copied is read instead). Nothing on
 * these screens says no, so there is no refusal to place beside a press.
 */

type Seeded = Awaited<ReturnType<typeof seedClubhouse>>;
let seeded: Seeded;
let MARK = "zz-clubhouse";

test.beforeAll(async ({}, info) => {
  MARK = `zz-clubhouse-${info.project.name}`;
  seeded = await seedClubhouse(MARK);
});
test.afterAll(async () => {
  await teardownClubhouse(MARK);
});

const bust = (path: string) => `${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`;

/** A signed-out visitor at a given screen size, with the motion preference given. */
async function visitor(browser: Browser, baseURL: string, opts: { width?: number; height?: number; motion?: "reduce" | "no-preference" } = {}) {
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
    ...(opts.width ? { viewport: { width: opts.width, height: opts.height ?? 900 } } : {}),
    reducedMotion: opts.motion ?? "reduce",
  });
  return { context, page: await context.newPage() };
}

/** Every row of the board on screen is either wholly inside the clubhouse view or wholly outside it. */
async function cutRows(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const view = document.querySelector(".ch-view")!.getBoundingClientRect();
    const out: string[] = [];
    for (const li of document.querySelectorAll(".ch-board li")) {
      const r = li.getBoundingClientRect();
      const inside = r.top >= view.top - 1 && r.bottom <= view.bottom + 1;
      const outside = r.bottom <= view.top + 1 || r.top >= view.bottom - 1;
      if (!inside && !outside) out.push(`${(li.textContent ?? "").slice(0, 40)} ${Math.round(r.top)}-${Math.round(r.bottom)} in ${Math.round(view.top)}-${Math.round(view.bottom)}`);
    }
    return out;
  });
}

const namesOn = (page: Page, scope: string) =>
  page.locator(scope).evaluate((el, field) => field.filter((n: string) => (el.textContent ?? "").includes(n)), seeded.live.players);

test("the secretary finds the event page and the clubhouse screen beside the board link", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    await context.addCookies([
      { name: "ng_session", value: seeded.organizer.session, url: baseURL! },
      { name: "ng_active_event", value: seeded.organizer.event, url: baseURL! },
    ]);
    const page = await context.newPage();
    watchPageErrors(page, errors);
    await page.goto(bust("/event"));
    const box = page.locator("div", { hasText: "Public leaderboard link" }).filter({ has: page.getByText("Clubhouse screen", { exact: true }) }).last();
    await expect(box, "the board link's box has no clubhouse screen").toBeVisible({ timeout: 30_000 });
    const token = seeded.live.shareToken;
    const eventLink = box.getByRole("link", { name: /Open event page/ });
    const tvLink = box.getByRole("link", { name: /Open clubhouse screen/ });
    await expect(eventLink).toHaveAttribute("href", `/live/${token}/event`);
    await expect(tvLink).toHaveAttribute("href", `/live/${token}?screen=clubhouse`);
    // What Copy would put on the clipboard: the whole address, on this server.
    await expect(box.getByText(`${baseURL}/live/${token}/event`, { exact: true })).toBeVisible();
    await expect(box.getByText(`${baseURL}/live/${token}?screen=clubhouse`, { exact: true })).toBeVisible();
    await expect(box.getByRole("button", { name: "Copy the clubhouse screen link" })).toBeVisible();
  } finally {
    await context.close();
  }
  expect(errors, "a screen threw").toEqual([]);
});

test("a TV in the clubhouse shows the board large, a page at a time, and refreshes on the board's cadence", async ({ browser, baseURL }, info) => {
  test.skip(info.project.name !== "desktop", "a TV is one screen size, set here; one project is enough");
  test.setTimeout(180_000);
  const errors: string[] = [];
  const token = seeded.live.shareToken;

  // The board as anybody with the link sees it, for the comparison.
  const plain = await visitor(browser, baseURL!, { width: 1280, height: 720 });
  watchPageErrors(plain.page, errors);
  await plain.page.goto(bust(`/live/${token}`));
  await expect(plain.page.getByRole("heading", { level: 1 })).toHaveText(seeded.live.name);
  const boardNames = await namesOn(plain.page, "main");
  const plainHeight = await plain.page.getByText(seeded.live.players[0], { exact: true }).first().evaluate((el) => el.getBoundingClientRect().height);
  await plain.context.close();
  expect(boardNames, "the board does not list the field it is compared with").toEqual(seeded.live.players);

  for (const size of [
    { width: 1280, height: 720, larger: 1.1 },
    { width: 1920, height: 1080, larger: 1.4 },
  ]) {
    const tv = await visitor(browser, baseURL!, size);
    const page = tv.page;
    watchPageErrors(page, errors);
    try {
      await page.clock.install();
      await page.goto(bust(`/live/${token}?screen=clubhouse`));
      const screen = page.getByRole("main", { name: "Clubhouse screen" });
      await expect(screen, `${size.width}x${size.height}: no clubhouse screen`).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(seeded.live.name);

      // No chrome: nothing to choose, nothing to press.
      await expect(page.getByLabel("Which round the leaderboard shows")).toHaveCount(0);
      await expect(page.getByRole("button")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Read the final report" })).toHaveCount(0);

      // Nothing the board does not show: the same field, and nobody else.
      expect(await namesOn(page, ".ch-board"), "the clubhouse screen lists a different field from the board").toEqual(boardNames);

      // Large type: the same name, drawn taller than the board draws it.
      const tall = await page.locator(".ch-board").getByText(seeded.live.players[0], { exact: true }).first().evaluate((el) => el.getBoundingClientRect().height);
      expect(tall, `${size.width}x${size.height}: a name is ${tall}px against the board's ${plainHeight}px`).toBeGreaterThanOrEqual(plainHeight * size.larger);
      // The screen itself never scrolls.
      const doc = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth }));
      expect(doc.h, "the clubhouse screen scrolls").toBeLessThanOrEqual(doc.ih + 1);
      expect(doc.w, "the clubhouse screen scrolls sideways").toBeLessThanOrEqual(doc.iw + 1);

      // Thirty players do not fit: pages, each whole.
      await expect.poll(async () => Number(await screen.getAttribute("data-pages")), { timeout: 10_000 }).toBeGreaterThan(1);
      const pages = Number(await screen.getAttribute("data-pages"));
      await expect(page.getByText(`Page 1 of ${pages}`)).toBeVisible();
      // Reduced motion: the page switches; nothing slides.
      expect(await page.locator(".ch-slide").evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");

      const seen = new Set<string>();
      for (let p = 1; p <= pages; p += 1) {
        await expect(screen, `page ${p} did not come up`).toHaveAttribute("data-page", String(p));
        await expect(page.getByText(`Page ${p} of ${pages}`)).toBeVisible();
        expect(await cutRows(page), `${size.width}x${size.height}, page ${p}: a row is cut in half`).toEqual([]);
        for (const n of await page.evaluate((field) => {
          const view = document.querySelector(".ch-view")!.getBoundingClientRect();
          return [...document.querySelectorAll(".ch-board li")]
            .filter((li) => { const r = li.getBoundingClientRect(); return r.top >= view.top - 1 && r.bottom <= view.bottom + 1; })
            .flatMap((li) => field.filter((name: string) => (li.textContent ?? "").includes(name)));
        }, seeded.live.players)) seen.add(n);
        await page.clock.fastForward(12_000);
      }
      // Every player was on some page, and after the last it starts again.
      expect([...seen].sort(), "somebody was never on any page").toEqual([...seeded.live.players].sort());
      await expect(screen, "after the last page it did not start again").toHaveAttribute("data-page", "1");

      // It refreshes itself on the board's cadence: a page-data request within 30 seconds.
      const refreshed = page.waitForRequest((r) => r.headers()["rsc"] === "1", { timeout: 15_000 });
      await page.clock.fastForward(30_000);
      await refreshed;
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(seeded.live.name);
      await page.screenshot({ path: test.info().outputPath(`clubhouse-${size.width}x${size.height}.png`) });
    } finally {
      await tv.context.close();
    }
  }

  // Without reduced motion the page slides to the next one.
  const moving = await visitor(browser, baseURL!, { width: 1280, height: 720, motion: "no-preference" });
  try {
    await moving.page.goto(bust(`/live/${token}?screen=clubhouse`));
    await expect(moving.page.getByRole("main", { name: "Clubhouse screen" })).toBeVisible({ timeout: 30_000 });
    expect(await moving.page.locator(".ch-slide").evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0.6s");
  } finally {
    await moving.context.close();
  }

  expect(errors, "a screen threw").toEqual([]);
});

test("the event page leads with entries before the day, the board on it, and the report after", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const { page, context } = await visitor(browser, baseURL!);
  watchPageErrors(page, errors);
  try {
    // ── before the day: entries open ───────────────────────────────────────
    await page.goto(bust(`/live/${seeded.entries.shareToken}/event`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(seeded.entries.name);
    await expect(page.getByText(`${MARK} Heath`).first(), "the course is not on the event page").toBeVisible();
    await expect(page.getByText("Individual Stroke Play").first(), "the format is not on the event page").toBeVisible();
    const entries = page.getByRole("region", { name: "Entries" });
    await expect(entries).toContainText("Entries are open");
    await expect(entries).toContainText("39 places left");
    const enter = entries.getByRole("link", { name: "Enter this tournament" });
    await expect(enter).toHaveAttribute("href", `/register/${seeded.entries.registrationToken}`);
    // The QR poster prints the same entry link, whole.
    await entries.getByRole("button", { name: "Show QR code" }).click();
    await expect(page.locator("section.signup-poster")).toHaveAttribute("data-link", `${baseURL}/register/${seeded.entries.registrationToken}`);
    await expect(page.getByRole("region", { name: "Leaderboard" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Clubhouse screen" }), "a clubhouse screen offered before the day").toHaveCount(0);
    // Entries come first.
    const order = await page.locator("main section[aria-label]").evaluateAll((s) => s.map((e) => e.getAttribute("aria-label")));
    expect(order.slice(0, 2)).toEqual(["Entries", "Leaderboard"]);
    // And the entry link opens the entry form.
    await enter.click();
    await expect(page).toHaveURL(new RegExp(`/register/${seeded.entries.registrationToken}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(seeded.entries.name);

    // ── on the day: the board and the clubhouse screen, the contest and its sponsor ──
    await page.goto(bust(`/live/${seeded.live.shareToken}/event`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(seeded.live.name);
    await expect(page.getByRole("region", { name: "Entries" }), "entries offered on a closed field").toHaveCount(0);
    await expect(page.getByRole("region", { name: "Leaderboard" }).getByRole("link", { name: "Open the leaderboard" })).toHaveAttribute("href", `/live/${seeded.live.shareToken}`);
    const tv = page.getByRole("region", { name: "Clubhouse screen" }).getByRole("link", { name: "Open the clubhouse screen" });
    await expect(tv).toHaveAttribute("href", `/live/${seeded.live.shareToken}?screen=clubhouse`);
    const contests = page.getByRole("region", { name: "Contests" });
    const line = contests.getByRole("listitem").filter({ hasText: "Straightest drive · 10th" });
    await expect(line, "the straightest drive is not on the event page").toContainText(seeded.straightestWinner);
    await expect(line).toContainText(`Sponsored by ${MARK} Motors`);
    await expect(contests.getByText("Thanks to our sponsors:")).toBeVisible();
    // The same contest on the board itself.
    await page.goto(bust(`/live/${seeded.live.shareToken}`));
    await expect(page.getByRole("region", { name: "Contests" }).getByRole("listitem").filter({ hasText: "Straightest drive · 10th" })).toContainText(seeded.straightestWinner);

    // ── afterwards: the report's summary and its link, the public copy ─────
    await page.goto(bust(`/live/${seeded.finished.shareToken}/event`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(seeded.finished.name);
    const result = page.getByRole("region", { name: "Final report" });
    await expect(result).toContainText("The result");
    await expect(result, "the report summary names no winner").toContainText(/Ann Example/);
    await expect(result, "an amount on the public summary").not.toContainText(/[$£€]\s?\d/);
    const order2 = await page.locator("main section[aria-label]").evaluateAll((s) => s.map((e) => e.getAttribute("aria-label")));
    expect(order2[0]).toBe("Final report");
    await expect(page.getByRole("region", { name: "Clubhouse screen" })).toHaveCount(0);
    await result.getByRole("link", { name: "Read the final report" }).click();
    await expect(page).toHaveURL(new RegExp(`/live/${seeded.finished.shareToken}/report$`));
    await expect(page.getByText(seeded.finished.name).first()).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("event-page-after.png"), fullPage: true });
  } finally {
    await context.close();
  }
  expect(errors, "a screen threw").toEqual([]);
});

test("CONTROL: a board whose results are held, or kept to players, has no clubhouse screen and no event page", async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const { page, context } = await visitor(browser, baseURL!);
  try {
    for (const t of [seeded.held, seeded.members]) {
      for (const path of [`/live/${t.shareToken}?screen=clubhouse`, `/live/${t.shareToken}/event`, `/live/${t.shareToken}`]) {
        const res = await page.goto(bust(path));
        expect(res?.status(), `${path} answered`).toBe(404);
        const text = await page.locator("body").innerText();
        for (const secret of [...t.players, t.name, `${MARK} Hidden Sponsor`]) {
          expect(text, `${path} printed "${secret}"`).not.toContain(secret);
        }
        await expect(page.getByRole("main", { name: "Clubhouse screen" })).toHaveCount(0);
      }
    }
    // The control's control: the same requests on a public board are answered, with its names.
    for (const path of [`/live/${seeded.live.shareToken}?screen=clubhouse`, `/live/${seeded.live.shareToken}/event`]) {
      const res = await page.goto(bust(path));
      expect(res?.status(), `${path} answered`).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(seeded.live.name);
    }
  } finally {
    await context.close();
  }
});
