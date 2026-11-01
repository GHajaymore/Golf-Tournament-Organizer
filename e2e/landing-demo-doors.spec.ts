import { test, expect } from "./coverage";
import { landingSettled } from "./landing-settled";

/**
 * THE FRONT DOOR'S FIVE BORROWINGS, AS A VISITOR READS THEM (2026-10-24; Ajay approved them from
 * Golf GameBook's site): the demo club's day, three doors, the QR for a laptop visitor's phone,
 * "On every plan" read from the plans, and three short answers.
 *
 * AND IN EACH COUNTRY'S WORDS. The page is written in US English and swapped per edition: a US
 * visitor reads leagues, golf groups and outings and never "society"; a British one reads
 * societies and society days. Asked of the WHOLE page's text, not of one sentence, because the
 * fault this guards against (until 2026-10-24) was a US visitor reading "Society days" in a list
 * nobody had checked.
 */
test.use({ storageState: { cookies: [], origins: [] } });

async function open(page: import("@playwright/test").Page, country?: string) {
  if (country) await page.setExtraHTTPHeaders({ "x-vercel-ip-country": country });
  const res = await page.goto(`/?bust=${Date.now()}`);
  expect(res?.status()).toBe(200);
  await landingSettled(page);
}

test("a US visitor reads leagues and golf groups, and never “society”", async ({ page }) => {
  await open(page, "US");
  const text = (await page.locator("body").innerText()).toLowerCase();
  expect(text).toContain("golf groups");
  expect(text, "a US visitor was shown the British word").not.toMatch(/societ(y|ies)/);
  await expect(page.locator("#for")).toContainText("Leagues & golf groups");
});

test("a British visitor reads societies and society days", async ({ page }) => {
  await open(page, "GB");
  const text = (await page.locator("body").innerText()).toLowerCase();
  expect(text, "a British visitor was not shown the British word").toMatch(/societ(y|ies)/);
  await expect(page.locator("#for")).toContainText("Leagues & societies");
  await expect(page.locator("#for-leagues")).toContainText("society days");
  await expect(page.locator("#for-leagues")).toContainText("fourball");
  await expect(page.locator("#for"), "the US word survived the British edition").not.toContainText("golf groups");
});

test("the demo club's day, three doors, every plan's list and three answers are there, and none offers a sign-up", async ({ page }, testInfo) => {
  await open(page);
  const demo = page.locator("#demo");
  await expect(demo.getByRole("link", { name: "See a demo club’s day" })).toHaveAttribute("href", "/demo");
  for (const [name, href] of [["The board", "/demo/board"], ["The event page", "/demo/event"], ["The clubhouse screen", "/demo/clubhouse"]]) {
    await expect(demo.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  }
  await expect(demo).toContainText("Everyone can watch: the event page on any phone, the clubhouse screen on the TV in the bar.");

  // The QR is for a laptop: shown wide, and on a phone a plain link takes its place.
  const wide = (page.viewportSize()?.width ?? 0) >= 900;
  if (wide) {
    await expect(demo.locator(".m-qr svg")).toBeVisible();
    expect((await demo.locator(".m-qr path").getAttribute("d"))?.length ?? 0, "the QR has no modules").toBeGreaterThan(500);
  } else {
    await expect(demo.locator(".m-qr")).toBeHidden();
    await expect(demo.getByRole("link", { name: "A player’s card" })).toHaveAttribute("href", "/demo/card");
  }
  testInfo.annotations.push({ type: "qr", description: wide ? "drawn" : "replaced by a link" });

  await expect(page.locator("#for .m-door")).toHaveCount(3);
  expect(await page.locator("#for .m-door").evaluateAll((a) => a.map((x) => x.getAttribute("href")))).toEqual(["/faq#q-league", "/demo", "#pricing"]);

  // Every line of "On every plan" is one plans.ts holds true of every plan (`onEveryPlan`) — named by its key.
  const keys = await page.locator("#every-plan [data-plan-term]").evaluateAll((li) => li.map((x) => x.getAttribute("data-plan-term")));
  expect(keys).toEqual(["publicBoard", "everyFormat", "roundCodes", "offlineCards", "voiceScoring", "sideGames", "playersPayNothing"]);

  const answers = page.locator("#every-plan .m-answer");
  await expect(answers).toHaveCount(3);
  await expect(answers.nth(0)).toContainText("Do players need an app?");
  await expect(answers.nth(1)).toContainText("Does it take entry fees?");
  await expect(answers.nth(1)).toContainText("that is a choice");
  await expect(answers.nth(2)).toContainText("What does a player pay?");
  expect(await answers.locator("a").evaluateAll((a) => a.map((x) => x.getAttribute("href")))).toEqual(["/faq#q-app", "/faq#q-entry-fees", "/faq#q-cost"]);
  // Each one lands on its question: the anchor is there on /faq.
  const faq = await (await page.request.get("/faq")).text();
  for (const id of ["q-app", "q-entry-fees", "q-cost"]) expect(faq, `/faq has no #${id}`).toContain(`id="${id}"`);

  // Nothing new offers a sign-up: the held front door's rule holds for these sections whether held or not.
  for (const id of ["#demo", "#for", "#every-plan"]) {
    expect(await page.locator(`${id} a[href*="signup"]`).count(), `${id} offers a sign-up`).toBe(0);
  }
  // And the words the page is held to: never "only", never "bet", never "cheaper".
  const words = (await page.locator("#demo, #for, #every-plan").allInnerTexts()).join(" ").toLowerCase();
  expect(words).not.toMatch(/\bonly\b|\bbets?\b|\bcheaper\b|\bbetter\b/);
});
