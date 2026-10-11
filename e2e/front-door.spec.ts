import { test, expect, type Page } from "./coverage";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { labelsForTheWrongThing } from "./labels";

/**
 * THE FRONT DOOR, WALKED BY SOMEBODY WHO HAS NEVER BEEN IN (2026-10-11).
 *
 * Every other spec in this suite starts already signed in: a fixture makes a
 * user row and hands the browser a cookie. So the screens a real person meets
 * FIRST — create an account, log in, get the password wrong, forget it, reset
 * it, sign out — had never been operated by a test at all. Ajay, asked what
 * "everything" covers: "including onboarding / login / access control".
 *
 * This is one person doing all of it through the forms, with the database read
 * behind each step:
 *
 *   turned away from the console, and remembered where they were going
 *   tapping the word "Password" puts them in the password box — it used to
 *     open "Reset your password", which is how this spec earned its keep
 *   an empty sign-up says what is missing; a weak password says why
 *   a new account is a person, a club of the kind they chose, and its owner
 *   the cookie they are given carries WHEN they signed in, and is not
 *     readable by a script in the page
 *   signed out, they are turned away again
 *   a wrong password and an unknown address get the SAME sentence
 *   signing up twice is refused and sends them to log in
 *   "forgot password" says the same thing for a real address and a made-up
 *     one, and makes a link only for the real one
 *   the reset link sets the password, signs them in — and ENDS the session
 *     they had before, which is the one thing a reset is for
 *   a `next` that points off the site is not followed
 *   a sixth wrong password in a row is told to wait, account or no account
 */

const prisma = new PrismaClient();
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

const PASSWORD = "four-Putts-then-87-home";
const NEW_PASSWORD = "seven-Iron-over-41-water";

let mark = "";

test.afterAll(async () => {
  try {
    if (mark) {
      const users = await prisma.user.findMany({ where: { email: { startsWith: mark } }, select: { id: true } });
      const owned = await prisma.organizationMember.findMany({
        where: { userId: { in: users.map((u) => u.id) }, role: "owner" },
        select: { organizationId: true },
      });
      await prisma.organization.deleteMany({ where: { id: { in: owned.map((o) => o.organizationId) } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: mark } } });
    }
  } finally {
    await prisma.$disconnect();
  }
});

/**
 * What the form said no with. Not `getByRole("alert")`: the framework keeps an
 * announcer on every page with the same role, and two alerts is no answer.
 */
const refusal = (page: Page) => page.locator('p[role="alert"]:not(#__next-route-announcer__)');

/** The panel on the landing page, in the mode asked for. */
async function panel(page: Page, tab: "Log in" | "Sign up") {
  await page.getByRole("tab", { name: tab, exact: true }).click();
  await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
}

async function logIn(page: Page, email: string, password: string) {
  await panel(page, "Log in");
  await page.getByPlaceholder("you@email.com").fill(email);
  await page.getByPlaceholder("Your password").fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}

test("a new organizer comes in by the front door, and the door closes behind them", async ({ page, context, baseURL, request }, testInfo) => {
  test.setTimeout(180_000);
  // No single step may wait out the whole test: the first run sat three
  // minutes on one button it could not find, three times over.
  page.setDefaultTimeout(15_000);
  mark = `zz-door-${process.pid}-${testInfo.project.name}`;
  const email = `${mark}@example.invalid`;
  const errors: string[] = [];
  watchPageErrors(page, errors, "front door");
  const account = () => prisma.user.findUnique({ where: { email } });
  const path = () => new URL(page.url()).pathname;

  // ── turned away, and remembered ────────────────────────────────────────
  await page.goto("/prizes");
  expect(path(), "a signed-out visitor was let into the console").toBe("/");
  expect(new URL(page.url()).searchParams.get("next")).toBe("/prizes");

  // ── a label is for its box ─────────────────────────────────────────────
  // The whole Password field was one label with "Forgot?" inside it, ahead of
  // the box — so the label belonged to the button, and tapping the word
  // "Password" opened the reset screen (found here, 2026-10-11).
  await panel(page, "Log in");
  expect(await labelsForTheWrongThing(page), "a label on the log-in form belongs to a button").toEqual([]);
  await page.locator('label[for="login-password"]').click();
  await expect(page.getByPlaceholder("Your password")).toBeFocused();
  await expect(page.getByText("We'll email a link to set a new password.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Forgot?", exact: true })).toBeVisible();

  // ── an empty sign-up says what is missing ──────────────────────────────
  await panel(page, "Sign up");
  expect(await labelsForTheWrongThing(page), "a label on the sign-up form belongs to a button").toEqual([]);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(refusal(page)).not.toBeEmpty();
  expect(await account(), "an account was made from an empty form").toBeNull();

  // ── a weak password says why, and makes nothing ────────────────────────
  await page.getByPlaceholder("Full name").fill("Zz Door Walker");
  await page.getByPlaceholder("you@email.com").fill(email);
  await page.getByPlaceholder("Choose a password").fill("1234567890");
  await page.getByText("A society, league or regular group").click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(refusal(page)).toContainText(/keyboard|guess|characters|repeated/i);
  expect(await account(), "an account was made with a password the form refused").toBeNull();

  // ── a real one: a person, their club, and its owner ────────────────────
  await page.getByPlaceholder("Choose a password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((u) => u.pathname !== "/", { timeout: 20_000 });
  expect(path(), "a new organizer did not land on the chooser").toBe("/choose");
  await expect(page.locator("h1")).toHaveCount(1);
  const user = await account();
  expect(user, "signing up made no account").not.toBeNull();
  expect(user!.password, "the password is stored as typed").not.toContain(PASSWORD);
  const membership = await prisma.organizationMember.findMany({ where: { userId: user!.id }, include: { organization: true } });
  expect(membership.map((m) => [m.role, m.organization.kind])).toEqual([["owner", "community"]]);

  // ── the cookie: when they signed in, and not for scripts ───────────────
  const cookie = (await context.cookies()).find((c) => c.name === "ng_session");
  expect(cookie, "no session cookie after signing up").toBeTruthy();
  expect(cookie!.httpOnly, "a script in the page can read the session").toBe(true);
  // Playwright's WebKit build on Windows reports every cookie as "None" —
  // it does not carry SameSite at all — so there the question cannot be asked.
  if (context.browser()?.browserType().name() !== "webkit") expect(cookie!.sameSite).toBe("Lax");
  const held = decodeURIComponent(cookie!.value);
  expect(held, "the session carries no issue time — it is the same value for ever").toMatch(/^[a-z0-9]+~[0-9a-z]+\.[A-Za-z0-9_-]+$/);
  expect(held.startsWith(`${user!.id}~`)).toBe(true);
  const firstSession = cookie!.value;

  // ── signed out, turned away again ──────────────────────────────────────
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 20_000 });
  expect((await context.cookies()).some((c) => c.name === "ng_session"), "signing out left the session cookie in the browser").toBe(false);
  await page.goto("/dashboard");
  expect(path()).toBe("/");

  // ── wrong password and unknown address: one sentence ───────────────────
  await logIn(page, email, "not-the-Password-55-at-all");
  await expect(refusal(page)).toHaveText(/Wrong email or password\./);
  const wrong = await refusal(page).innerText();
  await logIn(page, `${mark}-nobody@example.invalid`, "not-the-Password-55-at-all");
  await expect(refusal(page)).toHaveText(/Wrong email or password\./);
  expect(await refusal(page).innerText(), "the refusal tells an address with an account from one without").toBe(wrong);

  // ── signing up twice ───────────────────────────────────────────────────
  await panel(page, "Sign up");
  await page.getByPlaceholder("Full name").fill("Zz Door Walker");
  await page.getByPlaceholder("you@email.com").fill(email);
  await page.getByPlaceholder("Choose a password").fill(PASSWORD);
  await page.getByText("A society, league or regular group").click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(refusal(page)).toContainText("log in instead");
  expect(await prisma.user.count({ where: { email } })).toBe(1);

  // ── the right password, and a `next` that points off the site ──────────
  await page.goto("/?next=https%3A%2F%2Fexample.invalid%2Fphish");
  await logIn(page, email, PASSWORD);
  await page.waitForURL((u) => u.pathname !== "/", { timeout: 20_000 });
  expect(new URL(page.url()).origin, "signing in followed a link off the site").toBe(new URL(baseURL!).origin);
  expect(path()).toBe("/choose");
  expect(page.url()).not.toContain("example.invalid");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 20_000 });

  // ── forgot: the same words for a real address and a made-up one ────────
  const forgot = async (address: string) => {
    await page.goto("/");
    await panel(page, "Log in");
    await page.getByRole("button", { name: "Forgot?", exact: true }).click();
    expect(await labelsForTheWrongThing(page)).toEqual([]);
    await page.getByPlaceholder("you@email.com").fill(address);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("Check your email")).toBeVisible();
    return (await page.getByText(/reset link is on its way/).innerText()).split(address).join("<address>");
  };
  const saidForReal = await forgot(email);
  const saidForNobody = await forgot(`${mark}-nobody@example.invalid`);
  expect(saidForNobody, "the reset screen tells a registered address from an unregistered one").toBe(saidForReal);
  expect(await prisma.passwordResetToken.count({ where: { userId: user!.id } }), "no reset link was made for a real account").toBe(1);

  // ── the reset link: a new password, a new session, and the old one ended ─
  // The emailed link is the one thing a test cannot read (only its hash is
  // stored), so this is a second link of its own, made the way the app makes one.
  const token = randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: { userId: user!.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
  });
  const stillIn = async (session: string) =>
    (await request.get("/account", { headers: { cookie: `ng_session=${session}` }, maxRedirects: 0 })).status();
  // CONTROL: the session from sign-up is still good before the reset. Signing
  // out removed it from the browser and revoked nothing — which is exactly why
  // a reset has to.
  expect(await stillIn(firstSession), "the earlier session was already dead — the next assertion would prove nothing").toBe(200);

  await page.goto(`/reset-password?token=${token}`);
  expect(await labelsForTheWrongThing(page)).toEqual([]);
  await page.getByPlaceholder(/At least \d+ characters/).fill(NEW_PASSWORD);
  await page.getByPlaceholder("Re-enter password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: /Set password & sign in/ }).click();
  await page.waitForURL((u) => u.pathname === "/choose", { timeout: 20_000 });
  expect(await stillIn(firstSession), "a session from before the reset still opens the account").toBe(307);
  const after = (await context.cookies()).find((c) => c.name === "ng_session");
  expect(after && after.value !== firstSession, "the reset did not start a new session").toBeTruthy();
  expect(await stillIn(after!.value)).toBe(200);
  // The link is spent, and so is the one "forgot" made a moment ago.
  expect(await prisma.passwordResetToken.count({ where: { userId: user!.id, usedAt: null } })).toBe(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 20_000 });
  await page.goto(`/reset-password?token=${token}`);
  await page.getByPlaceholder(/At least \d+ characters/).fill("eight-Birdies-in-33-a-row");
  await page.getByPlaceholder("Re-enter password").fill("eight-Birdies-in-33-a-row");
  await page.getByRole("button", { name: /Set password & sign in/ }).click();
  await expect(page.getByText(/invalid or has expired/)).toBeVisible();

  // The old password is gone, the new one is the password.
  await page.goto("/");
  await logIn(page, email, PASSWORD);
  await expect(refusal(page)).toHaveText(/Wrong email or password\./);
  await logIn(page, email, NEW_PASSWORD);
  await page.waitForURL((u) => u.pathname === "/choose", { timeout: 20_000 });
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 20_000 });

  // ── a sixth wrong password is told to wait — account or no account ─────
  const stranger = `${mark}-locked@example.invalid`;
  let last = "";
  for (let i = 0; i < 6; i++) {
    await logIn(page, stranger, `wrong-Guess-number-${i}-of-six`);
    await expect(refusal(page)).not.toBeEmpty();
    last = await refusal(page).innerText();
  }
  expect(last, "six wrong passwords in a row were all answered the same").not.toMatch(/Wrong email or password/);
  expect(last).toMatch(/try again|too many|wait/i);
  expect(await prisma.user.count({ where: { email: stranger } })).toBe(0);

  expect(errors, "a screen threw in the browser").toEqual([]);
});
