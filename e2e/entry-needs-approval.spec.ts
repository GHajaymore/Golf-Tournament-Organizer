import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * AN ENTRY THE COMMITTEE HAS TO ACCEPT: ASKED, ACCEPTED, DECLINED — AND THE
 * LIST SHUT AND OPENED AGAIN.
 *
 * Some tournaments take anybody who puts their name down; an invitational
 * takes who the committee says. There, pressing Enter is an ASK, and what the
 * member is told in the days between asking and hearing is the whole of the
 * experience. `approveSignup` and `setRegistrationOverride` were performed by
 * no browser test (round 1 on the frozen app, 2026-10-13); declining was, in
 * passing, and never read from the member's side.
 *
 *   I press Enter                       → "Sent to the organizer to approve"; I am
 *                                          stored as pending, NOT in the field (the
 *                                          control), and my list says it is with them
 *   the organizer accepts me            → I am in the field; my list says I am in
 *   a second member asks, is declined   → not in the field, not waiting; their list
 *                                          no longer says it is with the organizer
 *   the organizer closes registration   → the second member is offered no way in,
 *                                          and is told who closed it
 *   …and reopens it                     → Enter is offered again
 *
 * WHAT IT CANNOT SEE: the message a declined member might be sent.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string; partialCard: { playerId: string } };
const MARK = "zz-approve";
const NAME = `${MARK} Captain's Invitational`;
const SECOND = `${MARK}-second@example.invalid`;
const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
const day = (offset: number) => {
  const t = new Date();
  t.setDate(t.getDate() + offset);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

let eventId = "";
let myEmail = "";
let myPhone = "";
let clubId = "";
let secondSession = "";
let madeMembership: string[] = [];

async function sweep() {
  await prisma.event.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.member.deleteMany({ where: { email: SECOND } });
  await prisma.user.deleteMany({ where: { email: SECOND } });
}

test.beforeAll(async () => {
  await sweep();
  const home = await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { organizationId: true, courseId: true, course: true, city: true } });
  const me = await prisma.player.findUniqueOrThrow({ where: { id: data.partialCard.playerId }, select: { email: true } });
  myEmail = me.email;
  clubId = home.organizationId!;
  myPhone = (await prisma.member.findFirst({ where: { organizationId: clubId, email: myEmail }, select: { phone: true } }))?.phone ?? "";
  // The club holds a number for me, so the entry is not refused for want of one (that is `enter-from-the-club-list`'s to walk).
  await prisma.member.updateMany({ where: { organizationId: clubId, email: myEmail }, data: { phone: "5550123" } });
  const mine = await prisma.user.findUniqueOrThrow({ where: { email: myEmail }, select: { id: true } });
  const second = await prisma.user.create({ data: { email: SECOND, name: "Wren Halloran", password: "x:unusable" } });
  secondSession = sign(signedInNow(second.id));
  await prisma.member.create({ data: { organizationId: clubId, name: "Wren Halloran", email: SECOND, phone: "5550199", handicap: 18.2 } });
  for (const userId of [mine.id, second.id]) {
    const has = await prisma.organizationMember.findFirst({ where: { organizationId: clubId, userId } });
    if (!has) madeMembership.push((await prisma.organizationMember.create({ data: { organizationId: clubId, userId, role: "member" } })).id);
  }
  const event = await prisma.event.create({
    data: {
      name: NAME,
      organizationId: clubId,
      status: "registration",
      shape: "single",
      format: "stroke",
      dates: "",
      startOn: day(14),
      course: home.course,
      city: home.city,
      address: "",
      courseId: home.courseId,
      shareToken: `${MARK}-token`,
      leaderboardVisibility: "public",
      registrationOpen: true,
      registrationToken: `${MARK}-reg`,
      registrationApproval: "approve",
      regOpens: day(-7),
      regDeadline: day(21),
    },
  });
  eventId = event.id;
  // Whoever runs the fixture's tournament runs this one too: an organizer is an organizer of a
  // TOURNAMENT, and one made behind the screens has nobody until it is given somebody.
  const runs = await prisma.account.findFirstOrThrow({ where: { eventId: data.eventId, role: "admin" }, select: { name: true, email: true } });
  await prisma.account.create({ data: { eventId, name: runs.name, email: runs.email, role: "admin" } });
});
test.afterAll(async () => {
  if (clubId) await prisma.member.updateMany({ where: { organizationId: clubId, email: myEmail }, data: { phone: myPhone } });
  await prisma.organizationMember.deleteMany({ where: { id: { in: madeMembership } } });
  await sweep();
  await prisma.$disconnect();
});

const field = async () =>
  (await prisma.player.findMany({ where: { eventId }, select: { email: true, status: true } }))
    .map((p) => `${p.email === myEmail ? "me" : p.email === SECOND ? "second" : "other"}:${p.status}`)
    .sort();

async function card(page: Page) {
  await page.goto(`/me/events?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const c = page.locator("article", { hasText: NAME }).first();
  await expect(c, "the tournament is not on the member's list of what their club is running").toBeVisible();
  return c;
}

test("an entry the committee must accept is asked, accepted and declined, and the list is shut and opened — and each member is told where they stand", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const device = testInfo.project.use;
  const first = await browser.newContext({ ...device, baseURL, storageState: join(process.cwd(), ".e2e", "player.json") });
  const other = await browser.newContext({ ...device, baseURL, storageState: undefined });
  await other.addCookies([{ name: "ng_session", value: secondSession, url: baseURL! }]);
  const organizer = await browser.newContext({ ...device, baseURL, storageState: join(process.cwd(), ".e2e", "organizer.json") });
  // The organizer is working on THIS tournament, not the fixture's own. The stored one is taken out
  // first: added beside it, the old cookie went on being the one the server read, and the organizer
  // was looking at the wrong tournament's entries.
  await organizer.clearCookies({ name: "ng_active_event" });
  await organizer.addCookies([{ name: "ng_active_event", value: sign(eventId), url: baseURL! }]);
  try {
    const mine = await first.newPage();
    const theirs = await other.newPage();
    const desk = await organizer.newPage();
    watchPageErrors(mine, errors, "first member");
    watchPageErrors(theirs, errors, "second member");
    watchPageErrors(desk, errors, "organizer");
    const entries = async () => {
      await desk.goto(`/registration?bust=${Date.now()}`);
      await desk.waitForLoadState("networkidle").catch(() => {});
      await expect(desk.getByRole("heading", { level: 1 }), "the organizer cannot open this tournament's entries").toBeVisible();
      // CONTROL: it is THIS tournament's entries on the screen.
      await expect(desk.locator("body"), "the organizer is looking at another tournament").toContainText(NAME);
    };
    const waiting = (name: string) => desk.locator("tr", { hasText: name }).filter({ has: desk.getByRole("button", { name: "Accept" }) });

    // ── I ask ───────────────────────────────────────────────────────────────
    let c = await card(mine);
    await c.getByRole("button", { name: /^Enter this tournament/ }).click();
    await expect(c, "the member is not told the entry is with the organizer").toContainText(/Sent to the .+ to approve|with the .+ to approve/, { timeout: 20_000 });
    expect(await field(), "CONTROL: an entry that needs accepting went straight into the field").toEqual(["me:pending"]);
    c = await card(mine);
    await expect(c, "the list does not say the entry is waiting on the organizer").toContainText(/with the .+ to approve/);
    await expect(c.getByRole("button", { name: /^Enter this tournament/ }), "somebody waiting to be accepted is offered Enter again").toHaveCount(0);

    // ── accepted ────────────────────────────────────────────────────────────
    await entries();
    const myName = (await prisma.player.findFirstOrThrow({ where: { eventId, email: myEmail }, select: { name: true } })).name;
    await expect(waiting(myName), "the organizer is not shown the entry waiting to be accepted").toHaveCount(1);
    await waiting(myName).getByRole("button", { name: "Accept" }).click();
    await expect.poll(field, { timeout: 20_000, message: "accepting the entry did not put the member in the field" }).toEqual(["me:confirmed"]);
    c = await card(mine);
    await expect(c, "an accepted member is still told they are waiting").not.toContainText(/to approve/);
    await expect(c.getByRole("button", { name: /Withdraw/ }), "an accepted member is not shown as entered").toBeVisible();

    // ── a second asks, and is declined ──────────────────────────────────────
    let d = await card(theirs);
    await d.getByRole("button", { name: /^Enter this tournament/ }).click();
    await expect.poll(field, { timeout: 20_000, message: "the second ask was not recorded" }).toEqual(["me:confirmed", "second:pending"]);
    await entries();
    await expect(waiting("Wren Halloran")).toHaveCount(1);
    await waiting("Wren Halloran").getByRole("button", { name: "Decline" }).click();
    await expect.poll(async () => (await field()).filter((f) => /^second:(pending|confirmed|waitlisted)$/.test(f)), { timeout: 20_000, message: "a declined entry is still in the queue or the field" }).toEqual([]);
    d = await card(theirs);
    await expect(d, "a declined member is still told their entry is with the organizer").not.toContainText(/to approve/);

    // ── shut, and opened ────────────────────────────────────────────────────
    await entries();
    await desk.getByRole("button", { name: "Close registration" }).click();
    await expect.poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { registrationOverride: true } })).registrationOverride, { timeout: 20_000, message: "closing registration was not stored" }).toBe(true);
    d = await card(theirs);
    await expect(d.getByRole("button", { name: /^Enter this tournament|^Join the waiting list/ }), "a closed tournament still offers a way in").toHaveCount(0);
    await expect(d, "a member is not told the organizer closed it").toContainText(/Closed by the/i);
    await entries();
    await desk.getByRole("button", { name: "Reopen registration" }).click();
    await expect.poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { registrationOverride: true } })).registrationOverride, { timeout: 20_000, message: "reopening registration was not stored" }).toBeNull();
    d = await card(theirs);
    await expect(d.getByRole("button", { name: /^Enter this tournament/ }), "a reopened tournament does not offer Enter").toBeVisible();

    expect(errors, "a screen threw").toEqual([]);
  } finally {
    await Promise.all([first, other, organizer].map((x) => x.close()));
  }
});
