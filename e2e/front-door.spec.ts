import { test, expect, type Page } from "./coverage";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { labelsForTheWrongThing } from "./labels";
import { landingSettled } from "./landing-settled";
import { RATE_LIMITS } from "../src/lib/domain/rate-limit";

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

/**
 * The panel on the landing page, in the mode asked for.
 *
 * ONCE THE PAGE HAS STOPPED MOVING. The sign-in box is at the bottom of the
 * front door, below the story of a round — which becomes two and a half to
 * three and a half thousand pixels taller when the page's script starts
 * (`landing-settled.ts`). This spec pressed its way through the box in the half
 * second after arriving; on Firefox, once in about seventeen runs, the page
 * grew between the press being aimed and being made, "Send reset link" was
 * pressed where it had been, and no request left the browser (round 2 on the
 * second batch, 2026-10-13). A person does not press a button 800ms after a
 * page appears. A person who is ALREADY at the box when the page grows keeps
 * their place: measured the same day on Chrome's engine and on Safari's, the
 * box stays where it was on the screen. (The first version of this note said
 * Safari left them in the pricing. That was assumed, and was wrong.)
 */
/**
 * THE RESET FORM PUTS THE CURSOR IN ITS FIRST BOX WHEN IT ARRIVES, and a test
 * that types before it has done so types in the wrong box.
 *
 * One round stopped here on Safari's engine (2026-10-13): the second box was
 * filled about 150ms after the page loaded, the cursor was pulled back to the
 * first box in that instant, and both passwords went into it — the failed run's
 * own screenshot shows fifty dots in "New password", nothing in "Confirm", and
 * the button rightly grey. Three theories about the app losing what was typed
 * were tested first and none reproduced it (300 attempts); typing at a
 * person's speed, in the second box, while the page came alive, kept every
 * character where it was typed. Nobody reaches the second box in a sixth of a
 * second, so this is the test's to wait for, and it waits for the thing itself.
 */
async function cursorIsInTheFirstBox(page: Page) {
  await expect(page.getByPlaceholder(/At least \d+ characters/), "the reset form did not put the cursor in its first box").toBeFocused();
}

async function panel(page: Page, tab: "Log in" | "Sign up") {
  await landingSettled(page);
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
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 20_000 });
  expect((await context.cookies()).some((c) => c.name === "ng_session"), "signing out left the session cookie in the browser").toBe(false);
  await page.goto("/dashboard");
  expect(path()).toBe("/");

  // ── wrong password and unknown address: one sentence ───────────────────
  // Each answer waits on a password hash, which is slow on purpose and slower on a
  // busy machine with the page's animation running: the motion layer of a full
  // run saw "Creating account…" still pressed at five seconds (2026-10-14). The
  // refusal is checked when it comes, not at the default five.
  const ANSWER = { timeout: 20_000 };
  await logIn(page, email, "not-the-Password-55-at-all");
  await expect(refusal(page)).toHaveText(/Wrong email or password\./, ANSWER);
  const wrong = await refusal(page).innerText();
  await logIn(page, `${mark}-nobody@example.invalid`, "not-the-Password-55-at-all");
  await expect(refusal(page)).toHaveText(/Wrong email or password\./, ANSWER);
  expect(await refusal(page).innerText(), "the refusal tells an address with an account from one without").toBe(wrong);

  // ── signing up twice ───────────────────────────────────────────────────
  await panel(page, "Sign up");
  await page.getByPlaceholder("Full name").fill("Zz Door Walker");
  await page.getByPlaceholder("you@email.com").fill(email);
  await page.getByPlaceholder("Choose a password").fill(PASSWORD);
  await page.getByText("A society, league or regular group").click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(refusal(page)).toContainText("log in instead", ANSWER);
  expect(await prisma.user.count({ where: { email } })).toBe(1);

  // ── the right password, and a `next` that points off the site ──────────
  await page.goto("/?next=https%3A%2F%2Fexample.invalid%2Fphish");
  await logIn(page, email, PASSWORD);
  await page.waitForURL((u) => u.pathname !== "/", { timeout: 20_000 });
  expect(new URL(page.url()).origin, "signing in followed a link off the site").toBe(new URL(baseURL!).origin);
  expect(path()).toBe("/choose");
  expect(page.url()).not.toContain("example.invalid");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 20_000 });

  // ── forgot: the same words for a real address and a made-up one ────────
  const forgot = async (address: string) => {
    await page.goto("/");
    await panel(page, "Log in");
    await page.getByRole("button", { name: "Forgot?", exact: true }).click();
    expect(await labelsForTheWrongThing(page)).toEqual([]);
    await page.getByPlaceholder("you@email.com").fill(address);
    await page.getByRole("button", { name: "Send reset link" }).click();
    // THIS SERVER HAS NO WAY TO SEND MAIL, and since 2026-10-11 the screen says
    // so. It used to say "Check your email … a reset link is on its way" here,
    // to somebody who would wait for a message that could not come — and this
    // spec pinned that sentence, which is how it stayed. The sending case is
    // held in `forgot-password-says-what-happened.audit.test.ts`.
    await expect(page.getByText("We can’t email a reset link")).toBeVisible();
    await expect(page.getByText("Check your email")).toHaveCount(0);
    return (await page.getByText(/no reset link was sent/).innerText()).split(address).join("<address>");
  };
  const saidForReal = await forgot(email);
  const saidForNobody = await forgot(`${mark}-nobody@example.invalid`);
  expect(saidForNobody, "the reset screen tells a registered address from an unregistered one").toBe(saidForReal);
  expect(saidForReal, "the screen does not say who to write to").toContain("support@tourneyhq.club");
  expect(
    await prisma.passwordResetToken.count({ where: { userId: user!.id } }),
    "a reset link was made that this server can never send",
  ).toBe(0);

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
  await cursorIsInTheFirstBox(page);
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
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 20_000 });
  await page.goto(`/reset-password?token=${token}`);
  await cursorIsInTheFirstBox(page);
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
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 20_000 });

  // ── a sixth wrong password is told to wait — account or no account ─────
  const stranger = `${mark}-locked@example.invalid`;
  /**
   * THE SIX START WITH ROOM TO FINISH IN ONE COUNTING WINDOW.
   *
   * The limiter counts in fixed quarter-hours on the server clock, which here is
   * this machine. On 2026-10-12 this step ran across 03:00: two attempts fell in
   * the window that was ending and four in the next, none of them was a sixth, and
   * every one was answered "Wrong email or password." The limiter was right (its
   * own rows said 2 and 4) and the round was lost to the minute it ran in. It
   * would have failed on any commit, at one start time in about sixty.
   *
   * Waiting out the end of a window keeps the assertion exact: six in ONE window,
   * the sixth refused. Trying more times until something is refused would also
   * pass a limiter set to ten.
   */
  const { limit, windowMs } = RATE_LIMITS.signin;
  const leftInWindow = windowMs - (Date.now() % windowMs);
  if (leftInWindow < 45_000) {
    testInfo.setTimeout(testInfo.timeout + leftInWindow + 5_000);
    await page.waitForTimeout(leftInWindow + 1_500);
  }
  let last = "";
  for (let i = 0; i < limit + 1; i++) {
    await logIn(page, stranger, `wrong-Guess-number-${i}-of-six`);
    await expect(refusal(page)).not.toBeEmpty();
    last = await refusal(page).innerText();
  }
  expect(last, "six wrong passwords in a row were all answered the same").not.toMatch(/Wrong email or password/);
  expect(last).toMatch(/try again|too many|wait/i);
  expect(await prisma.user.count({ where: { email: stranger } })).toBe(0);

  expect(errors, "a screen threw in the browser").toEqual([]);
});
