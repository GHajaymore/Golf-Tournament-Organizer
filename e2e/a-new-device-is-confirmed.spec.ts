import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";
import { watchPageErrors } from "./page-errors";
import { landingSettled } from "./landing-settled";
import { verifyByCode } from "./verify-by-code";

/**
 * A NEW DEVICE IS CONFIRMED (2026-10-21), in the browser.
 *
 * A club's secretary signing in with the right password on a browser the app
 * has not seen is shown "Confirm it's you" and is not signed in until the
 * emailed code is typed back; that browser is then known and goes straight in
 * next time, and a DIFFERENT browser is asked again. A member signing in on a
 * new browser goes straight in (they are emailed instead — that email, and the
 * rows behind all of it, are held in `a-new-device-proves-itself.audit.test.ts`).
 *
 * Each browser is a fresh context, which is exactly what a new device is: no
 * cookies at all.
 */

const prisma = new PrismaClient();
const STEM = "zz-device-e2e";
const PASSWORD = "seven-Iron-into-the-wind";

/** The app's own stored shape (`hashPassword` in lib/auth.ts): "salt:hash", scrypt, hex. */
function hashed(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

test.afterAll(async () => {
  try {
    await prisma.organization.deleteMany({ where: { name: { startsWith: STEM } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: STEM } } });
  } finally {
    await prisma.$disconnect();
  }
});

async function logIn(page: Page, email: string) {
  await page.goto("/");
  await landingSettled(page);
  await page.getByRole("tab", { name: "Log in", exact: true }).click();
  await page.getByPlaceholder("you@email.com").fill(email);
  await page.getByPlaceholder("Your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}
const signedIn = async (page: Page) => (await page.context().cookies()).some((c) => c.name === "ng_session");
const offTheFrontDoor = (page: Page) => expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).not.toBe("/");

test("a secretary confirms a new device with the emailed code; a member does not have to", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const mark = `${STEM}-${process.pid}-${testInfo.project.name}`;
  const secretary = `${mark}-secretary@example.invalid`;
  const member = `${mark}-member@example.invalid`;
  const org = await prisma.organization.create({ data: { name: `${mark} Club`, kind: "club" } });
  const sec = await prisma.user.create({ data: { email: secretary, name: "Zz Secretary", password: hashed(PASSWORD), emailVerifiedAt: new Date() } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: sec.id, role: "admin" } });
  await prisma.user.create({ data: { email: member, name: "Zz Member", password: hashed(PASSWORD), emailVerifiedAt: new Date() } });

  const viewport = testInfo.project.use.viewport ?? { width: 1280, height: 900 };
  const device = () => browser.newContext({ baseURL, viewport });
  const errors: string[] = [];

  // The secretary's laptop: the right password, and still not in.
  const laptop = await device();
  const a = await laptop.newPage();
  watchPageErrors(a, errors, "secretary, laptop");
  await logIn(a, secretary);
  await expect(a.getByRole("heading", { name: "Confirm it's you" })).toBeVisible({ timeout: 20_000 });
  await expect(a.getByText(/You're signing in on a new device\. We sent a 6-digit code to z\*\*\*@example\.invalid\./)).toBeVisible();
  expect(await signedIn(a), "the right password alone signed a secretary in on a new device").toBe(false);
  await verifyByCode(a, secretary);
  await offTheFrontDoor(a);
  expect(await signedIn(a)).toBe(true);

  // The same laptop next time: straight in, no code.
  await laptop.clearCookies({ name: "ng_session" });
  await logIn(a, secretary);
  await offTheFrontDoor(a);
  await expect(a.getByRole("heading", { name: "Confirm it's you" })).toBeHidden();
  await laptop.close();

  // CONTROL: a phone the app has never seen is asked again — it is the browser that is known.
  const phone = await device();
  const b = await phone.newPage();
  watchPageErrors(b, errors, "secretary, phone");
  await logIn(b, secretary);
  await expect(b.getByRole("heading", { name: "Confirm it's you" })).toBeVisible({ timeout: 20_000 });
  expect(await signedIn(b)).toBe(false);
  await phone.close();

  // A member on a new browser goes straight in.
  const friends = await device();
  const c = await friends.newPage();
  watchPageErrors(c, errors, "member");
  await logIn(c, member);
  await offTheFrontDoor(c);
  expect(await signedIn(c)).toBe(true);
  await friends.close();

  expect(errors, errors.join("\n")).toEqual([]);
});
