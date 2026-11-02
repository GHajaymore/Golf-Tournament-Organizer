import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * ONE "SETTING UP" STEP BEFORE LAUNCH (Ajay, 2026-10-31, gap G1), as the organizer meets it.
 *
 * A draft medal with players in it and no dates. Until this day its dashboard said "Draft"
 * and offered "Start taking entries", then "Mark ready", then Launch. Now:
 *
 *   - the status reads "Setting up", and neither old button is anywhere on the page;
 *   - the one button is Launch tournament, refused in place with the gate's reason
 *     (no dates) while setup cannot launch;
 *   - with the dates set, the same button launches it.
 *
 * Marked zz-, one club per screen size, deleted afterwards. WHAT IT CANNOT SEE: the other
 * two stored values (`registration`, `ready`), which read the same — held by
 * `render.test.tsx` and `one-setting-up-step.audit.test.ts`.
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
const PARS = new Array(18).fill(4);
const NO_DATES = "This tournament has no dates, so nobody can plan around it.";

test("a draft with players says Setting up and offers Launch, refused in place while setup is open", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const size = testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase();
  const email = `zz-settingup-${size}@example.invalid`;
  const ids = { user: "", org: "", event: "" };
  const errors: string[] = [];
  const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] } });
  const status = async () => (await prisma.event.findUniqueOrThrow({ where: { id: ids.event } })).status;
  try {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.organization.deleteMany({ where: { name: `zz-settingup club ${size}` } });
    const user = await prisma.user.create({ data: { email, name: "Zz Setting Up Organizer", password: "x:unusable", emailVerifiedAt: new Date() } });
    ids.user = user.id;
    const org = await prisma.organization.create({
      data: {
        name: `zz-settingup club ${size}`, kind: "club", timeZone: "America/New_York", locale: "en-US", moneyMode: "none",
        members: { create: { userId: user.id, role: "owner" } },
      },
    });
    ids.org = org.id;
    const event = await prisma.event.create({
      data: {
        organizationId: org.id, name: `zz-settingup medal ${size}`, dates: "", course: "Home", city: "", address: "", regDeadline: "",
        status: "draft", shareToken: `zz-settingup-${size}-${Date.now()}`, configUnlocked: true,
        customPars: JSON.stringify(PARS), customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
        customYards: JSON.stringify(new Array(18).fill(400)),
      },
    });
    ids.event = event.id;
    await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross" } });
    for (const [i, name] of ["Wren Halloway", "Ostin Pell", "Marla Quince"].entries()) {
      await prisma.player.create({ data: { eventId: event.id, name, email: `zz-settingup-${i}-${size}@example.invalid`, handicap: 10, seed: i + 1, status: "confirmed" } });
    }
    await prisma.account.create({ data: { eventId: event.id, email, name: "Zz Setting Up Organizer", role: "admin" } });
    await ctx.addCookies([
      { name: "ng_session", value: sign(signedInNow(user.id)), url: baseURL! },
      { name: "ng_active_event", value: sign(event.id), url: baseURL! },
    ]);

    const page = await ctx.newPage();
    watchPageErrors(page, errors);
    await page.goto(`/dashboard?bust=${Date.now()}`);
    const launch = page.getByRole("button", { name: "Launch tournament" }).first();
    await expect(launch, "Launch tournament is not the draft's button").toBeVisible({ timeout: 30_000 });

    // One step: "Setting up", and the ladder's buttons are gone.
    await expect(page.getByText("Setting up", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Start taking entries" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mark ready" })).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("Start taking entries");

    // Refused in place while setup cannot launch, with the gate's reason.
    await expect(launch).toBeDisabled();
    await expect(launch).toHaveAttribute("title", new RegExp(`^${NO_DATES.replace(/[.]/g, "[.]")}`));
    await expect(page.getByText(NO_DATES).first()).toBeVisible();
    expect(await status(), "refusing changed the tournament").toBe("draft");

    // The dates set, the same button launches it — straight from draft.
    await prisma.event.update({ where: { id: event.id }, data: { dates: "Nov 14–15" } });
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await expect(launch).toBeEnabled({ timeout: 30_000 });
    await launch.click();
    await page.getByRole("dialog").getByRole("button", { name: "Launch tournament" }).click();
    await expect.poll(status, { timeout: 20_000, message: "Launch did not launch the draft" }).toBe("live");
    await expect(page.getByRole("button", { name: "Complete tournament" })).toBeVisible({ timeout: 30_000 });
    expect(errors).toEqual([]);
  } finally {
    await ctx.close().catch(() => {});
    if (ids.org) await prisma.organization.deleteMany({ where: { id: ids.org } });
    if (ids.event) await prisma.event.deleteMany({ where: { id: ids.event } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
  }
});
