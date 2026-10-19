import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * A CLUB'S COMMISSIONER APPLIES A DISCOUNT CODE ON CLUB SETTINGS, BEFORE PAYING.
 *
 * The owner hands out codes (`/owner`); a club types one into the plan panel
 * and presses Apply, and is told what it does — or, beside the box, why not —
 * before any card is asked for. Found by the round (G149–G151): the action
 * behind Apply, `checkDiscountCode`, had no browser test at all, because the
 * test server had billing switched off and the box was never drawn
 * (`playwright.config.ts` now gives it a key that can charge nothing).
 *
 *   a code nobody issued        → "That isn't a discount code we know", at the box
 *   a code past its expiry      → "That discount code has expired", at the box
 *   a good code, typed lowercase → what it does, and the box reads it as issued
 *
 * Its own club, owner and codes, marked zz-, one set per screen size, deleted
 * afterwards. WHAT IT CANNOT SEE: Stripe's checkout itself (no live key), and
 * the code coming off the first payment — `checkoutUrl` and its unit tests hold
 * that.
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

test("a club's Commissioner applies a discount code on the plan panel and is told what it does, or why not, at the box", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const size = testInfo.project.name.replace(/[^a-z]/gi, "").toUpperCase();
  const GOOD = `ZZDISC25${size}`;
  const OLD = `ZZDISCOLD${size}`;
  const email = `zz-discount-${testInfo.project.name}@example.invalid`;
  const ids = { user: "", org: "" };
  const errors: string[] = [];
  const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] } });
  try {
    await prisma.discountCode.deleteMany({ where: { code: { in: [GOOD, OLD] } } });
    await prisma.user.deleteMany({ where: { email } });
    const user = await prisma.user.create({ data: { email, name: "Zz Discount Owner", password: "x:unusable" } });
    ids.user = user.id;
    const org = await prisma.organization.create({
      data: {
        name: `zz-discount club ${testInfo.project.name}`,
        kind: "club",
        subscription: { create: { plan: "free", planTermsApply: true } },
        members: { create: { userId: user.id, role: "owner" } },
      },
    });
    ids.org = org.id;
    await prisma.discountCode.createMany({
      data: [
        { code: GOOD, percentOff: 25, label: "zz e2e" },
        { code: OLD, percentOff: 40, label: "zz e2e, expired", expiresAt: new Date(Date.now() - 86_400_000) },
      ],
    });
    await ctx.addCookies([{ name: "ng_session", value: sign(signedInNow(user.id)), url: baseURL! }]);

    const page = await ctx.newPage();
    watchPageErrors(page, errors);
    await page.goto(`/organization?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const box = page.getByLabel(/^Discount code/);
    await expect(box, "the plan panel has no discount box for the club's Commissioner").toBeVisible({ timeout: 20_000 });
    const apply = page.getByRole("button", { name: "Apply" });
    const note = page.locator("#plan-discount-note");

    // A code nobody issued: refused, in words, beside the box.
    await box.fill("ZZNOSUCHCODE");
    await apply.click();
    await expect(note).toHaveText(/That isn.t a discount code we know/, { timeout: 15_000 });
    await expect(note, "the refusal is not where the press was").toBeInViewport();

    // A code past its expiry: refused, and the reason is the expiry.
    await box.fill(OLD);
    await apply.click();
    await expect(note).toHaveText(/That discount code has expired/, { timeout: 15_000 });

    // A good code, typed as a person might — lowercase, a space at the end.
    await box.fill(`${GOOD.toLowerCase()} `);
    await apply.click();
    await expect(note).toHaveText(/25% off your first payment/, { timeout: 15_000 });
    await expect(note, "the good code's answer is not where the press was").toBeInViewport();
    await expect(box, "the box does not read the code as it was issued").toHaveValue(GOOD);
    // CONTROL: the panel is offering to sell — the box is part of a real checkout, not a stray form.
    await expect(page.getByRole("button", { name: /\/(yr|mo)$/ }).first()).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await ctx.close().catch(() => {});
    await prisma.discountCode.deleteMany({ where: { code: { in: [GOOD, OLD] } } });
    if (ids.org) await prisma.organization.deleteMany({ where: { id: ids.org } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
  }
});
