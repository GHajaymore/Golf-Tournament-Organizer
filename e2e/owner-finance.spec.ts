import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";
import { E2E_OWNER_EMAIL } from "./owner-email.mjs";

/**
 * THE OWNER'S BOOKS, AS THE OWNER USES THEM (B44, 2026-11-13).
 *
 *   somebody who is not an owner       -> the Finance tab and the CSV are not there for them (404)
 *   the owner opens Finance            -> "no billing yet" for revenue, the projection in its own box, the words at the top
 *   the owner adds a cost              -> in the table of costs, and in the CSV (status 200 read before the body)
 *   a cost typed as "abc"              -> refused beside the button, nothing stored
 *   the owner types a rate             -> listed; a cost in pounds is then shown in dollars with the pounds beside it
 *   the owner voids a cost             -> gone from the table, kept in the database with its reason
 *
 * The rows are this spec's own (vendor "zz-finance-…") and are removed whatever happens. Nothing here
 * charges or pays anybody: it is a record (CLAUDE.md, Hard rule 7).
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const MARK = "zz-finance";
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
const cookies = { owner: "", stranger: "" };

async function cleanup() {
  await prisma.costEntry.deleteMany({ where: { vendor: { startsWith: MARK } } });
  await prisma.fxRate.deleteMany({ where: { reason: { startsWith: MARK } } });
  await prisma.user.deleteMany({ where: { OR: [{ email: E2E_OWNER_EMAIL }, { email: { startsWith: MARK } }] } });
}

test.beforeAll(async () => {
  await cleanup();
  const owner = await prisma.user.create({ data: { email: E2E_OWNER_EMAIL, name: "Zz Owner", password: "x:unusable" } });
  const stranger = await prisma.user.create({ data: { email: `${MARK}-stranger@example.invalid`, name: "Zz Stranger", password: "x:unusable" } });
  cookies.owner = sign(signedInNow(owner.id));
  cookies.stranger = sign(signedInNow(stranger.id));
});

test.afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

test("the owner types a cost and a rate, reads them back in the table and the CSV, and voids one; a stranger finds nothing", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "owner");
  const finance = async () => {
    await page.goto(`/owner?tab=finance&bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
  };

  await test.step("somebody who is not an owner finds nothing: not the tab, not the CSV", async () => {
    await page.context().addCookies([{ name: "ng_session", value: cookies.stranger, url: baseURL! }]);
    const tab = await page.goto(`/owner?tab=finance&bust=${Date.now()}`);
    expect(tab?.status(), "the Finance tab answered somebody who is not an owner").toBe(404);
    const csv = await page.request.get("/owner/finance-export");
    expect(csv.status(), "the CSV answered somebody who is not an owner").toBe(404);
  });

  await page.context().clearCookies();
  await page.context().addCookies([{ name: "ng_session", value: cookies.owner, url: baseURL! }]);

  await test.step("the Finance tab says what it is, shows revenue as not yet billed, and keeps the projection apart", async () => {
    await finance();
    await expect(page.getByText("A record of what TourneyHQ earned and spent. Not accounting or tax advice.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Finance" })).toBeVisible();
    await expect(page.getByText("no billing yet").first()).toBeVisible();
    await expect(page.getByText("Projection — not revenue")).toBeVisible();
    await expect(page.getByText(/clubs? on a comped plan/)).toBeVisible();
  });

  await test.step("a cost that is not a figure is refused beside the button, and nothing is stored", async () => {
    await page.getByLabel("Vendor").fill(`${MARK}-host`);
    await page.getByLabel("Amount").fill("abc");
    await page.getByRole("button", { name: "Add cost" }).click();
    // Not getByRole("alert"): Next's route announcer is an alert too.
    await expect(page.locator('p[role="alert"]')).toContainText("figure");
    expect(await prisma.costEntry.count({ where: { vendor: { startsWith: MARK } } })).toBe(0);
  });

  await test.step("a cost in pounds, with a rate: recorded, listed, and shown in dollars with the pounds beside it", async () => {
    await page.getByLabel("Amount").fill("39.00");
    await page.getByLabel("Currency", { exact: true }).first().selectOption("GBP");
    await page.getByRole("button", { name: "Add cost" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Cost recorded." })).toBeVisible();
    const stored = await prisma.costEntry.findFirst({ where: { vendor: `${MARK}-host` } });
    expect(stored?.amountMinor, "stored in minor units of the currency typed").toBe(3900);
    expect(stored?.currency).toBe("GBP");

    await page.getByLabel("US dollars per 1 unit").fill("1.27");
    await page.getByLabel("From day").fill("2020-01-01");
    await page.getByLabel("Where it comes from").fill(`${MARK} bank statement`);
    await page.getByRole("button", { name: "Save rate" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Rate recorded." })).toBeVisible();
    const rate = await prisma.fxRate.findFirst({ where: { reason: { startsWith: MARK } } });
    expect(rate?.usdMicrosPerUnit).toBe(1_270_000);

    await finance();
    await expect(page.getByText("GBP 39.00").first()).toBeVisible();
    await expect(page.getByText("$49.53").first(), "39.00 GBP at 1.27 is $49.53").toBeVisible();
  });

  await test.step("the CSV holds the cost, answers 200 first, is never cached, and carries no club or player", async () => {
    const res = await page.request.get("/owner/finance-export");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect(res.headers()["content-disposition"]).toMatch(/tourneyhq-finance-\d{4}-\d{2}-\d{2}\.csv/);
    const body = await res.text();
    expect(body.split("\r\n")[0]).toContain("month,line,category,vendor,currency");
    expect(body).toContain(`${MARK}-host`);
    expect(body).toContain("39.00");
  });

  await test.step("voiding a cost takes it out of the table and keeps the row with its reason", async () => {
    await finance();
    await page.getByRole("button", { name: /^Void Hosting/ }).first().click();
    await page.getByLabel(/^Why Hosting/).fill("typed twice");
    await page.getByRole("button", { name: "Void it" }).click();
    await expect.poll(() => prisma.costEntry.count({ where: { vendor: `${MARK}-host`, voidedAt: { not: null } } })).toBe(1);
    const voided = await prisma.costEntry.findFirst({ where: { vendor: `${MARK}-host` } });
    expect(voided?.voidReason).toContain("typed twice");
    expect(errors, "the page reported errors").toEqual([]);
  });
});
