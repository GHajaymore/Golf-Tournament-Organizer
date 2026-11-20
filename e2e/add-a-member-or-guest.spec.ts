import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * MEMBER OR GUEST, BY HAND (the no-email player identity, PR 1; Ajay, 2026-11-07).
 *
 * The organizer adds three people on Entries, as they would at the desk:
 *
 *   a Guest (not a club member)  → no email box at all; stored "guest", no email, no mobile
 *   a Member with no email       → entered (not refused); "No email yet"; an email-only
 *                                  tournament turns Round Codes on and says so
 *   a Member with an email       → stored "member" with the address
 *
 * `addSignup` is pressed as the person who would. The radios are drawn hidden inside their
 * labels, so the label is pressed and the radio is then asked `toBeChecked()`.
 *
 * Its own club and tournament (`zz-guest1`), so the e2e fixture's club is left as the other specs
 * walk it; the fixture's organizer is made an admin of it for the run. Everything is deleted after.
 */

const prisma = new PrismaClient();
const MARK = "zz-guest1";
const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { organizer: { session: string } };
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

const ids = { org: "", event: "" };

test.beforeAll(async () => {
  const admin = { userId: data.organizer.session.split("~")[0] };
  await prisma.user.findUniqueOrThrow({ where: { id: admin.userId }, select: { id: true } });
  const org = await prisma.organization.create({ data: { name: `${MARK} add club ${Date.now()}`, kind: "club" } });
  ids.org = org.id;
  await prisma.subscription.create({ data: { organizationId: org.id, plan: "free" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: admin.userId, role: "admin" } });
  const token = `${MARK}-add-${Date.now()}`;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Members and Guests`,
      status: "draft",
      format: "stroke",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${token}-share`,
      registrationToken: token,
    },
  });
  ids.event = event.id;
});

test.afterAll(async () => {
  try {
    if (ids.event) await prisma.event.deleteMany({ where: { id: ids.event } });
    // The roster rows the adds made go with the club (Member cascades on its organization).
    if (ids.org) {
      await prisma.organizationMember.deleteMany({ where: { organizationId: ids.org } });
      await prisma.subscription.deleteMany({ where: { organizationId: ids.org } });
      await prisma.organization.deleteMany({ where: { id: ids.org } });
    }
  } finally {
    await prisma.$disconnect();
  }
});

const entry = (name: string) =>
  prisma.player.findFirst({ where: { eventId: ids.event, name }, select: { standing: true, email: true, phone: true } });

test("the organizer adds a guest and two members by hand, and each is stored as chosen", async ({ page, context, baseURL }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "organizer");
  await context.addCookies([{ name: "ng_active_event", value: sign(ids.event), url: baseURL! }]);
  // Read the fixture's fact rather than assume it: how this tournament signs players in.
  const accessBefore = (await prisma.event.findUniqueOrThrow({ where: { id: ids.event }, select: { playerAccess: true } })).playerAccess;

  await page.goto(`/registration?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const nameBox = page.getByLabel("Player name");
  await expect(nameBox, "Entries has no Add form").toBeVisible({ timeout: 20_000 });
  // The hint, where the list is built.
  await expect(page.getByTestId("standing-hint").first()).toContainText("Guest (not a club member): no email needed.");

  const guestRadio = page.getByRole("radio", { name: "Guest (not a club member)" });
  const memberRadio = page.getByRole("radio", { name: "Member", exact: true });
  await expect(memberRadio, "Add does not start on Member").toBeChecked();
  const add = page.getByRole("button", { name: /Add to field/ });
  // The Add form's own box, not a row's "Email for …" in the field below.
  const addEmail = page.getByLabel(/^Email · optional/);

  // 0. Before any press, under the empty Email box: whether this add turns round codes on.
  const codesNote = page.getByText("This also turns round codes on for this tournament.");
  if (accessBefore === "email") await expect(codesNote, "the codes are not said before the press").toBeVisible();
  else await expect(codesNote).toHaveCount(0);

  // 1. A guest: the email and mobile boxes go away.
  await page.locator("label.seg-opt", { hasText: "Guest (not a club member)" }).click();
  await expect(guestRadio).toBeChecked();
  await expect(addEmail, "a guest is still asked for an email").toHaveCount(0);
  await expect(page.getByLabel(/^Mobile/), "a guest is still asked for a mobile").toHaveCount(0);
  // Said under the Guest choice too, before the press: a guest has no email.
  const guestNote = page.getByTestId("guest-codes-note");
  if (accessBefore === "email") await expect(guestNote, "the codes are not said before a guest is added").toHaveText("This also turns round codes on for this tournament.");
  else await expect(guestNote).toHaveCount(0);
  await nameBox.fill(`${MARK} Dana Guest`);
  await add.click();
  await expect.poll(() => entry(`${MARK} Dana Guest`), { timeout: 15_000, message: "the guest was not added" }).toEqual({
    standing: "guest",
    email: "",
    phone: "",
  });
  const danaRow = page.getByRole("row", { name: new RegExp(`${MARK} Dana Guest`) });
  await expect(danaRow.locator('[data-standing="guest"]')).toHaveText("Guest", { timeout: 15_000 });
  // A guest has no email, so on an email-only tournament THIS add (the first without
  // an email) is the one that turns round codes on, and says so after the press.
  // The next add finds them on already and says nothing of it.
  const accessAfterGuest = (await prisma.event.findUniqueOrThrow({ where: { id: ids.event }, select: { playerAccess: true } })).playerAccess;
  if (accessBefore === "email") {
    expect(accessAfterGuest, "round codes did not come on for a guest").toBe("both");
    await expect(page.getByText(/round codes are on now too/), "a guest add did not say it turned codes on").toBeVisible();
    // Once on, the note before the press goes away (it is derived from the saved setting).
    await expect(codesNote, "the codes are still promised after they came on").toHaveCount(0, { timeout: 15_000 });
  } else {
    expect(accessAfterGuest).toBe(accessBefore);
  }

  // 2. A member with no email: entered, not refused.
  await page.locator("label.seg-opt", { hasText: /^Member$/ }).click();
  await expect(memberRadio).toBeChecked();
  await expect(addEmail).toBeVisible();
  await expect(page.getByText("They can play and score now. Add an email later so they can sign in.")).toBeVisible();
  await nameBox.fill(`${MARK} Rob Member`);
  await add.click();
  await expect.poll(() => entry(`${MARK} Rob Member`), { timeout: 15_000, message: "a member with no email was not entered" }).toEqual({
    standing: "member",
    email: "",
    phone: "",
  });
  const robRow = page.getByRole("row", { name: new RegExp(`${MARK} Rob Member`) });
  await expect(robRow.locator('[data-standing="member"]')).toHaveText("Member", { timeout: 15_000 });
  await expect(robRow.getByText("No email yet")).toBeVisible();
  const accessAfter = (await prisma.event.findUniqueOrThrow({ where: { id: ids.event }, select: { playerAccess: true } })).playerAccess;
  // The guest before him already turned codes on (when they were off); Rob's add changes
  // nothing more and has nothing to say about it.
  expect(accessAfter, "the member add moved the sign-in setting again").toBe(accessAfterGuest);
  await expect(page.getByText(/round codes are on now too/), "a second add repeated the codes line").toHaveCount(0);

  // 3. A member with an email.
  await nameBox.fill(`${MARK} Ann Member`);
  await addEmail.fill(`${MARK}-ann@example.invalid`);
  await add.click();
  await expect.poll(() => entry(`${MARK} Ann Member`), { timeout: 15_000, message: "a member with an email was not added" }).toEqual({
    standing: "member",
    email: `${MARK}-ann@example.invalid`,
    phone: "",
  });
  expect(errors).toEqual([]);
});
