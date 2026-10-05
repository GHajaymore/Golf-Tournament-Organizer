import { test, expect, type Page } from "@playwright/test";
import { seedOrganizer, teardownOrganizer, medalEmail, MEDAL_PARS, MEDAL_COURSE } from "./organizer-fixture.mjs";

/**
 * A MEMBER ENTERS THE CLUB'S COMPETITION FROM THE LINK, AND SCORES THEIR OWN
 * CARD ON THEIR PHONE.
 *
 * Every other walk starts with the field already in. This is how a member
 * actually gets into it: the secretary publishes the sign-up link and sends it
 * round; a member who has never used the app opens it, enters with their
 * index, signs in for the first time with the address they entered with
 * (their first sign-in sets the password), and on the day keeps their own card.
 *
 *   organizer   a one-round medal, the sign-up link published
 *   member      enters on the link with NO account → "You're in!"
 *               → "Sign in to see your entry" → sets a password → their page
 *   organizer   launches
 *   member      scores the round hole by hole — par everywhere, a birdie on
 *               the 5th — and certifies it
 *   both        the leaderboard has them on 71, and so does their own board
 *
 * The receipt used to stop at "Use this email to sign in." with no way to do
 * it, on a page with no navigation (fixed with this spec, 2026-10-04).
 */

const MEMBER = "Fern Quayle";
const MEMBER_EMAIL = medalEmail(0);
// A test value for this app only, generated here — see CLAUDE.md on fixtures.
const MEMBER_PASSWORD = "Bunker-Rake-7th-Green!";
const TOURNAMENT = "Captain's Prize — Open Entry";
const BIRDIE_ON = 5;

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

test("a member enters from the link, signs in, and scores their own card", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(360_000);
  await page.context().addCookies([{ name: "ng_session", value: process.env.ORGANIZER_SESSION!, url: baseURL! }]);
  const errors: string[] = [];
  // With the page it came from: "a screen threw" is no use without which one.
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));

  // The member's own phone: nobody signed in.
  const memberCtx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
  const member = await memberCtx.newPage();
  member.on("pageerror", (e) => errors.push(`member ${new URL(member.url()).pathname}: ${String(e)}`));

  try {
    let link = "";
    await test.step("organizer: a one-round medal with the sign-up link published", async () => {
      await open(page, "/choose");
      await page.getByLabel("Tournament name").fill(TOURNAMENT);
      await page.getByRole("button", { name: /^A single round/ }).click();
      await page.getByRole("button", { name: "Create tournament" }).click();
      await page.waitForURL(/\/dashboard/, { timeout: 60_000 });

      await open(page, "/event");
      const today = new Date().toISOString().slice(0, 10);
      await page.getByLabel("Tournament dates, first day").fill(today);
      await page.getByLabel("Tournament dates, last day").fill(today);
      const course = page.getByRole("combobox", { name: "Golf course" });
      await course.click();
      await course.fill("Kingsbarn Heath");
      await page.locator('#course-picker-list [role="option"]', { hasText: "Dayton" }).first().click();
      await page.locator("button.btn-primary", { hasText: /Save event|Adding the course/ }).click();
      await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(course).toHaveValue(MEDAL_COURSE);

      await open(page, "/stages");
      await page.getByRole("button", { name: /^Stroke play round/ }).click();
      await page.getByLabel("Format for every round added").selectOption("Stroke Play");
      await page.getByRole("button", { name: /^Add stroke play round/ }).click();
      await expect(page.getByRole("button", { name: /^Round 1 · Stroke Play Round/ })).toBeVisible({ timeout: 20_000 });

      await open(page, "/registration");
      await page.getByRole("button", { name: /Let players sign themselves up/ }).click();
      await page.getByRole("button", { name: "Publish the link" }).click();
      await expect(page.getByRole("button", { name: "Take the link down" })).toBeVisible({ timeout: 20_000 });
      // The read-only box beside "Copy link" holds the address to send round.
      link = await page.locator("input").evaluateAll((els) =>
        (els as HTMLInputElement[]).map((e) => e.value).find((v) => v.includes("/register/")) ?? "",
      );
      expect(link, "no sign-up link is shown").toMatch(/\/register\//);
    });

    await test.step("member: enters on the link, with no account", async () => {
      await member.goto(new URL(link).pathname);
      await member.getByLabel("Your name").fill(MEMBER);
      await member.getByLabel("Email").fill(MEMBER_EMAIL);
      await member.getByLabel("Handicap index").fill("12");
      await member.getByLabel(/^Mobile/).fill("5550500");
      await member.getByRole("button", { name: "Register" }).click();
      await expect(member.getByRole("heading", { name: "You're in!" })).toBeVisible({ timeout: 20_000 });
    });

    await test.step("member: the receipt leads to the sign-in; the first one sets a password", async () => {
      await member.getByRole("link", { name: "Sign in to see your entry" }).click();
      // The home page opens its panel on sign-up and turns to log-in from the
      // link's #signin once it has loaded — typed before that, the email went
      // into the form that was then replaced. A person waits for the page.
      await expect(member.getByRole("heading", { name: "Welcome back" })).toBeVisible({ timeout: 20_000 });
      await member.waitForLoadState("networkidle");
      await member.getByPlaceholder("you@email.com").locator("visible=true").first().fill(MEMBER_EMAIL);
      await member.getByPlaceholder("Your password").locator("visible=true").first().fill(MEMBER_PASSWORD);
      await member.locator('button[type="submit"]', { hasText: "Log in" }).locator("visible=true").first().click();
      await expect(member.getByText("Set your password")).toBeVisible({ timeout: 20_000 });
      await member.getByPlaceholder("Choose a password").fill(MEMBER_PASSWORD);
      await member.getByRole("button", { name: "Set password & continue" }).click();
      await member.waitForURL((u) => !u.pathname.startsWith("/choose") && u.pathname !== "/", { timeout: 30_000 });
      await expect(member.locator("body")).toContainText(TOURNAMENT);
    });

    await test.step("organizer: launch", async () => {
      await open(page, "/dashboard");
      for (const step of ["Start taking entries", "Mark ready"]) {
        const b = page.getByRole("button", { name: step });
        if (await b.count()) {
          await b.click();
          await expect(b).toHaveCount(0, { timeout: 20_000 });
        }
      }
      await page.getByRole("button", { name: "Launch tournament" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Launch tournament" }).click();
      await expect(page.getByRole("button", { name: "Complete tournament" })).toBeVisible({ timeout: 30_000 });
    });

    await test.step("member: keeps their own card, hole by hole, and certifies it", async () => {
      await open(member, "/me/card");
      for (let hole = 1; hole <= 18; hole += 1) {
        await expect(member.getByLabel(`Strokes on hole ${hole}`)).toBeVisible({ timeout: 20_000 });
        await member.getByRole("button", { name: hole === BIRDIE_ON ? /Birdie$/ : /Par$/ }).click();
      }
      await expect(member.getByText(/18 of 18 holes in/)).toBeVisible({ timeout: 30_000 });
      await member.getByRole("button", { name: /Certify my card/ }).click();
      await expect(member.getByRole("button", { name: /Certified/ })).toBeVisible({ timeout: 20_000 });
    });

    const PAR = MEDAL_PARS.reduce((a: number, b: number) => a + b, 0);
    await test.step("both: the boards have them on 71", async () => {
      await open(page, "/leaderboard");
      const board = await page.locator("main").innerText();
      expect(board, `the organizer's board does not show the member's card:\n${board}`)
        .toMatch(new RegExp(`${MEMBER}\\s+18\\s+${PAR - 1}\\b`));

      await open(member, "/me/board");
      const own = await member.locator("main").innerText();
      // The player's board reads like a tour board — place, name, F for
      // finished, score to par — so 71 on a par 72 is "−1".
      expect(own, `the member's own board does not show their round:\n${own}`)
        .toMatch(new RegExp(`1\\s+${MEMBER}\\s+F\\s+[-−]1\\b`));
    });
  } finally {
    await memberCtx.close();
  }
  expect(errors, "a screen threw").toEqual([]);
});
