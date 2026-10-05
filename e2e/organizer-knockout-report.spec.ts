import { test, expect, type Page, type Browser, type TestInfo } from "@playwright/test";
import { seedOrganizer, teardownOrganizer, medalEmail, memberSession } from "./organizer-fixture.mjs";

/**
 * A PLAYER REPORTS THEIR OWN KNOCKOUT TIE, AND THE COMMITTEE APPROVES IT.
 *
 * Ajay's rule of 2026-09-28: "player may enter it but organizer/club needs to
 * approve it". So a report is a REQUEST — it moves nothing on the draw until
 * the organizer says so — and both players can see it is waiting.
 *
 *   draw        seeded on handicap: Alder (1) v Dune (4), Briar (2) v Cedar (3)
 *   Dune        reports from his phone: "I won", 2&1
 *   Alder       sees the report waiting on his own phone
 *   organizer   sees "A result to approve", the draw not yet moved, approves
 *   draw        the semi holds 2&1 and Dune's next tie is the final
 */

type Entrant = { name: string; index: string };
// Entry order, not seed order; Dune is entered first so his address is medalEmail(0).
const FIELD: Entrant[] = [
  { name: "Dune Quayle", index: "20" },
  { name: "Briar Quayle", index: "8" },
  { name: "Cedar Quayle", index: "14" },
  { name: "Alder Quayle", index: "0" },
];
const TOURNAMENT = "Club Knockout — Players Report";

test.beforeAll(async () => {
  const { session } = await seedOrganizer();
  process.env.ORGANIZER_SESSION = session;
});
test.afterAll(async () => {
  await teardownOrganizer();
});

async function open(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
}

/** A player's own phone, signed in as them. */
async function phoneOf(browser: Browser, testInfo: TestInfo, baseURL: string, name: string) {
  const i = FIELD.findIndex((p) => p.name === name);
  const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
  await ctx.addCookies([{ name: "ng_session", value: await memberSession(medalEmail(i), name), url: baseURL }]);
  return ctx;
}

test("a player reports their knockout tie; the organizer approves it and the draw moves", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(360_000);
  await page.context().addCookies([{ name: "ng_session", value: process.env.ORGANIZER_SESSION!, url: baseURL! }]);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));

  await test.step("a four-player knockout, launched", async () => {
    await open(page, "/choose");
    await page.getByLabel("Tournament name").fill(TOURNAMENT);
    await page.getByRole("button", { name: /^A knockout/ }).click();
    await page.getByRole("button", { name: "Create tournament" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });

    await open(page, "/event");
    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel("Tournament dates, first day").fill(today);
    await page.getByLabel("Tournament dates, last day").fill(today);
    await page.getByRole("button", { name: "Save event" }).click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 20_000 });

    await open(page, "/registration");
    for (const [i, p] of FIELD.entries()) {
      await page.getByLabel("Player name", { exact: true }).fill(p.name);
      await page.getByRole("textbox", { name: /^Email · required/ }).fill(medalEmail(i));
      await page.getByRole("textbox", { name: /^Mobile · required/ }).fill(`555080${i}`);
      await page.getByLabel("Handicap", { exact: true }).fill(p.index);
      await page.getByRole("button", { name: "Add to field" }).click();
      await expect(page.getByText(p.name).first()).toBeVisible({ timeout: 20_000 });
    }

    await open(page, "/stages");
    await page.getByRole("button", { name: /^Bracket/ }).click();
    await page.getByLabel("Format for every round added").selectOption("Match Play");
    await page.getByRole("button", { name: /^Add bracket/ }).click();
    await expect(page.getByRole("button", { name: /^Round 1 · Bracket Stage/ })).toBeVisible({ timeout: 20_000 });

    await open(page, "/dashboard");
    for (const step of ["Start taking entries", "Mark ready"]) {
      await page.getByRole("button", { name: step }).click();
      await expect(page.getByRole("button", { name: step })).toHaveCount(0, { timeout: 20_000 });
    }
    await page.getByRole("button", { name: "Launch tournament" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Launch tournament" }).click();
    await expect(page.getByRole("button", { name: "Complete tournament" })).toBeVisible({ timeout: 30_000 });
  });

  const duneCtx = await phoneOf(browser, testInfo, baseURL!, "Dune Quayle");
  const alderCtx = await phoneOf(browser, testInfo, baseURL!, "Alder Quayle");
  const dune = await duneCtx.newPage();
  const alder = await alderCtx.newPage();
  dune.on("pageerror", (e) => errors.push(`dune ${new URL(dune.url()).pathname}: ${String(e)}`));
  alder.on("pageerror", (e) => errors.push(`alder ${new URL(alder.url()).pathname}: ${String(e)}`));

  try {
    await test.step("Dune reports beating the top seed, 2&1", async () => {
      await open(dune, "/me");
      await expect(dune.getByText("Semifinal v Alder Quayle")).toBeVisible({ timeout: 20_000 });
      await dune.getByRole("button", { name: "Report the result" }).click();
      await dune.getByRole("radio", { name: "I won" }).check();
      await dune.getByLabel("By how much (optional)").fill("2&1");
      await dune.getByRole("button", { name: /^Send to the organi[sz]er/ }).click();
      await expect(dune.getByText(/You won 2&1 — you reported it\. Waiting for the organi[sz]er to approve it\./)).toBeVisible({ timeout: 20_000 });
    });

    await test.step("Alder sees the report waiting, on his own phone", async () => {
      await open(alder, "/me");
      await expect(alder.getByText(/Dune Quayle won 2&1 — Dune Quayle reported it\. Waiting for the organi[sz]er/)).toBeVisible({ timeout: 20_000 });
    });

    await test.step("the organizer sees it, the draw not yet moved, and approves", async () => {
      await open(page, "/bracket");
      await expect(page.getByText("A result to approve")).toBeVisible();
      await expect(page.getByText(/Alder Quayle v Dune Quayle: Dune Quayle won 2&1/)).toBeVisible();
      await expect(page.getByText("Reported by Dune Quayle")).toBeVisible();
      // A report is a request: no result is on the draw yet.
      await expect(page.getByRole("textbox", { name: /^Result of Alder Quayle v Dune Quayle/ })).toHaveCount(0);

      await page.getByRole("button", { name: /^Approve: Dune Quayle won Alder Quayle v Dune Quayle/ }).click();
      await expect(page.getByText("A result to approve")).toHaveCount(0, { timeout: 20_000 });
      await expect(async () => {
        await open(page, "/bracket");
        await expect(page.getByRole("textbox", { name: /^Result of Alder Quayle v Dune Quayle, Semifinals$/ })).toHaveValue("2&1");
      }).toPass({ timeout: 20_000 });
    });

    await test.step("Dune's next tie is the final", async () => {
      await open(dune, "/me");
      await expect(dune.getByText(/Final v the winner of Briar Quayle v Cedar Quayle/)).toBeVisible({ timeout: 20_000 });
    });
  } finally {
    await duneCtx.close();
    await alderCtx.close();
  }
  expect(errors, "a screen threw").toEqual([]);
});
