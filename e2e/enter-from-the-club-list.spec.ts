import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * THE LAST PLACE, THE WAITING LIST, AND THE PLACE THAT COMES BACK.
 *
 * A member opens their club's tournaments, sees one with a place left and
 * puts their name down — one press, no form (`enterThisTournament`). No
 * browser test pressed that button (the first measured round, 2026-10-13);
 * the entry FORM was walked, and this is the same entry by the other door.
 *
 * What matters about a field with a limit is what happens AT the limit, so the
 * tournament here has two places and one already taken:
 *
 *   I open my club's tournaments            → "1 of 2 places left", and Enter
 *   I press Enter, and the club holds no
 *   mobile number for me                    → refused in words, with a link to the
 *                                              entry form; nothing is stored
 *   the club records my number; I press
 *   Enter                                   → "You're in"; I am in the field once,
 *                                              confirmed; the button has gone and
 *                                              the list says "Entered"
 *   a second member opens the same list     → "Full — waiting list open", and the
 *                                              button says what it will do:
 *                                              "Join the waiting list"
 *   they press it                           → they are told they are WAITING, are
 *                                              stored as waiting, and the field is
 *                                              still two (the control: a full field
 *                                              is not overfilled)
 *   I withdraw                              → asked first, and told my place goes
 *                                              to the next person waiting
 *   …and it does                            → the second member is confirmed
 *                                              without anybody doing anything,
 *                                              their list says so, and the field
 *                                              is two again — never three
 *
 * WHAT IT CANNOT SEE: an entry the organizer must approve. That is answered
 * "Sent to the organizer to approve" by the same button, and the approval is
 * walked on the entry form.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as {
  eventId: string;
  partialCard: { playerId: string };
};
const MARK = "zz-enter";
const NAME = `${MARK} Autumn Stableford`;
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
  // Starts from a club that holds no number for me, whatever an earlier run left.
  await prisma.member.updateMany({ where: { organizationId: clubId, email: myEmail }, data: { phone: "" } });
  const mine = await prisma.user.findUniqueOrThrow({ where: { email: myEmail }, select: { id: true } });
  const second = await prisma.user.create({ data: { email: SECOND, name: "Wren Halloran", password: "x:unusable" } });
  secondSession = sign(signedInNow(second.id));
  await prisma.member.create({ data: { organizationId: home.organizationId!, name: "Wren Halloran", email: SECOND, phone: "5550199", handicap: 18.2 } });
  // Belonging to the club is what lets a member see its tournaments and enter them.
  for (const userId of [mine.id, second.id]) {
    const has = await prisma.organizationMember.findFirst({ where: { organizationId: home.organizationId!, userId } });
    if (!has) madeMembership.push((await prisma.organizationMember.create({ data: { organizationId: home.organizationId!, userId, role: "member" } })).id);
  }
  const event = await prisma.event.create({
    data: {
      name: NAME,
      organizationId: home.organizationId,
      status: "registration",
      shape: "single",
      format: "stroke",
      // A day, so the list files it under this season and not under "No dates yet", which is folded shut.
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
      registrationApproval: "auto",
      regOpens: day(-7),
      regDeadline: day(21),
      capacity: 2,
    },
  });
  eventId = event.id;
  await prisma.player.create({ data: { eventId, name: "Pat Holder", email: `${MARK}-holder@example.invalid`, status: "confirmed", handicap: 9, seed: 1 } });
});
test.afterAll(async () => {
  // The fixture's member is every later spec's: their number goes back to what it was.
  if (clubId) await prisma.member.updateMany({ where: { organizationId: clubId, email: myEmail }, data: { phone: myPhone } });
  await prisma.organizationMember.deleteMany({ where: { id: { in: madeMembership } } });
  await sweep();
  await prisma.$disconnect();
});

const field = async () =>
  (await prisma.player.findMany({ where: { eventId }, select: { email: true, status: true } }))
    .map((p) => `${p.email === myEmail ? "me" : p.email === SECOND ? "second" : "holder"}:${p.status}`)
    .sort();

/** This tournament's card on a member's list of what their club is running. */
async function card(page: Page) {
  await page.goto(`/me/events?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const c = page.locator("article", { hasText: NAME }).first();
  await expect(c, "the tournament is not on the member's list of what their club is running").toBeVisible();
  return c;
}

test("a member takes the last place from their club's list, the next goes on the waiting list, and a withdrawal hands the place on", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const device = testInfo.project.use;
  const first = await browser.newContext({ ...device, baseURL, storageState: join(process.cwd(), ".e2e", "player.json") });
  const other = await browser.newContext({ ...device, baseURL, storageState: undefined });
  await other.addCookies([{ name: "ng_session", value: secondSession, url: baseURL! }]);
  try {
    const mine = await first.newPage();
    const theirs = await other.newPage();
    watchPageErrors(mine, errors, "first member");
    watchPageErrors(theirs, errors, "second member");
    expect(await field()).toEqual(["holder:confirmed"]);

    // ── the club holds no mobile number for me: refused in words, with the way round it ──
    let c = await card(mine);
    await expect(c, "the list does not say how many places are left").toContainText("1 of 2 places left");
    await c.getByRole("button", { name: /^Enter this tournament/ }).click();
    await expect(c, "an entry that needs a mobile number is not refused in words").toContainText("needs a mobile number", { timeout: 20_000 });
    await expect(c.getByRole("link", { name: "Use the entry form" }), "the refusal offers no way round it").toBeVisible();
    expect(await field(), "CONTROL: a refused entry was stored").toEqual(["holder:confirmed"]);
    // The club records it — the secretary's job, done here the short way.
    await prisma.member.updateMany({ where: { organizationId: clubId, email: myEmail }, data: { phone: "5550123" } });

    // ── the last place ──────────────────────────────────────────────────────
    c = await card(mine);
    await expect(c).toContainText("1 of 2 places left");
    await c.getByRole("button", { name: /^Enter this tournament/ }).click();
    // The button answers first ("You're in — see you there.") and the list redraws under it ("You're in"): either is the answer.
    await expect(c, "the member is not told they are in").toContainText(/You(’|')re in/i, { timeout: 20_000 });
    expect(await field(), "pressing Enter did not put me in the field once, confirmed").toEqual(["holder:confirmed", "me:confirmed"]);
    c = await card(mine);
    await expect(c.getByRole("button", { name: /^Enter this tournament|^Join the waiting list/ }), "somebody already in is offered the Enter button again").toHaveCount(0);
    await expect(c.getByRole("button", { name: /Withdraw/ }), "somebody who entered cannot withdraw").toBeVisible();

    // ── full: the next one waits ────────────────────────────────────────────
    let d = await card(theirs);
    await expect(d, "a full tournament does not say it is full").toContainText("Full — waiting list open");
    await expect(d.getByRole("button", { name: /^Enter this tournament/ }), "a full tournament still offers a place").toHaveCount(0);
    await d.getByRole("button", { name: /^Join the waiting list/ }).click();
    await expect(d, "the member is not told they are waiting").toContainText(/You(’|')re on the waiting list/, { timeout: 20_000 });
    expect(await field(), "CONTROL: a full field took a third player, or the wait was not recorded").toEqual(["holder:confirmed", "me:confirmed", "second:waitlisted"]);
    d = await card(theirs);
    await expect(d, "the list does not say they are waiting after a reload").toContainText(/You(’|')re on the waiting list/);

    // ── I withdraw: asked first, and told where the place goes ──────────────
    c = await card(mine);
    await c.getByRole("button", { name: /Withdraw/ }).click();
    const asking = c.getByRole("group", { name: `Withdraw from ${NAME}` });
    await expect(asking, "withdrawing does not ask first").toContainText("your place goes to the next person on the waiting list");
    expect(await field(), "one press withdrew an entry without asking").toEqual(["holder:confirmed", "me:confirmed", "second:waitlisted"]);
    await asking.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(c.getByRole("status"), "the member is not told they have withdrawn").toContainText(/You(’|')ve withdrawn/, { timeout: 20_000 });

    // ── and the place goes to the one waiting ───────────────────────────────
    await expect
      .poll(async () => (await field()).filter((f) => f.endsWith(":confirmed")), { timeout: 20_000, message: "the place did not go to the member on the waiting list" })
      .toEqual(["holder:confirmed", "second:confirmed"]);
    expect((await field()).filter((f) => f.startsWith("me:")), "I am still in the field after withdrawing").not.toContain("me:confirmed");
    d = await card(theirs);
    await expect(d, "the promoted member is still told they are waiting").not.toContainText(/waiting list — the/);
    await expect(d.getByRole("button", { name: /^Join the waiting list|^Enter this tournament/ }), "the promoted member is offered Enter again").toHaveCount(0);
    await expect(d.getByRole("button", { name: /Withdraw/ }), "the promoted member is not shown as entered").toBeVisible();
    c = await card(mine);
    await expect(c, "the list does not say the tournament is full again").toContainText("Full — waiting list open");

    expect(errors, "a screen threw").toEqual([]);
  } finally {
    await Promise.all([first, other].map((x) => x.close()));
  }
});
