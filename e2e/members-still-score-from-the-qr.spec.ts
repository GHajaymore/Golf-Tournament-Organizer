import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { playGroups } from "./keep-on-play";
import { seedDoorsClub, removeDoorsClub, groupLink, SIDE_A, SIDE_B, type DoorsClub } from "./doors-fixture";

/**
 * A MEMBER SCORES FROM THE CART SIGN'S QR, WITH NO ACCOUNT AND NO EMAIL (2026-11-13).
 *
 * Ajay's line for the guest player link (J39/J40): a member keeps scoring the way
 * they always have, by scanning the sign on the cart. The scan opens `/play#CODE`
 * (the sign's address; `print-kit.spec.ts` proves the drawing carries it). The
 * member is signed OUT: no account, no password, and — the 7 Nov ruling — possibly
 * no email on the club's list at all. Nothing the guest link adds may change that.
 *
 * It is pinned here, from the product's behaviour, before the guest link lands:
 *
 *   the sign's address   → the round's groups, nothing asked about an account or an email
 *   the member's group   → said back once, then "Yes, that's my group"
 *   hole 1               → stored for the member's side
 *   the same sign again  → the phone keeps its place, still no sign-in
 *
 * Done twice, in two clubs of its own: one whose members have an email on the
 * list, one whose members have none. Both invented, `zz-` marked, deleted afterwards.
 * WHAT IT CANNOT SEE: a camera reading the printed QR.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const clubs: Record<"withEmail" | "noEmail", DoorsClub | null> = { withEmail: null, noEmail: null };

test.beforeAll(async () => {
  clubs.withEmail = await seedDoorsClub(prisma, "zz-qr-email", { visibility: "participants", rounds: 1 });
  clubs.noEmail = await seedDoorsClub(prisma, "zz-qr-noemail", { visibility: "participants", rounds: 1 });
  // The 7 Nov ruling: a member may have no email. Read the fixture's facts back rather than assume them.
  await prisma.player.updateMany({ where: { eventId: clubs.noEmail.event }, data: { email: "" } });
  const withEmail = await prisma.player.findMany({ where: { eventId: clubs.withEmail.event }, select: { email: true } });
  const noEmail = await prisma.player.findMany({ where: { eventId: clubs.noEmail.event }, select: { email: true } });
  expect(withEmail.length, "the club with emails has no players").toBeGreaterThan(0);
  expect(withEmail.every((p) => p.email.endsWith("@example.invalid")), "an email-club member lost its email").toBe(true);
  expect(noEmail.length).toBeGreaterThan(0);
  expect(noEmail.every((p) => p.email === ""), "a no-email member still has an email").toBe(true);
});

test.afterAll(async () => {
  try {
    await Promise.allSettled([removeDoorsClub(prisma, clubs.withEmail), removeDoorsClub(prisma, clubs.noEmail)]);
  } finally {
    await prisma.$disconnect();
  }
});

const storedHole = async (match: string, i: number) => {
  const m = await prisma.match.findUniqueOrThrow({ where: { id: match }, select: { holes: true } });
  return (JSON.parse(m.holes) as (string | null)[])[i];
};

for (const [which, label] of [
  ["withEmail", "a member with an email on the list"],
  ["noEmail", "a member with no email on the list"],
] as const) {
  test(`${label}, signed out, scans the cart sign and scores hole 1`, async ({ browser, baseURL }) => {
    test.setTimeout(150_000);
    const club = clubs[which]!;
    const round = club.rounds[0];
    // A phone with nothing on it: no account session, no play session, no storage.
    const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    watchPageErrors(page, errors, `${label} by the sign`);
    try {
      await page.goto(groupLink(round.code));

      // The scan opens the round's groups: no sign-in, no email asked for.
      await expect(page.getByText("Tap your group to start scoring.")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByLabel(/e-?mail/i), "the sign asked a member for an email").toHaveCount(0);
      await expect(page.getByLabel(/password/i), "the sign asked a member for a password").toHaveCount(0);
      await expect(page.locator('input[type="email"], input[type="password"]'), "the sign drew an email or password box").toHaveCount(0);
      expect(new URL(page.url()).pathname, "the scan left /play").toBe("/play");
      await expect(playGroups(page)).toHaveCount(1);

      // The member's side is side B: the group, said back once.
      const group = playGroups(page).first();
      await expect(group).toHaveText(new RegExp(`^Match 1\\s+${SIDE_A} v ${SIDE_B}$`));
      await group.click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`You're keeping Match 1: ${SIDE_A} v ${SIDE_B}`);
      await page.getByRole("button", { name: "Yes, that's my group" }).click();

      // The card, as the cup has always drawn it; hole 1 to the member's own side.
      const hole1 = page.getByRole("group", { name: "Who won hole 1" });
      await expect(hole1.getByRole("button")).toHaveText([/^Zz Reds won/, /^Halved/, /^Zz Golds won/], { timeout: 30_000 });
      await hole1.getByRole("button", { name: /^Hole 1 to Zz Cal Cedar & Zz Dot Dale/ }).click();
      await expect.poll(() => storedHole(round.match, 0), { timeout: 15_000, message: "the hole was never stored" }).toBe("B");
      await expect(page.getByText("Zz Golds 1 up with 8 to play")).toBeVisible();

      // Signed out all the way through: the account area still sends this phone to sign in.
      const me = await ctx.request.get("/me", { maxRedirects: 0 });
      expect([301, 302, 303, 307, 308], "a play session turned into an account").toContain(me.status());
      expect(me.headers()["location"] ?? "", "/me sent a play session somewhere other than sign-in").toMatch(/^(https?:\/\/[^/]+)?\/(\?next=%2Fme)?$/);

      // The same sign scanned again, as a camera does: a fresh document (a same-page fragment change would not reload).
      const again = await ctx.newPage();
      watchPageErrors(again, errors, `${label} by the sign, again`);
      await again.goto(groupLink(round.code));
      await expect(again.getByRole("group", { name: "Who won hole 1" })).toBeVisible({ timeout: 30_000 });
      await expect(again.getByText("Zz Golds 1 up with 8 to play")).toBeVisible();
      await expect(again.getByRole("button", { name: "Yes, that's my group" })).toHaveCount(0);
      await expect(again.getByLabel(/e-?mail/i)).toHaveCount(0);
      await expect(again.getByLabel(/password/i)).toHaveCount(0);
      await expect(again.locator('input[type="email"], input[type="password"]')).toHaveCount(0);
      expect(errors, errors.join("\n")).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}
