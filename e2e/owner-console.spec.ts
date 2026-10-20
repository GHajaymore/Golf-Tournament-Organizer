import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";
import { E2E_OWNER_EMAIL } from "./owner-email.mjs";

/**
 * THE OWNER CONSOLE, AS THE OWNER USES IT (2026-10-21).
 *
 * `setClubPlan`, `saveTierPrices`, `saveTierLimits`, `createDiscountCode` and
 * `setDiscountCodeActive` were performed by no browser test — the test server
 * had no owner, so `/owner` was a 404 to every test. It has one now, an
 * invented address (`e2e/owner-email.mjs`).
 *
 *   a club's tier, for a name nobody has → refused, in words, beside the button
 *   a club's tier                         → the club's subscription is that tier
 *   Birdie's monthly price                → stored, and on the screen after a reload
 *   a tier's limit                        → stored
 *   a discount code                       → made, shown, listed; turned off; on
 *   somebody who is not the owner         → /owner is not there for them
 *
 * PRICES AND LIMITS ARE THE WHOLE APP'S, so the two settings rows are read
 * before and put back exactly as they were, whatever happens; the club and the
 * codes are this spec's own and are removed.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const MARK = "zz-owner-console";
const CLUB = `${MARK} Heathfield Golf Club`;
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
const ids = { org: "", owner: "", stranger: "" };
const cookies = { owner: "", stranger: "" };
const saved: Record<string, { value: string } | null> = {};

async function cleanup() {
  await prisma.discountCode.deleteMany({ where: { label: { startsWith: MARK } } });
  const orgs = await prisma.organization.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } });
  await prisma.subscription.deleteMany({ where: { organizationId: { in: orgs.map((o) => o.id) } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs.map((o) => o.id) } } });
  await prisma.user.deleteMany({ where: { OR: [{ email: E2E_OWNER_EMAIL }, { email: { startsWith: MARK } }] } });
}

test.beforeAll(async () => {
  await cleanup();
  for (const key of ["pricing", "limits"]) {
    saved[key] = await prisma.platformSetting.findUnique({ where: { key }, select: { value: true } });
  }
  ids.org = (await prisma.organization.create({ data: { name: CLUB, kind: "club" } })).id;
  const owner = await prisma.user.create({ data: { email: E2E_OWNER_EMAIL, name: "Zz Owner", password: "x:unusable" } });
  const stranger = await prisma.user.create({ data: { email: `${MARK}-stranger@example.invalid`, name: "Zz Stranger", password: "x:unusable" } });
  ids.owner = owner.id;
  ids.stranger = stranger.id;
  cookies.owner = sign(signedInNow(owner.id));
  cookies.stranger = sign(signedInNow(stranger.id));
});

test.afterAll(async () => {
  try {
    // The whole app's prices and limits, back exactly as they were.
    for (const key of ["pricing", "limits"]) {
      const was = saved[key];
      if (was) await prisma.platformSetting.upsert({ where: { key }, update: { value: was.value }, create: { key, value: was.value } });
      else await prisma.platformSetting.deleteMany({ where: { key } });
    }
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

test("the owner sets a club's tier, a price, a limit, and makes, pauses and restarts a discount code", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "owner");
  const open = async () => {
    await page.goto(`/owner?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
  };

  await test.step("somebody who is not the owner finds nothing there", async () => {
    await page.context().addCookies([{ name: "ng_session", value: cookies.stranger, url: baseURL! }]);
    const res = await page.goto(`/owner?bust=${Date.now()}`);
    expect(res?.status(), "the owner console answered somebody else").toBe(404);
  });

  await page.context().clearCookies();
  await page.context().addCookies([{ name: "ng_session", value: cookies.owner, url: baseURL! }]);

  await test.step("a club's tier: refused for a name nobody has, then set", async () => {
    await open();
    await page.locator("#owner-club-plan-name").fill(`${MARK} No Such Club`);
    await page.locator("#owner-club-plan-tier").selectOption("society");
    const setTier = page.getByRole("button", { name: "Set tier" });
    await setTier.click();
    const refused = page.getByText(`No club is called “${MARK} No Such Club”.`);
    await expect(refused).toBeVisible({ timeout: 20_000 });
    // Said BESIDE the button — measured as distance, because the press scrolls
    // the button only just into view and a line under it then sits past the
    // edge however close it is.
    const [b, r] = [await setTier.boundingBox(), await refused.boundingBox()];
    expect(Math.abs((r?.y ?? 1e6) - (b?.y ?? 0)), "the refusal is not beside Set tier").toBeLessThan(200);

    await page.locator("#owner-club-plan-name").fill(CLUB);
    await page.locator("#owner-club-plan-tier").selectOption("society");
    await page.getByRole("button", { name: "Set tier" }).click();
    await expect
      .poll(async () => (await prisma.subscription.findUnique({ where: { organizationId: ids.org } }))?.plan, { message: "the tier was not stored" })
      .toBe("society");
  });

  await test.step("Birdie's monthly price is stored and read back", async () => {
    await open();
    const price = page.getByLabel("Birdie price per month in dollars");
    await price.fill("51");
    await page.getByRole("button", { name: "Save prices" }).click();
    await expect(page.getByText("Saved — live everywhere.").first()).toBeVisible({ timeout: 20_000 });
    const stored = await prisma.platformSetting.findUnique({ where: { key: "pricing" } });
    expect(stored?.value ?? "", "the price was not stored").toMatch(/"society":\{"monthly":51\}/);
    await open();
    await expect(page.getByLabel("Birdie price per month in dollars")).toHaveValue("51");
  });

  await test.step("a tier's limit is stored", async () => {
    await open();
    await page.getByLabel("Birdie Active events (blank for no cap)").fill("7");
    await page.getByRole("button", { name: "Save limits" }).click();
    await expect(page.getByText("Saved — live everywhere.").last()).toBeVisible({ timeout: 20_000 });
    const stored = await prisma.platformSetting.findUnique({ where: { key: "limits" } });
    expect(stored?.value ?? "", "the limit was not stored").toMatch(/"activeEvents":7\b/);
  });

  await test.step("a discount code is made, listed, turned off and on again", async () => {
    await open();
    await page.getByLabel("Percent off").fill("15");
    await page.locator("#disc-label").fill(`${MARK} launch`);
    await page.getByRole("button", { name: "Generate" }).click();
    await expect(page.getByText(/New code — 15% off the first payment/)).toBeVisible({ timeout: 20_000 });
    const made = await prisma.discountCode.findFirstOrThrow({ where: { label: `${MARK} launch` } });
    expect(made.percentOff).toBe(15);
    expect(made.active).toBe(true);

    await open();
    const row = page.locator("tr", { hasText: made.code });
    await row.getByRole("button", { name: "Turn off" }).click();
    await expect.poll(async () => (await prisma.discountCode.findUniqueOrThrow({ where: { code: made.code } })).active).toBe(false);
    await expect(row.getByRole("button", { name: "Turn on" })).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: "Turn on" }).click();
    await expect.poll(async () => (await prisma.discountCode.findUniqueOrThrow({ where: { code: made.code } })).active).toBe(true);
  });

  expect(errors, errors.join("\n")).toEqual([]);
});
