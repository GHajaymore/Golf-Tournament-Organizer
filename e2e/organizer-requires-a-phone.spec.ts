import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * AN ORGANIZER ON ANY PLAN DECIDES WHETHER THE ENTRY FORM ASKS FOR A MOBILE.
 *
 * `setRequirePhone` was performed by no browser test (the reach list of every
 * round on 2026-10-14 named it). Until 2026-10-21 the free plan locked the box
 * on and the form always asked; since the decisions review (A7) the organizer
 * chooses on every plan (`phoneRequiredFor`, at the sink). So this is walked on
 * PAR, the plan that used to lock it — a paid plan never did — in both
 * directions as the organizer would: the box on Registration, then the public
 * form as somebody entering would see it.
 *
 *   tick "Require a mobile number"     → the form says "· required", the box is required
 *   untick it                          → "· optional", and not required
 *
 * Its own club, so the e2e fixture's club is left as the other specs walk it;
 * the fixture's organizer is made an admin of it for the run. Everything it
 * makes is deleted afterwards.
 */

const prisma = new PrismaClient();
const MARK = "zz-phone";
const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string; organizer: { session: string } };
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

const ids = { org: "", event: "", token: "" };

test.beforeAll(async () => {
  // The fixture's organizer, by the user id their own session carries (`signedInNow` writes
  // `<userId>~<issued>`). Not by club membership: the fixture's club has no owner or admin
  // member — its organizer holds the tournament by an event role — so a lookup that way threw
  // here, and both tests failed before they reached a page (breaks/phone, breaks/invite).
  const admin = { userId: data.organizer.session.split("~")[0] };
  await prisma.user.findUniqueOrThrow({ where: { id: admin.userId }, select: { id: true } });
  const org = await prisma.organization.create({ data: { name: `${MARK} club ${Date.now()}`, kind: "club" } });
  ids.org = org.id;
  await prisma.subscription.create({ data: { organizationId: org.id, plan: "free" } });
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

test("the organizer's own invitation is kept, under a box a screen reader can name", async ({ page, context, baseURL }) => {
  // `setInviteMessage`, reached by no browser test. Found by the box rather than
  // by its position: its "Message" caption was tied to nothing until 2026-10-14,
  // so a screen reader announced an unnamed text area — and this could not find it.
  test.setTimeout(90_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "organizer");
  await context.addCookies([{ name: "ng_active_event", value: sign(ids.event), url: baseURL! }]);
  const said = `${MARK}: Spring Open entries are open — sign up by Friday.`;
  await page.goto(`/registration?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const box = page.getByLabel("Message", { exact: true });
  await expect(box, "the invitation box has no name a screen reader can read").toBeVisible({ timeout: 20_000 });
  await box.fill(said);
  await box.blur();
  const kept = async () => (await prisma.event.findUniqueOrThrow({ where: { id: ids.event }, select: { inviteMessage: true } })).inviteMessage;
  await expect.poll(kept, { timeout: 15_000, message: "leaving the box saved nothing" }).toBe(said);
  await page.goto(`/registration?bust=${Date.now()}`);
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(said, { timeout: 20_000 });
  expect(errors).toEqual([]);
});

const required = async () => (await prisma.event.findUniqueOrThrow({ where: { id: ids.event }, select: { requirePhone: true } })).requirePhone;

test("an organizer on Par turns the mobile number on and off, and the entry form follows", async ({ page, context, browser, baseURL }) => {
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
    await expect(box, "Registration offers no mobile switch on a Par club").toBeEnabled({ timeout: 20_000 });
    await expect(box, "the switch starts ticked, as the free plan's old lock had it").not.toBeChecked();
    await expect(page.getByText(/Always on/), "the free plan's lock is still drawn").toHaveCount(0);

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
