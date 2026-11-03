import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * THE SETUP CHECKLIST OUTLIVES THE FIRST ENTRANT (2026-10-31, gap G2 of the workflow review).
 *
 * It showed only while the field was empty, so an organizer who imported their players first lost
 * the setup guidance from the dashboard with the rounds still to do. As that organizer meets it:
 *
 *   - a tournament in draft with three players and no round: "Still to set up", with the step
 *     for Rounds & formats on it;
 *   - the same tournament once launched: no checklist.
 *
 * Marked zz-, one club per screen size, deleted afterwards. WHAT IT CANNOT SEE: which steps the
 * list holds for every format — that is `setupChecklist`'s and the flow's own tests.
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

test("the setup checklist stays on the dashboard after the field is in, until launch", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const size = testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase();
  const email = `zz-setup-${size}@example.invalid`;
  const ids = { user: "", org: "", event: "" };
  const errors: string[] = [];
  const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] } });
  try {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.organization.deleteMany({ where: { name: `zz-setup club ${size}` } });
    const user = await prisma.user.create({ data: { email, name: "Zz Setup Organizer", password: "x:unusable" } });
    ids.user = user.id;
    const org = await prisma.organization.create({
      data: { name: `zz-setup club ${size}`, kind: "club", timeZone: "Europe/London", locale: "en-GB", members: { create: { userId: user.id, role: "owner" } } },
    });
    ids.org = org.id;
    const event = await prisma.event.create({
      data: {
        organizationId: org.id, name: `zz-setup outing ${size}`, dates: "Saturday", course: "Home", city: "", address: "", regDeadline: "",
        status: "draft", shareToken: `zz-setup-${size}-${Date.now()}`,
        customPars: JSON.stringify(new Array(18).fill(4)), customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    });
    ids.event = event.id;
    for (const [i, name] of ["Wren Halloway", "Odile Marsh", "Tamsin Fair"].entries()) {
      await prisma.player.create({ data: { eventId: event.id, name, email: `zz-setup-p${i}-${size}@example.invalid`, seed: i + 1, status: "confirmed" } });
    }
    await prisma.account.create({ data: { eventId: event.id, email, name: "Zz Setup Organizer", role: "admin" } });
    await ctx.addCookies([
      { name: "ng_session", value: sign(signedInNow(user.id)), url: baseURL! },
      { name: "ng_active_event", value: sign(event.id), url: baseURL! },
    ]);

    const page = await ctx.newPage();
    watchPageErrors(page, errors);
    await page.goto(`/dashboard?bust=${Date.now()}`);
    const card = page.locator(".card").filter({ has: page.locator(".card-kicker", { hasText: "Still to set up" }) });
    await expect(card, "the checklist left the dashboard once the field was in").toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("The field is in.");
    await expect(card.getByRole("link", { name: /Rounds/ }).first(), "the open step for the rounds is not on it").toBeVisible();

    // Launched: setup is over, and the list goes.
    await prisma.event.update({ where: { id: event.id }, data: { status: "live" } });
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".card-kicker", { hasText: /Still to set up|Getting started/ }), "a launched tournament still shows the setup checklist").toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close().catch(() => {});
    if (ids.org) await prisma.organization.deleteMany({ where: { id: ids.org } });
    if (ids.event) await prisma.event.deleteMany({ where: { id: ids.event } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
  }
});
