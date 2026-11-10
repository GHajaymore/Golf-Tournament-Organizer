import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * CLOSING A ROUND IN AN ARCHIVE IS REFUSED IN WORDS, NOT BY THE ERROR SCREEN (2026-11-09).
 *
 * A lapsed paid club's tournament is read-only (`a-lapsed-club-is-read-only.spec.ts`
 * is the same club pressing Complete). Here the round's one card is in and approved, so
 * the dashboard draws "The round is ready to close"; the organizer presses Close the
 * round and confirms. `setRoundClosed` used to let the archive's refusal be thrown,
 * which a production build shows as "This screen didn't load". It must come back as
 * the archive's sentence under the button, the round must stay open, and no page error
 * may be raised.
 *
 * Marked zz-, one club per screen size, deleted afterwards.
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

test("pressing Close the round in an archived tournament says why, in words", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const size = testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase();
  const email = `zz-archive-close-${size}@example.invalid`;
  const ids = { user: "", org: "", event: "", stage: "" };
  const errors: string[] = [];
  const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] } });
  try {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.organization.deleteMany({ where: { name: `zz-archive-close club ${size}` } });
    const lapsedAt = new Date(Math.floor((Date.now() - 86_400_000) / 1000) * 1000);
    const user = await prisma.user.create({ data: { email, name: "Zz Archive Closer", password: "x:unusable" } });
    ids.user = user.id;
    const org = await prisma.organization.create({
      data: {
        name: `zz-archive-close club ${size}`,
        kind: "club",
        timeZone: "Europe/London",
        locale: "en-GB",
        subscription: {
          create: {
            plan: "free", status: "canceled", provider: "stripe", providerCustomerId: `cus_zz_archclose_${size}`,
            providerSubscriptionId: `sub_zz_archclose_${size}`, planTermsApply: true, lapsedAt, currentPeriodEnd: lapsedAt,
          },
        },
        members: { create: { userId: user.id, role: "owner" } },
      },
    });
    ids.org = org.id;
    const event = await prisma.event.create({
      data: {
        organizationId: org.id, name: `zz-archive-close league ${size}`, dates: "Sundays", course: "Home", city: "", address: "", regDeadline: "",
        status: "live", shape: "series", shareToken: `zz-archive-close-${size}-${Date.now()}`, archivedAt: lapsedAt, launchedAt: new Date(),
        customPars: JSON.stringify(new Array(18).fill(4)), customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    });
    ids.event = event.id;
    const round = await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross" } });
    ids.stage = round.id;
    const wren = await prisma.player.create({ data: { eventId: event.id, name: "Wren Halloway", email: `zz-archive-close-wren-${size}@example.invalid`, seed: 1, status: "confirmed" } });
    // Returned and approved: nothing left to wait for, so the dashboard offers to close the round.
    await prisma.scorecard.create({
      data: { eventId: event.id, stageId: round.id, playerId: wren.id, strokes: JSON.stringify(new Array(18).fill(4)), status: "approved", approvedBy: "zz", approvedAt: new Date() },
    });
    await prisma.account.create({ data: { eventId: event.id, email, name: "Zz Archive Closer", role: "admin" } });
    await ctx.addCookies([
      { name: "ng_session", value: sign(signedInNow(user.id)), url: baseURL! },
      { name: "ng_active_event", value: sign(event.id), url: baseURL! },
    ]);

    const page = await ctx.newPage();
    watchPageErrors(page, errors);
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await expect(page.locator("[data-archive-banner]"), "the dashboard does not say the tournament is read-only").toBeVisible({ timeout: 30_000 });

    const card = page.getByRole("region", { name: "The round is ready to close" });
    await expect(card, "the dashboard did not offer to close the round").toBeVisible({ timeout: 15_000 });
    await card.getByRole("button", { name: /^Close / }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("button", { name: "Close the round" }).click();

    const refusal = card.locator(".form-error").filter({ hasText: /This club.s subscription ended on .+, so this tournament is paused where it stands\./ });
    await expect(refusal, "the refusal was not said where the press was").toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("This screen didn't load"), "the error screen came up instead of the refusal").toHaveCount(0);
    expect((await prisma.stage.findUnique({ where: { id: round.id } }))?.closedAt, "a refused close closed the round").toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await ctx.close().catch(() => {});
    if (ids.org) await prisma.organization.deleteMany({ where: { id: ids.org } });
    if (ids.event) await prisma.event.deleteMany({ where: { id: ids.event } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
  }
});
