import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * COMPLETING ASKS ABOUT A ROUND NOBODY HAS PLAYED (2026-10-31), as the organizer meets it.
 *
 * A two-round outing, Round 1 on the cards and Round 2 untouched, on a new club's free plan.
 * Until this day one confirm closed Round 2 as not played. Now, on the dashboard:
 *
 *   - Complete tournament asks the panel's question FIRST, naming Round 2;
 *   - Keep playing leaves the tournament live and Round 2 open, in the database;
 *   - Complete anyway is followed by the free plan's keeping notice (one topic per dialog),
 *     and only Complete it there completes it — Round 2 closed as not played.
 *
 * Marked zz-, one club per screen size, deleted afterwards. WHAT IT CANNOT SEE: a paid club,
 * where Complete anyway completes at once (the action's three cases are held against real rows
 * by `completing-asks-about-unplayed-rounds.audit.test.ts`), and a page left open while a
 * round's cards change, which the server answers with the same question.
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
const PARS = new Array(18).fill(4);

test("completing with a round nobody has played asks first, and only the answer completes it", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const size = testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase();
  const email = `zz-unplayed-${size}@example.invalid`;
  const ids = { user: "", org: "", event: "", round2: "" };
  const errors: string[] = [];
  const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] } });
  const now = async () => {
    const ev = await prisma.event.findUniqueOrThrow({ where: { id: ids.event } });
    const r2 = await prisma.stage.findUniqueOrThrow({ where: { id: ids.round2 } });
    return { status: ev.status, round2Closed: r2.closedAt !== null };
  };
  try {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.organization.deleteMany({ where: { name: `zz-unplayed club ${size}` } });
    const user = await prisma.user.create({ data: { email, name: "Zz Unplayed Organizer", password: "x:unusable" } });
    ids.user = user.id;
    const org = await prisma.organization.create({
      data: {
        name: `zz-unplayed club ${size}`, kind: "club", timeZone: "Europe/London", locale: "en-GB",
        // On the free plan's terms, so completing is followed by its keeping notice.
        subscription: { create: { plan: "free", status: "active", planTermsApply: true } },
        members: { create: { userId: user.id, role: "owner" } },
      },
    });
    ids.org = org.id;
    const event = await prisma.event.create({
      data: {
        organizationId: org.id, name: `zz-unplayed outing ${size}`, dates: "Two days", course: "Home", city: "", address: "", regDeadline: "",
        status: "live", shareToken: `zz-unplayed-${size}-${Date.now()}`,
        customPars: JSON.stringify(PARS), customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    });
    ids.event = event.id;
    const rounds: string[] = [];
    for (const position of [0, 1]) {
      const st = await prisma.stage.create({ data: { eventId: event.id, position, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross" } });
      rounds.push(st.id);
    }
    ids.round2 = rounds[1];
    const wren = await prisma.player.create({ data: { eventId: event.id, name: "Wren Halloway", email: `zz-unplayed-wren-${size}@example.invalid`, seed: 1, status: "confirmed" } });
    await prisma.scorecard.create({ data: { eventId: event.id, stageId: rounds[0], playerId: wren.id, strokes: JSON.stringify(PARS) } });
    await prisma.account.create({ data: { eventId: event.id, email, name: "Zz Unplayed Organizer", role: "admin" } });
    await ctx.addCookies([
      { name: "ng_session", value: sign(signedInNow(user.id)), url: baseURL! },
      { name: "ng_active_event", value: sign(event.id), url: baseURL! },
    ]);

    const page = await ctx.newPage();
    watchPageErrors(page, errors);
    await page.goto(`/dashboard?bust=${Date.now()}`);
    const complete = page.getByRole("button", { name: "Complete tournament" }).first();
    await expect(complete, "Complete tournament is not offered").toBeEnabled({ timeout: 30_000 });

    // The question, first, in the panel's words.
    await complete.scrollIntoViewIfNeeded();
    await complete.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText("Round 2 has no scores. Completing will close it as not played, and results will be decided on the rounds played.");
    await expect(dialog.getByRole("button", { name: "Complete it" }), "the keeping notice came with the question, not after it").toHaveCount(0);

    // Keep playing: nothing changes.
    await dialog.getByRole("button", { name: "Keep playing" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await now(), "Keep playing changed the tournament").toEqual({ status: "live", round2Closed: false });

    // Complete anyway: then the free plan's notice, and only its button completes.
    await complete.click();
    await expect(dialog).toContainText("Round 2 has no scores.");
    await dialog.getByRole("button", { name: "Complete anyway" }).click();
    const keep = page.getByRole("alertdialog");
    await expect(keep.getByRole("button", { name: "Complete it" }), "the free plan's notice did not follow").toBeVisible({ timeout: 15_000 });
    expect(await now(), "Complete anyway completed it before the free plan's notice was answered").toEqual({ status: "live", round2Closed: false });
    await keep.getByRole("button", { name: "Complete it" }).click();
    await expect.poll(now, { timeout: 20_000, message: "Complete it did not complete the tournament" }).toEqual({ status: "completed", round2Closed: true });
    expect(errors).toEqual([]);
  } finally {
    await ctx.close().catch(() => {});
    if (ids.org) await prisma.organization.deleteMany({ where: { id: ids.org } });
    if (ids.event) await prisma.event.deleteMany({ where: { id: ids.event } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
  }
});
