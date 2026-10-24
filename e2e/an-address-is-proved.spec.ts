import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { landingSettled } from "./landing-settled";
import { KNOWN_CODE, codeBox, setKnownCode, verifyByCode } from "./verify-by-code";

/**
 * AN ADDRESS IS PROVED BEFORE IT SIGNS IN (2026-10-21), in the browser.
 *
 * Until this day the "Set your password" step set the first password on any
 * address a club had invited and signed the caller straight in — so whoever
 * typed an invited Admin's address first was that Admin. Now a six-digit code
 * is emailed to the address and nobody is signed in until it is typed back.
 *
 *   a stranger claims an invited Admin's address: no session, no password,
 *     the console turns them away, and guessing is refused in words
 *   the code step's refusals — empty, wrong, expired, too many — are each said
 *     UNDER THE BOX, on the screen of the person who pressed; "Send a new
 *     code" says it sent; "Wrong address? Start again" goes back
 *
 * The rows behind it (the browser binding, single use, the owner taking the
 * seat back) are held in `an-address-is-proved-before-it-signs-in.audit.test.ts`.
 */

const prisma = new PrismaClient();
const STEM = "zz-prove-e2e";
const W = {
  wrong: "That code isn't right. Check it, or send a new one.",
  expired: "That code has expired. Send a new one.",
  tooMany: "Too many tries. Send a new code to carry on.",
};

let mark = "";

test.afterAll(async () => {
  try {
    const users = await prisma.user.findMany({ where: { email: { startsWith: STEM } }, select: { id: true } });
    const owned = await prisma.organizationMember.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { organizationId: true } });
    await prisma.event.deleteMany({ where: { name: { startsWith: STEM } } });
    await prisma.organization.deleteMany({ where: { OR: [{ name: { startsWith: STEM } }, { id: { in: owned.map((o) => o.organizationId) } }] } });
    await prisma.user.deleteMany({ where: { email: { startsWith: STEM } } });
  } finally {
    await prisma.$disconnect();
  }
});

const refusal = (page: Page) => page.locator('p[role="alert"]:not(#__next-route-announcer__)');

/** Said under the box, and on the screen: the refusal's top is below the box and close to it. */
async function saidUnderTheBox(page: Page, words: string) {
  await expect(refusal(page)).toHaveText(words, { timeout: 20_000 });
  await expect(refusal(page), `"${words}" is not on the screen of the person who pressed`).toBeInViewport();
  const box = await codeBox(page).boundingBox();
  const said = await refusal(page).boundingBox();
  expect(box && said, "the box or the refusal has no place on the page").toBeTruthy();
  expect(said!.y, `"${words}" is above the box, not under it`).toBeGreaterThanOrEqual(box!.y + box!.height - 1);
  expect(said!.y - (box!.y + box!.height), `"${words}" is far from the box`).toBeLessThan(80);
}

async function panel(page: Page, tab: "Log in" | "Sign up") {
  await landingSettled(page);
  await page.getByRole("tab", { name: tab, exact: true }).click();
  await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
}

const signedIn = async (page: Page) => (await page.context().cookies()).some((c) => c.name === "ng_session");

test("a stranger who claims an invited Admin's address gets no way in", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  mark = `${STEM}-${process.pid}-${testInfo.project.name}`;
  const victim = `${mark}-admin@example.invalid`;
  const errors: string[] = [];
  watchPageErrors(page, errors, "takeover");

  // The seat: a club's tournament, an Admin invited by address, never signed in.
  const org = await prisma.organization.create({ data: { name: `${mark} Club`, kind: "club" } });
  const event = await prisma.event.create({
    data: { organizationId: org.id, name: `${mark} Open`, dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${mark}-tok` },
  });
  await prisma.account.create({ data: { eventId: event.id, email: victim, name: "Zz Invited Admin", role: "admin" } });

  await page.goto("/");
  await panel(page, "Log in");
  await page.getByPlaceholder("you@email.com").fill(victim);
  await page.getByPlaceholder("Your password").fill("i-am-Not-who-i-say-77");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByText("Set your password")).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder("Choose a password").fill("i-am-Not-who-i-say-77");
  await page.getByRole("button", { name: "Set password & continue" }).click();

  // Asked for the code that only the invited person's inbox holds.
  await expect(page.getByRole("heading", { name: "Confirm it's you" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/z\*\*\*@example\.invalid has been invited to a tournament\. We've emailed a 6-digit code to that address\./)).toBeVisible();
  expect(await signedIn(page), "the claim signed the stranger in before any code").toBe(false);
  const row = await prisma.user.findUnique({ where: { email: victim } });
  expect(row?.password, "the stranger's password took effect").toBe("");
  expect(row?.emailVerifiedAt ?? null).toBeNull();

  // Guessing: a code we know is out there, and the stranger types another.
  await setKnownCode(victim);
  expect(KNOWN_CODE, "CONTROL: the guess must not be the code").not.toBe("000000");
  await codeBox(page).fill("000000");
  await page.getByRole("button", { name: "Confirm email" }).click();
  await saidUnderTheBox(page, W.wrong);
  expect(await signedIn(page)).toBe(false);

  // The console turns them away, and so does the player app.
  for (const path of ["/dashboard", "/me"]) {
    await page.goto(path);
    expect(new URL(page.url()).pathname, `${path} let a stranger in`).toBe("/");
  }
  // And the password they chose signs nobody in: it is the claim step again.
  await panel(page, "Log in");
  await page.getByPlaceholder("you@email.com").fill(victim);
  await page.getByPlaceholder("Your password").fill("i-am-Not-who-i-say-77");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByText("Set your password")).toBeVisible({ timeout: 20_000 });
  expect(await signedIn(page)).toBe(false);
  expect((await prisma.user.findUnique({ where: { email: victim } }))?.password).toBe("");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the code step says every refusal under the box, and lets them start again", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(15_000);
  mark = `${STEM}-${process.pid}-${testInfo.project.name}`;
  const email = `${mark}-new@example.invalid`;
  const errors: string[] = [];
  watchPageErrors(page, errors, "code step");

  await page.goto("/");
  await panel(page, "Sign up");
  await page.getByPlaceholder("Full name").fill("Zz Code Walker");
  await page.getByPlaceholder("you@email.com").fill(email);
  await page.getByPlaceholder("Choose a password").fill("four-Putts-then-87-home");
  await page.getByText("A one-off outing with friends").click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible({ timeout: 20_000 });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });

  // Empty: said before anything is sent.
  await page.getByRole("button", { name: "Confirm email" }).click();
  await saidUnderTheBox(page, W.wrong);

  // Wrong.
  await setKnownCode(email);
  await codeBox(page).fill("135791");
  await page.getByRole("button", { name: "Confirm email" }).click();
  await saidUnderTheBox(page, W.wrong);

  // Expired: the right code, too late.
  await prisma.emailCode.updateMany({ where: { userId: user.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await codeBox(page).fill(KNOWN_CODE);
  await page.getByRole("button", { name: "Confirm email" }).click();
  await saidUnderTheBox(page, W.expired);

  // A new code: said sent, and the old trouble cleared.
  await page.getByRole("button", { name: "Send a new code" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Sent — check your inbox" })).toBeVisible({ timeout: 20_000 });
  await expect(refusal(page)).toHaveCount(0);

  // Too many: five wrong tries spent on it.
  await prisma.emailCode.updateMany({ where: { userId: user.id, usedAt: null }, data: { attempts: 5 } });
  await setKnownCode(email);
  await codeBox(page).fill(KNOWN_CODE);
  await page.getByRole("button", { name: "Confirm email" }).click();
  await saidUnderTheBox(page, W.tooMany);
  expect(await signedIn(page), "a refused code signed somebody in").toBe(false);

  // Wrong address? Start again — back to the form, what they typed still there.
  await page.getByRole("button", { name: "Wrong address? Start again" }).click();
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  await expect(page.getByPlaceholder("you@email.com")).toHaveValue(email);

  // And through, at last: a fresh code, typed right.
  await page.getByPlaceholder("Choose a password").fill("four-Putts-then-87-home");
  await page.getByRole("button", { name: "Create account" }).click();
  await verifyByCode(page, email);
  await page.waitForURL((u) => u.pathname === "/choose", { timeout: 30_000 });
  expect(await signedIn(page)).toBe(true);
  expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).toBeInstanceOf(Date);
  expect(errors, errors.join("\n")).toEqual([]);
});
