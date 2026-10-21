import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";
import { E2E_OWNER_EMAIL } from "./owner-email.mjs";
import { saidBeside, centre } from "./rounds-fixture";

/**
 * THE OWNER CONSOLE'S REFUSALS, AND WHAT IT SHOWS AFTER A RELOAD (2026-10-21).
 *
 * `owner-console.spec.ts` presses each of the console's writes once and reads
 * the row. This presses each the way it can go wrong, and reads the screen
 * back after a reload:
 *
 *   a club's tier, for a name two clubs share → refused in words beside
 *                                               Set tier; neither club moves
 *   a club's tier, for one of its own         → Newest organizations lists it
 *                                               on that tier, by the tier's
 *                                               name, after a reload
 *   a price box emptied, then Save prices     → refused beside the button,
 *                                               naming the tier; nothing stored
 *   a limit                                   → stored, and in its box after
 *                                               a reload
 *   a discount of 0%                          → refused beside Generate; no
 *                                               code made
 *   a code turned off                         → after a reload, offered to be
 *                                               turned on, and stored off
 *
 * PRICES AND LIMITS ARE THE WHOLE APP'S. Both settings rows are read before and
 * put back exactly as they were whatever happens; the clubs and the codes are
 * this spec's own and are removed. A code is a record: nothing here reaches
 * Stripe (`createDiscountCode` writes a row and nothing else).
 *
 * WHAT IT CANNOT SEE: the server's own refusals of a price or a percent — the
 * screen refuses both before asking it, so a browser never reaches them (the
 * price is held by `owner-pricing.audit.test.ts`). The enforcement switch is not
 * pressed: it moves every club on this database at once.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const MARK = "zz-owner-refuse";
const TWIN = `${MARK} Twin Oaks Golf Club`;
const OWN = `${MARK} Larchfield Golf Club`;
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
const ids = { twins: [] as string[], own: "" };
let ownerCookie = "";
const saved: Record<string, { value: string } | null> = {};

async function cleanup() {
  await prisma.discountCode.deleteMany({ where: { label: { startsWith: MARK } } });
  const orgs = await prisma.organization.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } });
  await prisma.subscription.deleteMany({ where: { organizationId: { in: orgs.map((o) => o.id) } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs.map((o) => o.id) } } });
  await prisma.user.deleteMany({ where: { email: E2E_OWNER_EMAIL } });
}

test.beforeAll(async () => {
  await cleanup();
  for (const key of ["pricing", "limits"]) {
    saved[key] = await prisma.platformSetting.findUnique({ where: { key }, select: { value: true } });
  }
  for (let i = 0; i < 2; i++) {
    const org = await prisma.organization.create({ data: { name: TWIN, kind: "club" } });
    await prisma.subscription.create({ data: { organizationId: org.id, plan: "free", planTermsApply: false } });
    ids.twins.push(org.id);
  }
  ids.own = (await prisma.organization.create({ data: { name: OWN, kind: "club" } })).id;
  const owner = await prisma.user.create({ data: { email: E2E_OWNER_EMAIL, name: "Zz Owner", password: "x:unusable" } });
  ownerCookie = sign(signedInNow(owner.id));
});

test.afterAll(async () => {
  try {
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

async function open(page: Page) {
  await page.goto(`/owner?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
}

test("the owner console refuses beside the press, and what it saved is on the screen after a reload", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "owner");
  await page.context().addCookies([{ name: "ng_session", value: ownerCookie, url: baseURL! }]);

  await test.step("a tier for a name two clubs share: refused beside Set tier, and neither club moves", async () => {
    await open(page);
    await page.locator("#owner-club-plan-name").fill(TWIN);
    await page.locator("#owner-club-plan-tier").selectOption("club");
    const setTier = page.getByRole("button", { name: "Set tier" });
    await centre(setTier);
    await setTier.click();
    const refused = page.getByRole("status").filter({ hasText: `More than one club is called “${TWIN}”, so nothing was changed.` });
    await expect(refused, "a name two clubs share was not refused in words").toBeVisible({ timeout: 20_000 });
    await saidBeside(refused, setTier, "a tier for a shared name");
    const plans = await prisma.subscription.findMany({ where: { organizationId: { in: ids.twins } }, select: { plan: true } });
    expect(plans.map((p) => p.plan), "a club changed tier on an ambiguous name").toEqual(["free", "free"]);
  });

  await test.step("a tier for one club: said, stored, and on Newest organizations after a reload", async () => {
    await page.locator("#owner-club-plan-name").fill(OWN.toUpperCase());
    await page.locator("#owner-club-plan-tier").selectOption("club");
    await page.getByRole("button", { name: "Set tier" }).click();
    await expect(page.getByRole("status").filter({ hasText: `${OWN} is now on Eagle.` })).toBeVisible({ timeout: 20_000 });
    const sub = await prisma.subscription.findUnique({ where: { organizationId: ids.own } });
    expect(sub?.plan, "the tier was not stored").toBe("club");
    expect(sub?.planTermsApply, "a club with no subscription was put on the published terms").toBe(false);
    await open(page);
    const row = page.locator("tr", { hasText: OWN });
    await expect(row, "the club is not on Newest organizations").toBeVisible();
    // By the tier's NAME, as the line above it ("is now on Eagle") and the Tier mix table name it —
    // one screen, one word for one tier.
    // Soft, so the rest of the console is still walked when this is wrong.
    await expect.soft(row.locator("td").nth(2), "Newest organizations does not name the tier the club was put on").toHaveText("Eagle");
  });

  await test.step("an emptied price box: refused beside Save prices, naming the tier; nothing stored", async () => {
    const before = (await prisma.platformSetting.findUnique({ where: { key: "pricing" } }))?.value ?? null;
    await open(page);
    await page.getByLabel("Birdie price per month in dollars").fill("");
    const save = page.getByRole("button", { name: "Save prices" });
    await centre(save);
    await save.click();
    const refused = page.getByText("Birdie: enter a price of zero or more.");
    await expect(refused, "an emptied price was not refused in words").toBeVisible();
    await saidBeside(refused, save, "an emptied price");
    await expect(page.getByText("Saved — live everywhere.")).toHaveCount(0);
    expect((await prisma.platformSetting.findUnique({ where: { key: "pricing" } }))?.value ?? null, "an emptied price was stored").toBe(before);
  });

  await test.step("a limit: stored, and in its box after a reload", async () => {
    await open(page);
    await page.getByLabel("Eagle Staff seats (blank for no cap)").fill("12");
    await page.getByRole("button", { name: "Save limits" }).click();
    await expect(page.getByText("Saved — live everywhere.")).toBeVisible({ timeout: 20_000 });
    const stored = (await prisma.platformSetting.findUnique({ where: { key: "limits" } }))?.value ?? "";
    expect(stored, "the limit was not stored against Eagle").toMatch(/"club":\{[^}]*"staffSeats":12\b/);
    await open(page);
    await expect(page.getByLabel("Eagle Staff seats (blank for no cap)"), "the limit is not in its box after a reload").toHaveValue("12");
  });

  await test.step("a discount of 0%: refused beside Generate; no code made", async () => {
    await open(page);
    await page.getByLabel("Percent off").fill("0");
    await page.locator("#disc-label").fill(`${MARK} nothing off`);
    const generate = page.getByRole("button", { name: "Generate" });
    await centre(generate);
    await generate.click();
    const refused = page.getByText("Enter a whole percent from 1 to 100.");
    await expect(refused, "a 0% code was not refused in words").toBeVisible();
    await saidBeside(refused, generate, "a 0% code");
    expect(await prisma.discountCode.count({ where: { label: `${MARK} nothing off` } }), "a 0% code was made").toBe(0);
  });

  await test.step("a code turned off is off after a reload", async () => {
    await page.getByLabel("Percent off").fill("25");
    await page.locator("#disc-label").fill(`${MARK} winter`);
    await page.getByRole("button", { name: "Generate" }).click();
    await expect(page.getByText(/New code — 25% off the first payment/)).toBeVisible({ timeout: 20_000 });
    const made = await prisma.discountCode.findFirstOrThrow({ where: { label: `${MARK} winter` } });
    await open(page);
    const row = page.locator("tr", { hasText: made.code });
    await expect(row, "the new code is not listed").toContainText("25%");
    await row.getByRole("button", { name: "Turn off" }).click();
    await expect.poll(async () => (await prisma.discountCode.findUniqueOrThrow({ where: { code: made.code } })).active).toBe(false);
    await open(page);
    await expect(page.locator("tr", { hasText: made.code }).getByRole("button", { name: "Turn on" }), "a code turned off is not shown off after a reload").toBeVisible();
  });

  expect(errors, errors.join("\n")).toEqual([]);
});
