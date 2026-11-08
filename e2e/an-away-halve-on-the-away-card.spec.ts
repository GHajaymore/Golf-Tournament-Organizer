import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * AN AWAY MATCH HALVED ON THE COURSE IS DECIDED ON THE AWAY CARD'S HOLES —
 * on the leaderboard, the week sheet and a member's match record (J26,
 * 2026-11-06).
 *
 * An interclub match-play league whose own card has the 1st as its hardest
 * hole. Week 1 is played AWAY, at a club whose card is the same layout indexed
 * the other way round (the 18th hardest). The committee settles a halved match
 * on the toughest six holes (Committee Procedures 5A(6)). Two matches that
 * week, both all square after eighteen, side A winning the 1st–3rd and side B
 * the 16th–18th:
 *
 *   Ailsa v Bryony  at the week's venue, the away card: its hardest six are
 *                   the 13th–18th, where Bryony won three — BRYONY wins
 *   Cora v Dilys    moved by the pair to a third club laid out like home (the
 *                   match's own venue): the 1st–6th — CORA wins (the control:
 *                   right before and after J26)
 *
 * Worked out here from the cards the fixture stores, not read off the app.
 * Before J26 all three screens decided both matches on the tournament's card
 * and gave the first to Ailsa. Seeded as Score entry leaves a finished week,
 * under a zz- mark, invented names, `@example.invalid`, deleted in the finally;
 * the same rows through the readers directly are
 * `an-away-match-countback.audit.test.ts`.
 *
 * WHAT IT CANNOT SEE: the cut out of a match-play round (`regroup.ts`), which
 * reads the same card and is pinned by the sweep
 * `the-countback-card-is-the-match-venue.test.ts`, not by a screen.
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

const HOME_SI = Array.from({ length: 18 }, (_, i) => i + 1);
const AWAY_SI = Array.from({ length: 18 }, (_, i) => 18 - i);
const HALVED: Array<"A" | "B" | "H"> = ["A", "A", "A", ...Array<"H">(12).fill("H"), "B", "B", "B"];

/** Who takes a halve on the toughest six of a card — the holes whose index is 6 or less. */
function toughestSix(holes: Array<"A" | "B" | "H">, si: number[]): "A" | "B" | null {
  let a = 0;
  let b = 0;
  holes.forEach((h, i) => {
    if (si[i] > 6) return;
    if (h === "A") a += 1;
    if (h === "B") b += 1;
  });
  return a === b ? null : a > b ? "A" : "B";
}

/** The cells of the row naming `who` in the first table under `scope`. */
async function rowOf(page: Page, scope: ReturnType<Page["locator"]>, who: string): Promise<string[]> {
  const row = scope.locator("table tbody tr", { has: page.locator("td", { hasText: new RegExp(`^${who}$`) }) }).first();
  await expect(row, `no row for ${who}`).toBeVisible({ timeout: 30_000 });
  return row.locator("td").evaluateAll((tds) => tds.map((td) => (td.textContent ?? "").trim()));
}

test("an away week's halved match is decided on the away card: leaderboard, week sheet and match record agree", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const size = testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase();
  const tag = `zz-awayhalve-${size}`;
  const email = `${tag}@example.invalid`;
  const ids = { user: "", org: "" };
  const errors: string[] = [];
  const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] } });

  // The fixture can express the fault: the two cards disagree about this halve.
  expect(toughestSix(HALVED, AWAY_SI), "on the away card").toBe("B");
  expect(toughestSix(HALVED, HOME_SI), "on the home card").toBe("A");

  try {
    await prisma.user.deleteMany({ where: { email } });
    const stale = await prisma.organization.findMany({ where: { name: `${tag} club` }, select: { id: true } });
    for (const o of stale) {
      await prisma.event.deleteMany({ where: { organizationId: o.id } });
      await prisma.course.deleteMany({ where: { organizationId: o.id } });
      await prisma.member.deleteMany({ where: { organizationId: o.id } });
      await prisma.organization.deleteMany({ where: { id: o.id } });
    }

    const user = await prisma.user.create({ data: { email, name: "Zz League Secretary", password: "x:unusable", emailVerifiedAt: new Date() } });
    ids.user = user.id;
    const org = await prisma.organization.create({
      data: {
        name: `${tag} club`, kind: "club", timeZone: "Europe/London", locale: "en-GB",
        subscription: { create: { plan: "club", planTermsApply: true } },
        members: { create: { userId: user.id, role: "owner" } },
      },
    });
    ids.org = org.id;
    const event = await prisma.event.create({
      data: {
        organizationId: org.id, name: `${tag} Interclub League`, status: "live", format: "match", shape: "series",
        dates: "Summer 2026", course: `${tag} home`, city: "", address: "", regDeadline: "", shareToken: `${tag}-${Date.now()}`,
        customPars: JSON.stringify(Array(18).fill(4)),
        customYards: JSON.stringify(Array(18).fill(400)),
        customStrokeIndex: JSON.stringify(HOME_SI),
        matchTiebreakers: JSON.stringify(["toughest-6"]),
      },
    });
    const course = (name: string, si: number[]) =>
      prisma.course.create({
        data: { organizationId: org.id, name: `${tag} ${name}`, city: "", pars: JSON.stringify(Array(18).fill(4)), yards: JSON.stringify(Array(18).fill(400)), strokeIndex: JSON.stringify(si) },
      });
    const away = await course("away links", AWAY_SI);
    const third = await course("third club", HOME_SI);
    await prisma.eventCourse.create({ data: { eventId: event.id, courseId: away.id } });
    await prisma.eventCourse.create({ data: { eventId: event.id, courseId: third.id } });

    const week = await prisma.stage.create({
      data: { eventId: event.id, position: 0, description: "Week 1", type: "Round Robin", format: "Match Play", holes: 18, courseId: away.id },
    });
    const pool = await prisma.group.create({ data: { eventId: event.id, name: "Pool", position: 0 } });
    const names = ["Ailsa Awayday", "Bryony Awayday", "Cora Awayday", "Dilys Awayday"];
    const player: Record<string, string> = {};
    const member: Record<string, string> = {};
    for (const [i, name] of names.entries()) {
      const mail = `${tag}-${i}@example.invalid`;
      member[name] = (await prisma.member.create({ data: { organizationId: org.id, name, email: mail } })).id;
      player[name] = (
        await prisma.player.create({
          data: { eventId: event.id, groupId: pool.id, name, email: mail, handicap: 10, seed: i + 1, status: "confirmed", memberId: member[name] },
        })
      ).id;
    }
    const match = (a: string, b: string, extra: Record<string, unknown> = {}) =>
      prisma.match.create({
        data: { eventId: event.id, stageId: week.id, groupId: pool.id, round: 1, playerAId: player[a], playerBId: player[b], teamAId: "", teamBId: "", holes: JSON.stringify(HALVED), scoreStatus: "confirmed", ...extra },
      });
    await match("Ailsa Awayday", "Bryony Awayday");
    await match("Cora Awayday", "Dilys Awayday", { courseId: third.id });

    await prisma.account.create({ data: { eventId: event.id, email, name: "Zz League Secretary", role: "admin" } });
    await ctx.addCookies([
      { name: "ng_session", value: sign(signedInNow(user.id)), url: baseURL! },
      { name: "ng_active_event", value: sign(event.id), url: baseURL! },
    ]);
    const page = await ctx.newPage();
    watchPageErrors(page, errors, "secretary");

    // A win is the event's winPts (2 by default); a loss nothing.
    const win = String((await prisma.event.findUniqueOrThrow({ where: { id: event.id }, select: { winPts: true } })).winPts);

    // 1. THE LEADERBOARD (the standings): Bryony has the win, Ailsa the loss.
    await page.goto(`/leaderboard?bust=${Date.now()}`);
    const board = page.locator("main");
    const bryony = await rowOf(page, board, "Bryony Awayday");
    const ailsa = await rowOf(page, board, "Ailsa Awayday");
    expect(bryony.at(-1), "Bryony's points on the leaderboard").toBe(win);
    expect(ailsa.at(-1), "Ailsa's points on the leaderboard").toBe("0");
    expect((await rowOf(page, board, "Cora Awayday")).at(-1), "the control: Cora's points").toBe(win);

    // 2. THE WEEK SHEET: the table after the away week.
    await page.goto(`/week?round=${week.id}&bust=${Date.now()}`);
    const table = page.locator(".card", { has: page.locator(".card-title", { hasText: /^Standings after this week$/ }) });
    await expect(table, "the week sheet has no standings after this week").toBeVisible({ timeout: 30_000 });
    expect((await rowOf(page, table, "Bryony Awayday"))[3], "Bryony's total on the week sheet").toBe(win);
    expect((await rowOf(page, table, "Ailsa Awayday"))[3], "Ailsa's total on the week sheet").toBe("0");

    // 3. THE MATCH RECORD (head-to-head): Bryony leads Ailsa 1–0, and won.
    await page.goto(`/member?member=${encodeURIComponent(member["Bryony Awayday"])}&bust=${Date.now()}`);
    const record = page.locator("section", { has: page.locator("#match-record") });
    await expect(record, "no match record on Bryony's page").toBeVisible({ timeout: 30_000 });
    const vsAilsa = await rowOf(page, record, "Ailsa Awayday");
    expect(vsAilsa[1], "Bryony's record against Ailsa").toContain("Leads 1–0");
    expect(vsAilsa[2], "the last meeting").toMatch(/^Won/);

    expect(errors).toEqual([]);
  } finally {
    await ctx.close().catch(() => {});
    if (ids.org) {
      await prisma.event.deleteMany({ where: { organizationId: ids.org } });
      await prisma.course.deleteMany({ where: { organizationId: ids.org } });
      await prisma.member.deleteMany({ where: { organizationId: ids.org } });
      await prisma.organization.deleteMany({ where: { id: ids.org } });
    }
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
  }
});
