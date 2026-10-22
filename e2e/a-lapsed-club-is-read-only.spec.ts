import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * A LAPSED PAID CLUB'S TOURNAMENT IS A READ-ONLY ARCHIVE (2026-10-21,
 * decisions A4 and A8; `domain/club-archive.ts`), as its organizer meets it.
 *
 * Its own club — a Stripe plan that ended yesterday — with a live league under
 * way, stamped into the archive exactly as the webhook stamps it, and its owner
 * signed in. The organizer opens the tournament and:
 *
 *   - every screen says it is read-only, with the two dates and how to carry on
 *     (the dashboard, and the board, which still shows the field);
 *   - Complete tournament, pressed and confirmed, is refused IN WORDS beside the
 *     button — and the tournament is still live in the database;
 *   - Unlock configuration is not offered.
 *
 * Marked zz-, one club per screen size, deleted afterwards. WHAT IT CANNOT SEE:
 * the webhook itself and the sweep's notices and delete — the audit test
 * `a-lapsed-club-keeps-a-read-only-archive.audit.test.ts` drives those against
 * real rows — nor every edit screen: the banner is the layout's, and every
 * action's refusal is held by `the-archive-is-asked-at-every-door.test.ts`.
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

test("an organizer of a lapsed club sees the tournament read-only, and a press is refused in words", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const size = testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase();
  const email = `zz-archive-${size}@example.invalid`;
  const ids = { user: "", org: "", event: "" };
  const errors: string[] = [];
  const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] } });
  try {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.organization.deleteMany({ where: { name: `zz-archive club ${size}` } });
    const lapsedAt = new Date(Math.floor((Date.now() - 86_400_000) / 1000) * 1000);
    const user = await prisma.user.create({ data: { email, name: "Zz Archive Owner", password: "x:unusable" } });
    ids.user = user.id;
    const org = await prisma.organization.create({
      data: {
        name: `zz-archive club ${size}`,
        kind: "club",
        timeZone: "Europe/London",
        locale: "en-GB",
        subscription: {
          create: {
            plan: "free", status: "canceled", provider: "stripe", providerCustomerId: `cus_zz_archive_${size}`,
            providerSubscriptionId: `sub_zz_archive_${size}`, planTermsApply: true, lapsedAt, currentPeriodEnd: lapsedAt,
          },
        },
        members: { create: { userId: user.id, role: "owner" } },
      },
    });
    ids.org = org.id;
    const event = await prisma.event.create({
      data: {
        organizationId: org.id, name: `zz-archive league ${size}`, dates: "Sundays", course: "Home", city: "", address: "", regDeadline: "",
        status: "live", shape: "series", shareToken: `zz-archive-${size}-${Date.now()}`, archivedAt: lapsedAt,
        customPars: JSON.stringify(new Array(18).fill(4)), customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    });
    ids.event = event.id;
    await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross" } });
    await prisma.player.create({ data: { eventId: event.id, name: "Wren Halloway", email: `zz-archive-wren-${size}@example.invalid`, seed: 1, status: "confirmed" } });
    await prisma.account.create({ data: { eventId: event.id, email, name: "Zz Archive Owner", role: "admin" } });
    await ctx.addCookies([
      { name: "ng_session", value: sign(signedInNow(user.id)), url: baseURL! },
      { name: "ng_active_event", value: sign(event.id), url: baseURL! },
    ]);

    const page = await ctx.newPage();
    watchPageErrors(page, errors);
    await page.goto(`/dashboard?bust=${Date.now()}`);
    const banner = page.locator("[data-archive-banner]");
    await expect(banner, "the dashboard does not say the tournament is read-only").toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText("This club's subscription ended on");
    await expect(banner).toContainText("kept read-only until");
    await expect(banner).toContainText("paused where it stands");
    await expect(banner.getByRole("link", { name: "Go to Your plan" })).toHaveAttribute("href", "/organization#plan");
    await expect(page.getByRole("button", { name: /Unlock configuration/ }), "Unlock is offered on an archive").toHaveCount(0);

    // A press: Complete, confirmed — refused, in words, beside the button.
    const complete = page.getByRole("button", { name: "Complete tournament" }).first();
    await complete.scrollIntoViewIfNeeded();
    await complete.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("button", { name: "Complete tournament" }).click();
    // The card the lifecycle bar draws under its button (the banner says the same words higher up).
    const refused = page.locator(".card").filter({ hasText: /^\s*Not yet/ }).filter({
      hasText: /This club.s subscription ended on .+, so this tournament is paused where it stands\./,
    });
    await expect(refused, "the refusal was not said").toBeVisible({ timeout: 20_000 });
    await expect(refused, "the refusal is not where the press was").toBeInViewport();
    expect((await prisma.event.findUnique({ where: { id: event.id } }))?.status, "a refused Complete changed the tournament").toBe("live");

    // Still viewable: the board opens, shows the field, and says the same.
    await page.goto(`/leaderboard?bust=${Date.now()}`);
    await expect(page.locator("[data-archive-banner]"), "the board does not say it is read-only").toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Wren Halloway").first(), "the archived board stopped showing its field").toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await ctx.close().catch(() => {});
    if (ids.org) await prisma.organization.deleteMany({ where: { id: ids.org } });
    if (ids.event) await prisma.event.deleteMany({ where: { id: ids.event } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
  }
});
