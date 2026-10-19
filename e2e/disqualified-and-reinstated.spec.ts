import { test, expect, type Page } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * A PLAYER IS DISQUALIFIED, AND REINSTATED — AND EVERY SCREEN SAYS SO.
 *
 * A committee disqualifies somebody rarely, and gets it wrong sometimes: a
 * card signed for a lower score turns out to have been the marker's slip, and
 * the ruling is reversed. `reinstatePlayer` was performed by no browser test
 * (round 1 on the frozen app, 2026-10-13); the ruling itself only by the crawl
 * that presses every button, which reads nothing afterwards.
 *
 * Three people read a disqualification — the committee, the field, and the
 * player — and each screen is asked:
 *
 *   no reason given                 → the ruling cannot be made (the control:
 *                                     it goes on the record, so it has to say why)
 *   disqualified, with a reason     → the committee's list names them; the
 *                                     board everybody reads marks them DQ; and
 *                                     the player's own Today says they were
 *                                     disqualified — NOT that they never entered
 *   reinstated — asked first        → off the committee's list; no DQ on the
 *                                     board; the player's Today has their card back
 *
 * WHAT IT CANNOT SEE: what a disqualification does to a pot already paid. The
 * audit suite holds the money against the Rules.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string; shareToken: string; partialCard: { playerId: string } };
const ORGANIZER = join(process.cwd(), ".e2e", "organizer.json");
const PLAYER = join(process.cwd(), ".e2e", "player.json");
const meId = data.partialCard.playerId;
const prisma = new PrismaClient();
const REASON = "zz-dq Returned a score lower than actually taken (Rule 3.3b)";

/** The fixture's player is every later spec's: back in the field whatever happened here. */
test.afterAll(async () => {
  await prisma.player.updateMany({ where: { id: meId, status: "disqualified" }, data: { status: "confirmed" } });
  await prisma.$disconnect();
});
const status = async () => (await prisma.player.findUniqueOrThrow({ where: { id: meId }, select: { status: true } })).status;

/** The player's line on a board, as text — or "" when they are not on it. */
async function lineOn(page: Page, url: string, name: string): Promise<string> {
  await page.goto(`${url}${url.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const row = page.locator("tr, li", { hasText: name }).first();
  return (await row.count()) ? (await row.innerText()).replace(/\s+/g, " ").trim() : "";
}

test("a player is disqualified and reinstated, and the committee, the board and the player are each told", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const device = testInfo.project.use;
  const me = await prisma.player.findUniqueOrThrow({ where: { id: meId }, select: { name: true } });
  const organizer = await browser.newContext({ ...device, baseURL, storageState: ORGANIZER });
  const member = await browser.newContext({ ...device, baseURL, storageState: PLAYER });
  const anybody = await browser.newContext({ ...device, baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const desk = await organizer.newPage();
    const phone = await member.newPage();
    const world = await anybody.newPage();
    watchPageErrors(desk, errors, "organizer");
    watchPageErrors(phone, errors, "player");
    watchPageErrors(world, errors, "public");
    const panel = async () => {
      await desk.goto(`/registration?bust=${Date.now()}`);
      await desk.waitForLoadState("networkidle").catch(() => {});
      const p = desk.locator("section", { has: desk.locator(".card-title", { hasText: /^\s*Disqualification\s*$/ }) }).first();
      await expect(p, "the committee has nowhere to rule somebody out").toBeVisible();
      return p;
    };
    const today = async () => {
      await phone.goto(`/me?bust=${Date.now()}`);
      await phone.waitForLoadState("networkidle").catch(() => {});
      return (await phone.locator("main").innerText()).replace(/\s+/g, " ");
    };

    expect(await status()).toBe("confirmed");
    expect(await lineOn(world, `/live/${data.shareToken}`, me.name), "CONTROL: the player is marked DQ before anybody ruled").not.toMatch(/\bDQ\b/);

    // ── no reason: no ruling ────────────────────────────────────────────────
    let p = await panel();
    await p.getByLabel("Player").selectOption({ label: me.name });
    await expect(p.getByRole("button", { name: "Disqualify", exact: true }), "CONTROL: somebody can be disqualified with no reason on the record").toBeDisabled();

    // ── disqualified ────────────────────────────────────────────────────────
    await p.getByLabel("Reason (goes on the record)").fill(REASON);
    // The button and the one that confirms it carry the same word: pressed once to ask, once to do.
    await p.getByRole("button", { name: "Disqualify", exact: true }).click();
    expect(await status(), "one press disqualified somebody without asking").toBe("confirmed");
    await p.getByRole("button", { name: "Disqualify", exact: true }).click();
    await expect.poll(status, { timeout: 20_000, message: "the ruling was not stored" }).toBe("disqualified");
    // Polled, not read once: the action stores the ruling and THEN writes its audit line, so the
    // status above can be read in the moment between the two (CI, 2026-10-17, phone).
    await expect
      .poll(
        async () =>
          (await prisma.auditLog.findFirst({ where: { eventId: data.eventId, detail: { contains: "zz-dq" } }, orderBy: { createdAt: "desc" } }))?.detail ?? "",
        { timeout: 20_000, message: "the reason is not on the record" },
      )
      .toContain(REASON);

    p = await panel();
    await expect(p.getByRole("list", { name: "Disqualified" }), "the committee's own list does not name who it ruled out").toContainText(me.name);
    expect(await lineOn(world, `/live/${data.shareToken}`, me.name), "the public board does not mark a disqualified player DQ").toMatch(/\bDQ\b/);
    expect(await lineOn(phone, "/me/board", me.name), "the player's own Board does not mark them DQ").toMatch(/\bDQ\b/);
    const told = await today();
    expect(told, "a disqualified player is not told so on their Today").toContain("You were disqualified from this tournament");
    expect(told, "a disqualified player is told they never entered").not.toMatch(/aren(’|')t entered|not in this tournament/i);

    // ── reinstated: asked first ─────────────────────────────────────────────
    const listed = p.getByRole("list", { name: "Disqualified" }).locator("li", { hasText: me.name });
    await listed.getByRole("button", { name: "Reinstate", exact: true }).click();
    expect(await status(), "one press reinstated somebody without asking").toBe("disqualified");
    await listed.getByRole("button", { name: "Reinstate", exact: true }).click();
    await expect.poll(status, { timeout: 20_000, message: "the reinstatement was not stored" }).toBe("confirmed");

    p = await panel();
    await expect(p.getByRole("list", { name: "Disqualified" }).locator("li", { hasText: me.name }), "a reinstated player is still on the committee's list").toHaveCount(0);
    expect(await lineOn(world, `/live/${data.shareToken}`, me.name), "the public board still marks a reinstated player DQ").not.toMatch(/\bDQ\b/);
    expect(await lineOn(phone, "/me/board", me.name), "the player's own Board still marks them DQ").not.toMatch(/\bDQ\b/);
    const back = await today();
    expect(back, "a reinstated player is still told they were disqualified").not.toContain("You were disqualified");
    expect(back, "a reinstated player's card has not come back").toMatch(/your card/i);

    expect(errors, "a screen threw").toEqual([]);
  } finally {
    await Promise.all([organizer, member, anybody].map((c) => c.close()));
  }
});
