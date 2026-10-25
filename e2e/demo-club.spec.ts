import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { landingSettled } from "./landing-settled";
import { signedInNow } from "../scripts/session-cookie.mjs";
import { E2E_OWNER_EMAIL } from "./owner-email.mjs";
import { demoTestClubName, demoTestMark, E2E_DEMO_REPLAY_TOKEN, removeDemoClub } from "./demo-fixture.mjs";

/**
 * THE DEMO CLUB, AS THE PEOPLE WHO USE IT USE IT (2026-10-24; docs/claude/demo-club.md).
 *
 *   somebody who is not the owner      /owner is not there for them, and no demo is built
 *   the owner                          presses "Create the demo club" on /owner, then presses
 *                                      it again as "Refresh": one club, the same two boards
 *   a signed-out visitor               follows "See a demo club's day" from the front door and
 *                                      finds "Demo club, invented players" on the demo page,
 *                                      the board, the event page, the clubhouse screen, the
 *                                      finished championship's event page and its report — and
 *                                      every one of them tells a crawler to keep out
 *   the replay (the scheduler)         is refused without its token; with it, it plays the
 *                                      cards up to the club's present minute
 *
 * THIS SERVER'S DEMO IS THIS WORKTREE'S OWN: playwright.config.ts gives the server
 * `DEMO_CLUB_MARK`, so the owner's press builds a `zz-demo` club, which the `finally`
 * removes. Never the bare demo a visitor watches.
 *
 * What it cannot see: the clock. The replay's board at two clock times is held in
 * `the-demo-club.audit.test.ts`, which can choose the instant; here the server's own
 * minute decides, and the step says so when it is before eight o'clock at the club.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const MARK = demoTestMark();
const CLUB = demoTestClubName(MARK);
const STRANGER = "zz-demo-club-stranger@example.invalid";
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
const cookies = { owner: "", stranger: "" };

async function cleanup() {
  await removeDemoClub(prisma, MARK);
  await prisma.user.deleteMany({ where: { email: { in: [E2E_OWNER_EMAIL, STRANGER] } } });
}

test.beforeAll(async () => {
  await cleanup();
  const owner = await prisma.user.create({ data: { email: E2E_OWNER_EMAIL, name: "Zz Owner", password: "x:unusable", emailVerifiedAt: new Date() } });
  const stranger = await prisma.user.create({ data: { email: STRANGER, name: "Zz Stranger", password: "x:unusable", emailVerifiedAt: new Date() } });
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

const demoClubs = () => prisma.organization.findMany({ where: { name: CLUB, isDemo: true }, select: { id: true } });

/** The page carries the demo's label where a visitor reads it, and keeps crawlers out. */
async function isLabelledDemo(page: Page, what: string) {
  await expect(page.locator("[data-demo-club]").first(), `${what}: no demo label`).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("[data-demo-club]").first(), what).toContainText("Demo club, invented players");
  const robots = await page.locator('meta[name="robots"]').getAttribute("content");
  expect(robots ?? "", `${what}: a crawler may index it`).toContain("noindex");
}

test("somebody who is not the owner finds no demo button, and builds nothing", async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: "ng_session", value: cookies.stranger, url: baseURL! }]);
  const res = await page.goto(`/owner?bust=${Date.now()}`);
  expect(res?.status(), "the owner console answered somebody else").toBe(404);
  expect(await demoClubs()).toHaveLength(0);
});

test("the owner creates the demo club, then refreshes it: one club, the same two boards", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "owner");
  await page.context().addCookies([{ name: "ng_session", value: cookies.owner, url: baseURL! }]);
  await page.goto(`/owner?bust=${Date.now()}`);
  const card = page.locator("#demo-club");
  await expect(card).toContainText("Not built yet");

  await card.getByRole("button", { name: "Build the demo club" }).click();
  expect(await demoClubs(), "one press built it without asking").toHaveLength(0);
  await card.getByRole("button", { name: "Yes, build it" }).click();
  await expect(card.getByRole("status")).toContainText("The demo club is built", { timeout: 60_000 });
  const built = await demoClubs();
  expect(built, "the press did not build this worktree's own demo — is DEMO_CLUB_MARK set on the server?").toHaveLength(1);
  const events = await prisma.event.findMany({ where: { organizationId: built[0].id }, select: { shareToken: true, status: true }, orderBy: { status: "asc" } });
  expect(events.map((e) => e.status)).toEqual(["completed", "live"]);

  await page.goto(`/owner?bust=${Date.now()}`);
  await expect(page.locator("#demo-club")).toContainText("Built");
  await page.locator("#demo-club").getByRole("button", { name: "Build the demo club again from nothing" }).click();
  await page.locator("#demo-club").getByRole("button", { name: "Yes, rebuild it" }).click();
  await expect(page.locator("#demo-club").getByRole("status")).toContainText("The demo club is built", { timeout: 60_000 });
  const again = await demoClubs();
  expect(again.map((c) => c.id), "a refresh made a second club").toEqual(built.map((c) => c.id));
  const after = await prisma.event.findMany({ where: { organizationId: built[0].id }, select: { shareToken: true } });
  expect(after.map((e) => e.shareToken).sort(), "a refresh moved the boards' addresses").toEqual(events.map((e) => e.shareToken).sort());
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a signed-out visitor follows “See a demo club’s day” and every demo page says it is the demo", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  watchPageErrors(page, errors, "visitor");
  try {
    await page.goto(`/?bust=${Date.now()}`);
    await landingSettled(page);
    const button = page.getByRole("link", { name: "See a demo club’s day" });
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await expect(page).toHaveURL(/\/demo$/);
    await isLabelledDemo(page, "the demo page");

    const pages: Array<[string, RegExp]> = [
      ["The board", /\/live\/[^/?]+$/],
      ["The event page", /\/live\/[^/?]+\/event$/],
      ["The clubhouse screen", /\/live\/[^/?]+\?screen=clubhouse$/],
    ];
    for (const [link, url] of pages) {
      await page.goto(`/demo?bust=${Date.now()}`);
      await page.locator(".dm-card").first().getByRole("link", { name: link }).click();
      await expect(page, link).toHaveURL(url);
      await isLabelledDemo(page, link);
    }
    // The finished championship: its event page in the "afterwards" state, then its report.
    await page.goto(`/demo?bust=${Date.now()}`);
    await page.locator(".dm-card").nth(1).getByRole("link", { name: "The event page" }).click();
    await isLabelledDemo(page, "the finished event page");
    await expect(page.getByText("Finished", { exact: true }), "the event page is not in its afterwards state").toBeVisible();
    await page.getByRole("link", { name: "Read the final report" }).click();
    await expect(page).toHaveURL(/\/report$/);
    await isLabelledDemo(page, "the final report");
    await expect(page.locator("h1")).toContainText("Quillstone Autumn Championship");
    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test("the replay is shut without its token, and with it plays the cards up to the club's minute", async ({ request }) => {
  const shut = await request.get("/api/cron/demo-replay");
  expect(shut.status()).toBe(401);
  const wrong = await request.get("/api/cron/demo-replay", { headers: { authorization: "Bearer not-the-token" } });
  expect(wrong.status()).toBe(401);

  const [club] = await demoClubs();
  const today = await prisma.event.findFirstOrThrow({ where: { organizationId: club.id, status: "live" }, select: { id: true } });
  await prisma.scorecard.deleteMany({ where: { eventId: today.id } });

  const res = await request.get("/api/cron/demo-replay", { headers: { authorization: `Bearer ${E2E_DEMO_REPLAY_TOKEN}` } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok, JSON.stringify(body)).toBe(true);

  // What the club's clock says is due now, worked out here by the rule (threes, 30 minutes apart from
  // 8:00, a hole every 14 minutes), not by asking the app.
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "numeric", minute: "numeric" }).formatToParts(new Date());
  const minute = Number(parts.find((p) => p.type === "hour")?.value) * 60 + Number(parts.find((p) => p.type === "minute")?.value);
  const due = Array.from({ length: 8 }, (_, g) => Math.max(0, Math.min(18, Math.floor((minute - (480 + 30 * g)) / 14))));
  const expected = due.reduce((n, d) => n + d * 3, 0);
  if (expected === 0) {
    console.log("NOT WALKED: it is before the first group has finished a hole at the demo club; nothing was due.");
  }
  const cards = await prisma.scorecard.findMany({ where: { eventId: today.id }, select: { strokes: true } });
  const holes = cards.reduce((n, c) => n + (JSON.parse(c.strokes) as (number | null)[]).filter((s) => typeof s === "number").length, 0);
  // Within one minute's turn of the clock between the reading here and the server's.
  expect(Math.abs(holes - expected), `holes written ${holes}, due by the club's clock ${expected}`).toBeLessThanOrEqual(3);
});
