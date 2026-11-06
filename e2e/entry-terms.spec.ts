import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { clubToday } from "../src/lib/domain/club-clock";

/**
 * THE ENTRY TERMS ARE ONE CARD ON ENTRIES: OPEN, CLOSE, WHEN, HOW MANY.
 *
 * The entries cleanup (5 Nov 2026, setup audit items 1 and 2). The window and
 * the number were set on Tournament details while the sign-up link and approval
 * were on Entries, which showed the deadline read-only and sent the organizer
 * back; five controls answered "are entries open?". Now, as the secretary:
 *
 *   Tournament details              → no deadline, no capacity, and a line saying they are on Entries
 *   Entries                          → "Not open", with ONE button, Open entries
 *   set the window and the places    → Save entry terms stores them (the CLUB'S day, never the server's)
 *   a window that closes before it opens → refused in words, nothing stored
 *   Open entries                     → the sign-up link exists and is shown; the button is now Close entries
 *   Close entries                    → closed by the organizer; the link is kept; the button is Reopen entries
 *   Reopen entries                   → open again
 *
 * `saveEntryTerms` and `setEntriesOpen` are pressed here, by the person who would.
 * WHAT IT CANNOT SEE: a member's list (entry-needs-approval walks that side).
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string };
const MARK = "zz-terms";
const NAME = `${MARK} Spring Outing`;
const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

let eventId = "";

/** A day at the CLUB that owns the fixture, offset from its today. */
async function clubDayPlus(offset: number) {
  const home = await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { organization: { select: { timeZone: true } } } });
  const base = new Date(`${clubToday(home.organization?.timeZone ?? "")}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString().slice(0, 10);
}

async function sweep() {
  await prisma.event.deleteMany({ where: { name: { startsWith: MARK } } });
}

test.beforeAll(async () => {
  await sweep();
  const home = await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { organizationId: true, courseId: true, course: true, city: true } });
  const event = await prisma.event.create({
    data: {
      name: NAME,
      organizationId: home.organizationId,
      status: "draft",
      shape: "single",
      format: "stroke",
      dates: "",
      course: home.course,
      city: home.city,
      address: "",
      courseId: home.courseId,
      shareToken: `${MARK}-token`,
      registrationOpen: false,
      registrationToken: "",
      regOpens: "",
      regDeadline: "",
      capacity: 0,
    },
  });
  eventId = event.id;
  const runs = await prisma.account.findFirstOrThrow({ where: { eventId: data.eventId, role: "admin" }, select: { name: true, email: true } });
  await prisma.account.create({ data: { eventId, name: runs.name, email: runs.email, role: "admin" } });
});
test.afterAll(async () => {
  await sweep();
  await prisma.$disconnect();
});

const stored = () =>
  prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { regOpens: true, regDeadline: true, capacity: true, registrationOpen: true, registrationOverride: true, registrationToken: true },
  });

test("the secretary sets the entry terms and opens, closes and reopens entries from one card on Entries", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const organizer = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: join(process.cwd(), ".e2e", "organizer.json") });
  await organizer.clearCookies({ name: "ng_active_event" });
  await organizer.addCookies([{ name: "ng_active_event", value: sign(eventId), url: baseURL! }]);
  try {
    const page = await organizer.newPage();
    watchPageErrors(page, errors, "organizer");
    const entries = async () => {
      await page.goto(`/registration?bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(page.locator("body"), "the organizer is looking at another tournament").toContainText(NAME);
    };
    const opens = await clubDayPlus(1);
    const closes = await clubDayPlus(20);

    await test.step("Tournament details no longer asks for the entry window or the places", async () => {
      await page.goto(`/event?bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(page.getByLabel("Tournament name")).toBeVisible();
      await expect(page.getByText("Registration deadline"), "the deadline is still asked on Tournament details").toHaveCount(0);
      await expect(page.getByText("Field capacity"), "the capacity is still asked on Tournament details").toHaveCount(0);
      await expect(page.getByRole("link", { name: "Entries", exact: true }).first()).toBeVisible();
    });

    await test.step("Entries says Not open and offers ONE button", async () => {
      await entries();
      const card = page.getByRole("region", { name: "Entry terms" });
      await expect(card).toContainText("Not open");
      await expect(card.getByRole("button", { name: "Open entries" })).toBeVisible();
      await expect(card.getByRole("button", { name: /Close entries|Reopen entries/ }), "a second switch is on the card").toHaveCount(0);
      await expect(page.getByRole("button", { name: /Publish the link|Close registration/ }), "an old switch is still on the screen").toHaveCount(0);
    });

    await test.step("a window that closes before it opens is refused, and nothing is stored", async () => {
      const card = page.getByRole("region", { name: "Entry terms" });
      await card.getByLabel("Entries open").fill(closes);
      await card.getByLabel("Entries close").fill(opens);
      await card.getByRole("button", { name: "Save entry terms" }).click();
      await expect(card.getByRole("alert"), "the refusal is not said beside the button").toContainText("cannot close before they open", { timeout: 20_000 });
      const row = await stored();
      expect(row.regOpens, "a refused window was stored").toBe("");
      expect(row.regDeadline, "a refused window was stored").toBe("");
    });

    await test.step("the terms are saved together, as the club's days", async () => {
      const card = page.getByRole("region", { name: "Entry terms" });
      await card.getByLabel("Entries open").fill(opens);
      await card.getByLabel("Entries close").fill(closes);
      // The option is drawn invisible: press its label, then read the radio.
      await card.locator("label.seg-opt", { hasText: "Fixed" }).click();
      await expect(card.getByRole("radio", { name: "Fixed" })).toBeChecked();
      await card.getByLabel("Places in the field (players)").fill("12");
      await card.getByRole("button", { name: "Save entry terms" }).click();
      await expect(card.getByRole("button", { name: "Saved" })).toBeVisible({ timeout: 20_000 });
      const row = await stored();
      expect([row.regOpens, row.regDeadline, row.capacity], "the terms were not stored").toEqual([opens, closes, 12]);
      // It comes back from the database, not from the page's memory.
      await entries();
      const again = page.getByRole("region", { name: "Entry terms" });
      await expect(again.getByLabel("Entries close")).toHaveValue(closes);
      await expect(again.getByLabel("Places in the field (players)")).toHaveValue("12");
    });

    await test.step("the first Open entries publishes the link and the dates still rule: Opens soon, the closing day kept", async () => {
      const card = page.getByRole("region", { name: "Entry terms" });
      // The window opens tomorrow.
      await card.getByRole("button", { name: "Open entries" }).click();
      await expect(card.getByRole("button", { name: "Open entries now" })).toBeVisible({ timeout: 20_000 });
      await expect(card).toContainText("Opens soon");
      const row = await stored();
      expect(row.registrationOpen, "the sign-up link was not published").toBe(true);
      expect(row.registrationToken.length, "the link has no address").toBeGreaterThan(10);
      expect(row.registrationOverride, "publishing must not switch the dates off").toBeNull();
      expect([row.regOpens, row.regDeadline], "publishing changed the window").toEqual([opens, closes]);
    });

    await test.step("Open entries now clears the opening day and KEEPS the closing day", async () => {
      const card = page.getByRole("region", { name: "Entry terms" });
      await card.getByRole("button", { name: "Open entries now" }).click();
      await expect(card.getByRole("button", { name: "Close entries" })).toBeVisible({ timeout: 20_000 });
      const row = await stored();
      expect(row.regOpens, "the opening day was not cleared").toBe("");
      expect(row.regDeadline, "opening early dropped the closing day").toBe(closes);
      expect(row.registrationOverride, "opening early must not set the extend-past-the-deadline override").toBeNull();
      await expect(card.getByLabel("Entries close")).toHaveValue(closes);
      // The link panel opens itself a moment after entries open; read it once it is drawn.
      const readLink = () => page.locator("input").evaluateAll((els) => (els as HTMLInputElement[]).map((e) => e.value).find((v) => v.includes("/register/")) ?? "");
      await expect.poll(readLink, { timeout: 20_000, message: "the sign-up link is not shown once entries are open" }).toContain(row.registrationToken);
    });

    await test.step("Close entries closes; the link is kept; Reopen entries opens again", async () => {
      const card = page.getByRole("region", { name: "Entry terms" });
      const token = (await stored()).registrationToken;
      await card.getByRole("button", { name: "Close entries" }).click();
      await expect(card.getByRole("button", { name: "Reopen entries" })).toBeVisible({ timeout: 20_000 });
      await expect(card).toContainText("Closed");
      const shut = await stored();
      expect(shut.registrationOverride, "closing did not close").toBe(true);
      expect(shut.registrationToken, "closing replaced the link").toBe(token);
      await card.getByRole("button", { name: "Reopen entries" }).click();
      await expect(card.getByRole("button", { name: "Close entries" })).toBeVisible({ timeout: 20_000 });
      expect((await stored()).registrationToken, "reopening replaced the link").toBe(token);
    });

    expect(errors, "a screen threw").toEqual([]);
  } finally {
    await organizer.close();
  }
});
