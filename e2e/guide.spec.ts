import { test, expect } from "./coverage";
import { join } from "node:path";
import { watchPageErrors } from "./page-errors";

test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

/**
 * THE ORGANIZER'S GUIDE, OPENED AND USED.
 *
 * The guide is the app's help: Ajay chose written help over a help bot, and
 * "Help and docs travel with the change" keeps its words true. Unit tests hold
 * the words — a button it names must be on a screen, a search result must
 * have somewhere to jump. None of that opens it.
 *
 * The first measured round (2026-10-13) listed three screens no browser test
 * had ever opened. Two only pass a visitor on to another screen. The third was
 * this one: the page an organizer who is stuck goes to had never once been
 * drawn in a test, on any size of screen.
 *
 * So, as somebody stuck would use it:
 *
 *   it opens, with its heading, and steps to read
 *   a word is searched    → results, each a link
 *   a result is pressed   → the page is AT that step, on screen
 *   nonsense is searched  → it says nothing matches, in words
 *   the PDF it offers     → is there, and is a PDF
 *
 * WHAT IT CANNOT SEE: whether what the guide says is true. That is the unit
 * tests' half (`guide-steps.test.ts`) and, for a flow that changed under the
 * same button names, a person's.
 */
test("an organizer opens the guide, searches it, jumps to a step, and is offered the PDF", async ({ page, request }) => {
  const errors: string[] = [];
  watchPageErrors(page, errors);
  await page.goto(`/guide/steps?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  expect(new URL(page.url()).pathname, "sent away from the guide — not signed in?").toBe("/guide/steps");
  await expect(page.locator("h1")).toHaveCount(1);
  // CONTROL: it is the guide, with steps in it — not an empty frame with a search box.
  expect(await page.locator("main h2, main h3").count(), "the guide has no steps in it").toBeGreaterThan(10);

  const search = page.getByLabel("Search the guide");
  const results = page.getByRole("status").getByRole("link");
  await expect(results, "CONTROL: results are listed before anything was searched").toHaveCount(0);

  await search.fill("cut");
  await expect(results.first(), "searching the guide for 'cut' finds nothing").toBeVisible();
  const found = await results.count();
  expect(found).toBeGreaterThan(0);
  // Every result goes somewhere that is on this page.
  for (const href of await results.evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""))) {
    expect(href.startsWith("#"), `a result leads off the guide: ${href}`).toBe(true);
    expect(await page.locator(`[id="${href.slice(1)}"]`).count(), `a result points at ${href}, which is not on the page`).toBe(1);
  }

  // Pressing one puts that step on the screen.
  const first = results.first();
  const anchor = ((await first.getAttribute("href")) ?? "").slice(1);
  await first.click();
  await expect.poll(() => new URL(page.url()).hash, { message: "pressing a result did not move the page" }).toBe(`#${anchor}`);
  await expect(page.locator(`[id="${anchor}"]`), "the step a result leads to is not on screen after pressing it").toBeInViewport({ timeout: 10_000 });

  // Nothing found is said in words, with what was typed.
  await search.fill("zzqqxx");
  await expect(page.getByRole("status")).toContainText("Nothing in the guide matches");
  await expect(page.getByRole("status")).toContainText("zzqqxx");
  await expect(results).toHaveCount(0);
  // One letter is not a search.
  await search.fill("c");
  await expect(results).toHaveCount(0);

  // The PDF it offers exists and is one.
  const pdf = page.getByRole("link", { name: /Download PDF/ });
  await expect(pdf).toBeVisible();
  const href = (await pdf.getAttribute("href")) ?? "";
  const file = await request.get(href);
  expect(file.status(), `the guide offers ${href}, which is not there`).toBe(200);
  expect(file.headers()["content-type"] ?? "", "the guide's PDF is not served as a PDF").toContain("pdf");
  expect((await file.body()).subarray(0, 5).toString("latin1"), "the file the guide offers is not a PDF").toBe("%PDF-");

  expect(errors, "the guide threw").toEqual([]);
});
