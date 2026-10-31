import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * LAUNCH READS SETUP (gap G3, 2026-10-31), as the organizer meets it.
 *
 * A scramble ready to launch, with four players entered and no sides made. Until this
 * day Launch went through over it. Now, on the dashboard:
 *
 *   - Launch tournament is disabled, and the reason is said in place, naming Teams & pairs;
 *   - nothing changes in the database;
 *   - once the sides are made, Launch opens its dialog, which lists FIRST what is still
 *     open (no name, no flights, no money answer, no tee sheet) with the rail's own count;
 *     two as rows with a link each, and the other two named inline on the third row, each
 *     its own link to its own screen — never a catch-all — and the same press launches.
 *
 * Marked zz-, one club per screen size, deleted afterwards. WHAT IT CANNOT SEE: the cup
 * and round-robin refusals (held by `launch-check.test.ts`), and a page left open while
 * the sides are removed, which the action refuses in the same words
 * (`launch-reads-setup.audit.test.ts`).
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
const PARS = new Array(18).fill(4);
const NO_SIDES = "This tournament is played in sides and none are made yet, so its team rounds cannot be scored.";

test("launch is refused in place for a scramble with no sides, and warns about the rest once it can go", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const size = testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase();
  const email = `zz-launchsetup-${size}@example.invalid`;
  const ids = { user: "", org: "", event: "" };
  const players: string[] = [];
  const errors: string[] = [];
  const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] } });
  const status = async () => (await prisma.event.findUniqueOrThrow({ where: { id: ids.event } })).status;
  try {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.organization.deleteMany({ where: { name: `zz-launchsetup club ${size}` } });
    const user = await prisma.user.create({ data: { email, name: "Zz Launch Organizer", password: "x:unusable", emailVerifiedAt: new Date() } });
    ids.user = user.id;
    const org = await prisma.organization.create({
      data: {
        name: `zz-launchsetup club ${size}`, kind: "club", timeZone: "America/New_York", locale: "en-US",
        members: { create: { userId: user.id, role: "owner" } },
      },
    });
    ids.org = org.id;
    const event = await prisma.event.create({
      data: {
        // "New Tournament" is the placeholder a blank name falls back to: not named yet,
        // which makes the fourth warning, so the dialog folds its third row.
        organizationId: org.id, name: "New Tournament", dates: "Nov 14–15", course: "Home", city: "", address: "", regDeadline: "",
        status: "ready", shareToken: `zz-launchsetup-${size}-${Date.now()}`, configUnlocked: true,
        customPars: JSON.stringify(PARS), customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
        customYards: JSON.stringify(new Array(18).fill(400)),
      },
    });
    ids.event = event.id;
    await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Scramble", holes: 18, scoringBasis: "gross" } });
    for (const [i, name] of ["Wren Halloway", "Ostin Pell", "Marla Quince", "Teo Varga"].entries()) {
      const p = await prisma.player.create({
        data: { eventId: event.id, name, email: `zz-launchsetup-${i}-${size}@example.invalid`, handicap: 10, seed: i + 1, status: "confirmed" },
      });
      players.push(p.id);
    }
    await prisma.account.create({ data: { eventId: event.id, email, name: "Zz Launch Organizer", role: "admin" } });
    await ctx.addCookies([
      { name: "ng_session", value: sign(signedInNow(user.id)), url: baseURL! },
      { name: "ng_active_event", value: sign(event.id), url: baseURL! },
    ]);

    const page = await ctx.newPage();
    watchPageErrors(page, errors);
    await page.goto(`/dashboard?bust=${Date.now()}`);

    // Refused in place: the button is disabled, and the reason names the screen.
    const launch = page.getByRole("button", { name: "Launch tournament" }).first();
    await expect(launch, "Launch tournament is not offered").toBeVisible({ timeout: 30_000 });
    await expect(launch, "Launch went through over a scramble with no sides").toBeDisabled();
    await expect(launch).toHaveAttribute("title", `${NO_SIDES} Make the sides on Teams & pairs, then launch.`);
    await expect(page.getByText(NO_SIDES).first()).toBeVisible();
    expect(await status(), "refusing changed the tournament").toBe("ready");

    // The sides are made: Launch opens, and the dialog lists what is still open, first.
    for (const [i, pair] of [players.slice(0, 2), players.slice(2)].entries()) {
      await prisma.team.create({ data: { eventId: event.id, name: `zz Side ${i + 1}`, members: { create: pair.map((playerId) => ({ playerId })) } } });
    }
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await expect(launch).toBeEnabled({ timeout: 30_000 });
    await launch.click();
    const dialog = page.getByRole("dialog");
    const open = dialog.getByRole("region", { name: "Still open" });
    await expect(open).toBeVisible({ timeout: 15_000 });
    await expect(open).toContainText(/\d of \d setup steps still open — you can launch without them\./);
    await expect(open).toContainText("There are no flights, so the whole field plays as one division.");
    await expect(open.getByRole("link", { name: "Make flights on Flights" })).toHaveAttribute("href", "/grouping");
    await expect(open).toContainText("after launch, this needs Unlock first.");
    await expect(open.getByRole("link", { name: "Give it one on Tournament details" })).toHaveAttribute("href", "/event");
    // Four warnings, three rows: the third names the other two inline, each its own link.
    await expect(open.locator("li")).toHaveCount(3);
    const also = open.locator("li").nth(2);
    await expect(also).toContainText("Also open:");
    await expect(also.getByRole("link", { name: "Prizes & payouts" })).toHaveAttribute("href", "/prizes");
    await expect(also.getByRole("link", { name: "Tee sheet" })).toHaveAttribute("href", "/foursomes");
    await expect(also.getByRole("link"), "the folded row carries a link that is not its own screen").toHaveCount(2);
    await expect(open, "a catch-all row came back").not.toContainText("more");
    // First in the dialog: above the summary.
    const [openTop, summaryTop] = await Promise.all([
      open.evaluate((el) => el.getBoundingClientRect().top),
      dialog.getByText("Registered players").evaluate((el) => el.getBoundingClientRect().top),
    ]);
    expect(openTop, "the warnings are not first in the dialog").toBeLessThan(summaryTop);

    await dialog.getByRole("button", { name: "Launch tournament" }).click();
    await expect.poll(status, { timeout: 20_000, message: "the same press did not launch it" }).toBe("live");
    expect(errors).toEqual([]);
  } finally {
    await ctx.close().catch(() => {});
    if (ids.org) await prisma.organization.deleteMany({ where: { id: ids.org } });
    if (ids.event) await prisma.event.deleteMany({ where: { id: ids.event } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
  }
});
