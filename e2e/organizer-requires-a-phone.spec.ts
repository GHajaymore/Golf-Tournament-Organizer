import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * AN ORGANIZER ON A PAID PLAN DECIDES WHETHER THE ENTRY FORM ASKS FOR A MOBILE.
 *
 * `setRequirePhone` was performed by no browser test (the reach list of every
 * round on 2026-10-14 named it). On the free plan the box is locked on and the
 * form always asks — `phoneRequiredFor`, at the sink, so a direct call cannot
 * undo it. On Birdie the organizer chooses, and this walks both directions as
 * they would: the box on Registration, then the public form as somebody
 * entering would see it.
 *
 *   tick "Require a mobile number"     → the form says "· required", the box is required
 *   untick it                          → "· optional", and not required
 *
 * Its own club on Birdie, so the e2e fixture's club stays on the free plan the
 * other specs walk; the fixture's organizer is made an admin of it for the run.
 * Everything it makes is deleted afterwards.
 */

const prisma = new PrismaClient();
const MARK = "zz-phone";
const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string };
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

const ids = { org: "", event: "", token: "" };

test.beforeAll(async () => {
  const home = await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { organizationId: true } });
  const admin = await prisma.organizationMember.findFirstOrThrow({
    where: { organizationId: home.organizationId!, role: { in: ["owner", "admin"] } },
    select: { userId: true },
  });
  const org = await prisma.organization.create({ data: { name: `${MARK} club ${Date.now()}`, kind: "club" } });
  ids.org = org.id;
  await prisma.subscription.create({ data: { organizationId: org.id, plan: "society" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: admin.userId, role: "admin" } });
  ids.token = `${MARK}-${Date.now()}`;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Spring Open`,
      status: "draft",
      format: "stroke",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${ids.token}-share`,
      registrationToken: ids.token,
      registrationOpen: true,
      requirePhone: false,
    },
  });
  ids.event = event.id;
});

test.afterAll(async () => {
  try {
    if (ids.event) await prisma.event.deleteMany({ where: { id: ids.event } });
    if (ids.org) {
      await prisma.organizationMember.deleteMany({ where: { organizationId: ids.org } });
      await prisma.subscription.deleteMany({ where: { organizationId: ids.org } });
      await prisma.organization.deleteMany({ where: { id: ids.org } });
    }
  } finally {
    await prisma.$disconnect();
  }
});

const required = async () => (await prisma.event.findUniqueOrThrow({ where: { id: ids.event }, select: { requirePhone: true } })).requirePhone;

test("an organizer on Birdie turns the mobile number on and off, and the entry form follows", async ({ page, context, browser, baseURL }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "organizer");
  await context.addCookies([{ name: "ng_active_event", value: sign(ids.event), url: baseURL! }]);
  const visitor = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const form = await visitor.newPage();
  watchPageErrors(form, errors, "visitor");

  /** What somebody entering is shown: the word beside "Mobile", and whether the box insists. */
  const formSays = async () => {
    await form.goto(`/register/${ids.token}?bust=${Date.now()}`);
    await form.waitForLoadState("networkidle").catch(() => {});
    const label = form.locator("label", { hasText: /^Mobile/ });
    await expect(label, "the entry form has no Mobile field").toBeVisible({ timeout: 20_000 });
    const word = (await label.innerText()).includes("required") ? "required" : "optional";
    const box = form.locator(`#${await label.getAttribute("for")}`);
    return { word, insists: await box.evaluate((el) => (el as HTMLInputElement).required) };
  };

  try {
    // CONTROL: off to begin with, and the form says so — the fixture is what it says.
    expect(await formSays()).toEqual({ word: "optional", insists: false });

    await page.goto(`/registration?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const box = page.getByRole("checkbox", { name: /Require a mobile number/ });
    await expect(box, "Registration offers no mobile switch on a Birdie club").toBeEnabled({ timeout: 20_000 });

    await box.check();
    await expect.poll(required, { timeout: 15_000, message: "ticking the box stored nothing" }).toBe(true);
    expect(await formSays()).toEqual({ word: "required", insists: true });

    await page.goto(`/registration?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(box).toBeChecked({ timeout: 20_000 });
    await box.uncheck();
    await expect.poll(required, { timeout: 15_000, message: "unticking the box stored nothing" }).toBe(false);
    expect(await formSays()).toEqual({ word: "optional", insists: false });
    expect(errors).toEqual([]);
  } finally {
    await visitor.close();
  }
});
