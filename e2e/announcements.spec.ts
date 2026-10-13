import { test, expect, type Page } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * A NOTICE: POSTED, PINNED ABOVE THE ROUND, UNPINNED, AND TAKEN DOWN.
 *
 * "Frost delay — first tee moved to 9:30" is the message a committee most
 * needs every player to see, and pinning is how it says so: the Announcements
 * screen promises that a pinned post sits at the top of every player's Today.
 * `messages.spec` walks posting and reading. Pinning and deleting —
 * `toggleAnnouncementPin`, `removeAnnouncement` — were performed by no browser
 * test (round 1 on the frozen app, 2026-10-13), so nothing had ever checked
 * the promise from the player's side.
 *
 * WHERE a notice sits is the whole of what pinning means, so that is what is
 * read: on a player's Today, is the notice above their card or below it.
 *
 *   a notice with no title           → refused in words, nothing posted (control)
 *   posted, not pinned               → on the player's Today, BELOW their card
 *   pinned                           → ABOVE their card
 *   unpinned                         → below it again
 *   deleted                          → asked first; then gone from the player's Today
 *
 * WHAT IT CANNOT SEE: a push notification about it. That needs a real phone.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string };
const ORGANIZER = join(process.cwd(), ".e2e", "organizer.json");
const PLAYER = join(process.cwd(), ".e2e", "player.json");
const MARK = "zz-notice";
const TITLE = `${MARK} Frost delay`;
const prisma = new PrismaClient();
const sweep = () => prisma.announcement.deleteMany({ where: { eventId: data.eventId, title: { startsWith: MARK } } });
test.afterAll(async () => {
  await sweep();
  await prisma.$disconnect();
});
const notice = () => prisma.announcement.findFirst({ where: { eventId: data.eventId, title: TITLE } });

/** Where the notice is on a player's Today, against their card: "above", "below", or "absent". */
async function onToday(page: Page): Promise<"above" | "below" | "absent"> {
  await page.goto(`/me?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const more = page.locator("summary", { hasText: /^More:/ });
  if (await more.count()) await more.first().click();
  // A notice this player has already read is folded into "N earlier messages": still there, one tap away.
  const earlier = page.locator("summary", { hasText: /earlier messages?$/ });
  if (await earlier.count()) await earlier.first().click();
  const text = await page.locator("main").innerText();
  const at = text.indexOf(TITLE);
  if (at < 0) return "absent";
  const card = text.search(/your card/i);
  expect(card, `the player's Today has no card to be above or below:\n${text.slice(0, 400)}`).toBeGreaterThanOrEqual(0);
  return at < card ? "above" : "below";
}

test("a notice is posted, pinned above a player's round, unpinned and deleted — and the player's Today follows", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const device = testInfo.project.use;
  await sweep();
  const organizer = await browser.newContext({ ...device, baseURL, storageState: ORGANIZER });
  const member = await browser.newContext({ ...device, baseURL, storageState: PLAYER });
  try {
    const desk = await organizer.newPage();
    const phone = await member.newPage();
    watchPageErrors(desk, errors);
    watchPageErrors(phone, errors);
    const board = async () => {
      await desk.goto(`/announcements?bust=${Date.now()}`);
      await desk.waitForLoadState("networkidle").catch(() => {});
    };

    // ── no title: nothing is posted ─────────────────────────────────────────
    await board();
    const before = await prisma.announcement.count({ where: { eventId: data.eventId } });
    await desk.getByLabel("Message (optional)").fill("First tee moved to 9:30.");
    await desk.getByRole("button", { name: "Post", exact: true }).click();
    await expect(desk.locator("#announcement-refusal"), "a notice with no title is not refused in words").toBeVisible();
    expect(await prisma.announcement.count({ where: { eventId: data.eventId } }), "CONTROL: a notice with no title was posted").toBe(before);

    // ── posted, not pinned: below the card ──────────────────────────────────
    await desk.getByLabel("Title").fill(TITLE);
    await desk.getByRole("button", { name: "Post", exact: true }).click();
    await expect.poll(notice, { timeout: 20_000, message: "the notice was not stored" }).not.toBeNull();
    expect(await notice()).toMatchObject({ title: TITLE, body: "First tee moved to 9:30.", pinned: false });
    expect(await onToday(phone), "a notice that is not pinned is not under the player's round").toBe("below");

    // ── pinned: above it ────────────────────────────────────────────────────
    await board();
    await desk.getByRole("button", { name: `Pin “${TITLE}”` }).click();
    await expect.poll(async () => (await notice())?.pinned, { timeout: 20_000, message: "the pin was not stored" }).toBe(true);
    expect(await onToday(phone), "a pinned notice is not above the player's round, which is what pinning promises").toBe("above");

    // ── unpinned: below again ───────────────────────────────────────────────
    await board();
    await desk.getByRole("button", { name: `Unpin “${TITLE}”` }).click();
    await expect.poll(async () => (await notice())?.pinned, { timeout: 20_000, message: "the unpin was not stored" }).toBe(false);
    expect(await onToday(phone), "an unpinned notice stayed above the round").toBe("below");

    // ── deleted: asked first ────────────────────────────────────────────────
    await board();
    await desk.getByRole("button", { name: `Delete “${TITLE}”` }).click();
    expect(await notice(), "one press deleted a notice without asking").not.toBeNull();
    await desk.getByRole("button", { name: "Delete it" }).click();
    await expect.poll(notice, { timeout: 20_000, message: "the notice was not deleted" }).toBeNull();
    expect(await onToday(phone), "a deleted notice is still on a player's Today").toBe("absent");

    expect(errors, "a screen threw").toEqual([]);
  } finally {
    await Promise.all([organizer, member].map((c) => c.close()));
  }
});
