import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * THE BOT CHECK CANNOT SHUT THE FRONT DOOR.
 *
 * Creating an account is checked by a script from a bot-check service, and the
 * way that check is built it holds a request back until its script has
 * answered. Until 2026-10-13 it held EVERY request the landing page makes —
 * signing in, a reset link, a first password — though only sign-up is checked.
 * So, measured in a browser that night:
 *
 *   the script blocked (a content blocker)   Log in, or Send reset link, replaced
 *                                            the whole page with "Something went
 *                                            wrong — This screen didn't load"
 *   the script never answered                "Sending…", for ever, nothing sent
 *
 * It was found by a full round on GitHub, where one press in several hundred
 * sat on "Sending…": the recording showed the script's request unanswered and
 * the reset request never made.
 *
 * So this walks the front door three times, with the script as a person might
 * have it. In each, one account is made, signed out of, signed back into, and
 * a reset link is asked for — and what was SENT is counted, because the fix
 * could fail the other way and send a sign-up twice.
 *
 *   BLOCKED    everything works; nothing waits; the sign-up goes once, unchecked
 *   STALLED    signing in and the reset link do not wait at all; the sign-up
 *              waits its few seconds, then goes once, unchecked
 *   ANSWERING  the sign-up goes once WITH the check's word on it (the control:
 *              the check is still wired); signing in never asks for the script
 *
 * The script is answered HERE in the third case, not by the service: a test
 * that reaches a service outside the building fails when the service blinks,
 * which is the fault this file is about.
 *
 * WHAT IT CANNOT SEE: what the real service makes of a real browser. Off
 * Vercel the server does not ask it at all (`services/bot-check.ts`).
 */

// No service worker here: once the page has one, its requests are made by the worker, and on
// Safari's engine a request the worker makes cannot be stopped by a test — the script this file
// blocks arrived all the same, and the "blocked" walk was a walk with nothing blocked.
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: "block" });

const prisma = new PrismaClient();
const PASSWORD = "four-Putts-then-87-home";
const SCRIPT = "**/149e9513-**";
let mark = "";

test.afterAll(async () => {
  try {
    if (mark) {
      const users = await prisma.user.findMany({ where: { email: { startsWith: mark } }, select: { id: true } });
      const owned = await prisma.organizationMember.findMany({ where: { userId: { in: users.map((u) => u.id) }, role: "owner" }, select: { organizationId: true } });
      await prisma.organization.deleteMany({ where: { id: { in: owned.map((o) => o.organizationId) } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: mark } } });
    }
  } finally {
    await prisma.$disconnect();
  }
});

async function panel(page: Page, tab: "Log in" | "Sign up") {
  await page.getByRole("tab", { name: tab, exact: true }).click();
  await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
}

for (const script of ["blocked", "stalled", "answering"] as const) {
  test(`with the bot-check script ${script}, a person can still sign up, sign in and ask for a reset link`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(15_000);
    mark = `zz-botdoor-${process.pid}`;
    const email = `${mark}-${script}-${testInfo.project.name}@example.invalid`;
    const errors: string[] = [];
    watchPageErrors(page, errors, script);

    /** Every request the landing page's forms made, and whether it carried the check's word. */
    const sent: string[] = [];
    let askedForScript = 0;
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (r.method() === "POST" && url.pathname === "/") sent.push(r.headers()["x-is-human"] ? "checked" : "plain");
      if (url.pathname.startsWith("/149e9513-")) askedForScript += 1;
    });
    if (script === "blocked") await page.route(SCRIPT, (r) => r.abort());
    if (script === "stalled") await page.route(SCRIPT, () => new Promise(() => {}));
    // What the service's script does when it is content: hands the page its word.
    if (script === "answering") {
      await page.route(SCRIPT, (r) => r.fulfill({ contentType: "application/javascript", body: "window.V_C.push({ b: 1, d: 0, from: 'the test' });" }));
    }
    const noErrorScreen = async (after: string) =>
      expect(page.getByText("This screen didn’t load"), `${after} replaced the front door with an error screen`).toHaveCount(0);

    // ── sign up: the one request the check is for ──────────────────────────
    await page.goto("/");
    await panel(page, "Sign up");
    await page.getByPlaceholder("Full name").fill("Zz Bot Door");
    await page.getByPlaceholder("you@email.com").fill(email);
    await page.getByPlaceholder("Choose a password").fill(PASSWORD);
    await page.getByText("A society, league or regular group").click();
    const pressed = Date.now();
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL((u) => u.pathname === "/choose", { timeout: 30_000 }).catch(() => {});
    await noErrorScreen("signing up");
    expect(new URL(page.url()).pathname, `signing up went nowhere with the script ${script}`).toBe("/choose");
    expect(await prisma.user.count({ where: { email } }), "the account was made more or fewer times than once").toBe(1);
    expect(sent, "the sign-up was sent more or fewer times than once, or with the wrong word on it").toEqual([script === "answering" ? "checked" : "plain"]);
    expect(askedForScript, "CONTROL: the sign-up never asked for the check at all").toBeGreaterThan(0);
    if (script === "stalled") expect(Date.now() - pressed, "CONTROL: a sign-up did not wait for a check that was still coming").toBeGreaterThan(5_000);

    // ── sign out, and back in: no check, no waiting ────────────────────────
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/", { timeout: 20_000 });
    await page.goto("/");
    sent.length = 0;
    askedForScript = 0;
    await panel(page, "Log in");
    await page.getByPlaceholder("you@email.com").fill(email);
    await page.getByPlaceholder("Your password").fill(PASSWORD);
    const signingIn = Date.now();
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/choose", { timeout: 5_000 }).catch(() => {});
    await noErrorScreen("signing in");
    expect(new URL(page.url()).pathname, `signing in did not get in within five seconds with the script ${script} (${Date.now() - signingIn}ms)`).toBe("/choose");
    expect(sent, "signing in was held for the check, or sent twice").toEqual(["plain"]);
    expect(askedForScript, "signing in asked for the bot-check script, which it has no use for").toBe(0);

    // ── a reset link ───────────────────────────────────────────────────────
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/", { timeout: 20_000 });
    await page.goto("/");
    sent.length = 0;
    await panel(page, "Log in");
    await page.getByRole("button", { name: "Forgot?", exact: true }).click();
    await page.getByPlaceholder("you@email.com").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("We can’t email a reset link"), `a reset link was not answered with the script ${script}`).toBeVisible({ timeout: 5_000 });
    await noErrorScreen("asking for a reset link");
    expect(sent).toEqual(["plain"]);
    expect(askedForScript).toBe(0);

    expect(errors, "a screen threw").toEqual([]);
  });
}
