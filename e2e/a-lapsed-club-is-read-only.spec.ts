import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";
import { completeControl } from "./end-early";

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
 *   - ending the tournament is DISABLED under the banner's words (the console is
 *     read-only in one place, `ArchiveReadOnly`, since 2026-11-09) — nothing opens,
 *     and the tournament is still live in the database;
 *   - Make a committee correction is not offered.
 *
 * Marked zz-, one club per screen size, deleted afterwards. WHAT IT CANNOT SEE:
 * the webhook itself and the sweep's notices and delete — the audit test
 * `a-lapsed-club-keeps-a-read-only-archive.audit.test.ts` drives those against
 * real rows — nor every edit screen: the banner is the layout's, and every
 * action's refusal is held by `the-archive-is-asked-at-every-door.test.ts`.
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

test("an organizer of a lapsed club sees the tournament read-only, said in words, and cannot end it", async ({ browser, baseURL }, testInfo) => {
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
    const round = await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross" } });
    const wren = await prisma.player.create({ data: { eventId: event.id, name: "Wren Halloway", email: `zz-archive-wren-${size}@example.invalid`, seed: 1, status: "confirmed" } });
    // A card in, so Complete is offered at all (with nothing scored it is refused before the
    // archive is asked) and the refusal under test is the archive's.
    // NOT yet approved, so golf remains and ending is "End this event early…" under the card's More
    // (B03: the PM, 10 Nov). With every card in, the job would be closing the round instead, and
    // nothing ends the event until it is closed — which an archive refuses before Complete is reached.
    await prisma.scorecard.create({ data: { eventId: event.id, stageId: round.id, playerId: wren.id, strokes: JSON.stringify(new Array(18).fill(4)) } });
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
    await expect(page.getByRole("button", { name: /Make a committee correction/ }), "a committee correction is offered on an archive").toHaveCount(0);

    // Ending it ("End this event early…" under More while golf remains) is READ-ONLY, not refused after
    // a press: the console is read-only in one place (`ArchiveReadOnly`, 2026-11-09), so the control is
    // disabled under the banner that says why. More itself only opens the menu, so it still opens.
    await expect(banner).toContainText(/This club.s subscription ended on .+, so this tournament is paused where it stands\./);
    const complete = await completeControl(page);
    await complete.scrollIntoViewIfNeeded();
    await expect(complete, "ending the tournament is pressable in an archive").toBeDisabled({ timeout: 15_000 });
    await expect(page.getByRole("alertdialog"), "a disabled control opened its confirmation").toHaveCount(0);
    await expect(page.getByText("This screen didn't load"), "the error screen came up").toHaveCount(0);
    expect((await prisma.event.findUnique({ where: { id: event.id } }))?.status, "the archived tournament changed").toBe("live");

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
