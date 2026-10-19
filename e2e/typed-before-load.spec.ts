import { test, expect, type Page } from "./coverage";
import { landingSettled } from "./landing-settled";

/**
 * WHAT SOMEBODY TYPES BEFORE THE PAGE HAS FINISHED LOADING IS TAKEN (2026-10-11).
 *
 * A screen is drawn by the server and is on the phone before its script is.
 * On the course, on one bar of signal, that gap is seconds — long enough to
 * type an eight-letter round code. The box showed every letter, and the
 * Continue button stayed grey for ever: the page's own record of the box was
 * still empty, and nothing ever told it otherwise. The same on the sign-up
 * form — a name and an address on the screen, and "Enter your name".
 *
 * Found on WebKit, where three round-code specs typed faster than the page
 * started; measured on Chromium with the script held back, where it does
 * exactly the same. It is not an engine's fault. Every spec in the suite types
 * into a page that has long since loaded, on a machine where the server is
 * next door.
 *
 * So here the script is HELD BACK three seconds, and the typing is done while
 * it is away — with real key presses, the way a thumb does it.
 */

/** Every script of the app arrives late. */
async function onASlowConnection(page: Page, ms = 3000) {
  await page.route("**/_next/static/**/*.js", async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

/** The page is live: its script has arrived and taken the screen over. */
async function live(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
}

test.describe("typed while the page was still loading", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "one phone is enough: this is about time, not width");
  });

  test("a round code is taken, and Continue wakes up", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 393, height: 727 } });
    const page = await ctx.newPage();
    try {
      await onASlowConnection(page);
      await page.goto("/play", { waitUntil: "commit" });
      const box = page.getByLabel("Round code");
      await box.waitFor({ timeout: 15_000 });
      await box.pressSequentially("ZZQX7M3P", { delay: 40 });
      // CONTROL: it really was typed before the page was live — the button is
      // still asleep, as it is on any page whose script has not arrived.
      await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();

      await live(page);
      await expect(box).toHaveValue(/ZZQX.?7M3P/);
      await expect(page.getByRole("button", { name: "Continue" }), "the code is in the box and the page does not know it").toBeEnabled();
      // And it is the code that was typed that goes: a made-up one is refused in words.
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText(/That code isn.t valid/)).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx.close();
    }
  });

  test("a name and an address on the sign-up form are taken", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 393, height: 727 } });
    const page = await ctx.newPage();
    try {
      await onASlowConnection(page);
      await page.goto("/", { waitUntil: "commit" });
      const name = page.getByPlaceholder("Full name");
      await name.waitFor({ timeout: 15_000 });
      await name.pressSequentially("Zz Early Typer", { delay: 20 });
      await page.getByPlaceholder("you@email.com").pressSequentially("zz-early-typer@example.invalid", { delay: 10 });

      await live(page);
      await expect(name).toHaveValue("Zz Early Typer");
      // The front door grows by thousands of pixels once its script is running
      // (CLAUDE.md), and a press made while it grows lands where the button
      // was: round G156 (Firefox, 2026-10-19) pressed Create account and got
      // no answer at all. Pressed once the page has its full height.
      await landingSettled(page);
      // Nothing else filled in, so the form must refuse — and what it asks for
      // tells us what it believes it already has.
      await page.getByRole("button", { name: "Create account" }).click();
      const refusal = page.locator('p[role="alert"]:not(#__next-route-announcer__)');
      await expect(refusal).not.toBeEmpty();
      const said = (await refusal.innerText()).toLowerCase();
      expect(said, "the form asked for a name that is on the screen").not.toMatch(/\bname\b/);
      expect(said, "the form asked for an address that is on the screen").not.toMatch(/\bemail\b/);
    } finally {
      await ctx.close();
    }
  });

  test("CONTROL: a box nobody touched is left exactly as the page drew it", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 393, height: 727 } });
    const page = await ctx.newPage();
    try {
      await onASlowConnection(page, 1500);
      await page.goto("/play", { waitUntil: "commit" });
      await live(page);
      await expect(page.getByLabel("Round code")).toHaveValue("");
      await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
      // And typing AFTER the page is live works as it always did, once.
      await page.getByLabel("Round code").pressSequentially("ZZQX7M3P", { delay: 20 });
      await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
      await expect(page.getByLabel("Round code")).toHaveValue(/^ZZQX.?7M3P$/);
    } finally {
      await ctx.close();
    }
  });
});
