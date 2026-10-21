import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";
import { E2E_OWNER_EMAIL } from "./owner-email.mjs";

/**
 * SOMEBODY REGISTERS INTEREST BEFORE WE OPEN, AND THE OWNER SEES IT (2026-10-21).
 *
 *   /interest, signed out, on a phone → the offer, with its first-term terms
 *   sent with no club                 → refused beside the club box; nothing kept
 *   a whole answer                    → thanked by name and address; kept as a row
 *   an organizer is invited to share; a player is told to bring their organizer
 *   the owner console                 → the note is listed, newest first
 *
 * WHAT IT CANNOT SEE: the copy to inquiries@ (no mail leaves a test — the audit
 * test holds what is sent), and the front door's link to here, which is drawn
 * only while sign-ins are held — in production, which no test reaches.
 */

const prisma = new PrismaClient();
const RUN = Date.now().toString(36);
const MARK = "zz-interest-e2e";
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
let ownerCookie = "";

async function cleanup() {
  await prisma.interestRequest.deleteMany({ where: { email: { startsWith: MARK } } });
  await prisma.user.deleteMany({ where: { email: E2E_OWNER_EMAIL } });
}

test.beforeAll(async () => {
  await cleanup();
  const owner = await prisma.user.create({ data: { email: E2E_OWNER_EMAIL, name: "Zz Owner", password: "x:unusable" } });
  ownerCookie = sign(signedInNow(owner.id));
});
test.afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

test("a secretary registers interest, is thanked, and the owner sees them; a player is pointed to their organizer", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "visitor");
  const email = `${MARK}-${testInfo.project.name}-${RUN}@example.invalid`;

  await test.step("the page offers 25% off the first term, and names no code", async () => {
    await page.goto(`/interest?bust=${Date.now()}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/25% off the paid plan you choose at launch/)).toBeVisible();
    await expect(page.getByText(/your first month, or your first year if you pay yearly/).first()).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, `/interest scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
  });

  await test.step("sent with no club: refused beside the club box, nothing kept", async () => {
    await page.getByLabel("Your name").fill("Zz Pat");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("radio", { name: "Club secretary or manager" }).check();
    await page.getByRole("button", { name: "Register my interest" }).click();
    const refused = page.getByText(/Tell us your club or society/);
    await expect(refused).toBeVisible({ timeout: 20_000 });
    const [box, said] = [await page.getByLabel("Club or society").boundingBox(), await refused.boundingBox()];
    expect(Math.abs((said?.y ?? 1e6) - (box?.y ?? 0)), "the refusal is not beside the club box").toBeLessThan(120);
    expect(await prisma.interestRequest.count({ where: { email } })).toBe(0);
  });

  await test.step("a whole answer: thanked by name and address, and kept", async () => {
    await page.getByLabel("Club or society").fill("Zz Oakmere Golf Club");
    // Phone is optional; a number that is not one is refused beside its box.
    await page.getByLabel(/^Phone/).fill("call me");
    await page.getByRole("button", { name: "Register my interest" }).click();
    await expect(page.getByText(/That phone number doesn.t look right/)).toBeVisible({ timeout: 20_000 });
    await page.getByLabel(/^Phone/).fill("+1 (513) 555-0142");
    await page.getByRole("radio", { name: "50 to 150" }).check();
    await page.getByLabel(/Anything you.d like us to know/).fill("We run a Thursday draw.");
    await page.getByRole("button", { name: "Register my interest" }).click();
    await expect(page.getByText(`Thanks, Zz Pat, you're on the list. We'll email ${email} when TourneyHQ opens`)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Copy the link" }), "an organizer is not invited to share").toBeVisible();
    const row = await prisma.interestRequest.findFirst({ where: { email } });
    expect(row).toMatchObject({ name: "Zz Pat", phone: "+1 (513) 555-0142", club: "Zz Oakmere Golf Club", role: "secretary", members: "50-150", note: "We run a Thursday draw." });
  });

  await test.step("a player is told tournaments are set up by their club, not asked to share", async () => {
    const other = await browser.newContext({ baseURL });
    try {
      const p = await other.newPage();
      await p.goto(`/interest?bust=${Date.now()}`);
      await p.getByLabel("Your name").fill("Zz Lee");
      await p.getByLabel("Email").fill(`${MARK}-player-${testInfo.project.name}-${RUN}@example.invalid`);
      await p.getByLabel("Club or society").fill("Zz Oakmere Golf Club");
      await p.getByRole("radio", { name: "Player" }).check();
      await p.getByRole("button", { name: "Register my interest" }).click();
      await expect(p.getByText(/Tell your secretary or organizer, and they can register here too/)).toBeVisible({ timeout: 20_000 });
      await expect(p.getByRole("button", { name: "Copy the link" })).toHaveCount(0);
    } finally {
      await other.close();
    }
  });

  await test.step("the owner sees the note on the console", async () => {
    await page.context().addCookies([{ name: "ng_session", value: ownerCookie, url: baseURL! }]);
    await page.goto(`/owner?bust=${Date.now()}`);
    const list = page.getByRole("region", { name: "Registered interest" });
    await expect(list.getByRole("row", { name: new RegExp(email.replace(/[.+]/g, "\\$&")) })).toContainText("Club secretary or manager");
    await expect(list).toContainText("We run a Thursday draw.");
  });

  expect(errors, errors.join("\n")).toEqual([]);
});
