import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * A FINISHED TEAM CUP SHOWS ITS POINTS, NEVER ZEROS — AND EVERY READER NAMES THE
 * SAME WINNER (#967; master backlog A07).
 *
 * The top-priority bug: a completed cup printed its whole field at P0 W0 ½0 L0
 * under "Final standings" on /reports, the honours board said nobody could be
 * named, and the season scored nobody — all three asked the round-robin
 * standings, which hold nothing for a cup. As the secretary meets it, on a cup
 * of four singles that Oakmere won 3–1, in a season:
 *
 *   /reports      "Final result": Oakmere 3, won the cup; Elmbridge 1; the note
 *                 "Oakmere won the cup 3–1"; no P0/W0 standings row
 *   /series       the season table: Oakmere's four level FIRST on the same
 *                 points, Elmbridge's four level below them (fifth)
 *                 the honours board offers "Won by Oakmere 3–1"; "Put on the
 *                 board" records that line, and the stored row carries NO id in
 *                 `playerId` — a team is not a player (2026-11-02)
 *
 * The cup is seeded as Score entry leaves it — the lineup announced, each match's
 * holes tapped and confirmed, the tournament completed — under a zz- mark,
 * invented names, `@example.invalid`, deleted in the finally. The same cup PLAYED
 * through the actions (addCupMatch, saveMatchHoles, confirmMatches,
 * setEventStatus) is `a-team-cup-has-one-result.audit.test.ts`.
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
/** Won 3&2 by the A side, or by the B side. */
const card = (w: "A" | "B") => JSON.stringify([...Array(3).fill(w), ...Array(13).fill("H"), null, null]);

test("a completed team cup: the report, the season and the honours board name the same team and score", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const size = testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase();
  const email = `zz-cuppoints-${size}@example.invalid`;
  const cupName = `zz-cuppoints Autumn Cup ${size}`;
  const ids = { user: "", org: "" };
  const errors: string[] = [];
  const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] } });
  try {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.organization.deleteMany({ where: { name: `zz-cuppoints club ${size}` } });
    const user = await prisma.user.create({ data: { email, name: "Zz Cup Secretary", password: "x:unusable", emailVerifiedAt: new Date() } });
    ids.user = user.id;
    const org = await prisma.organization.create({
      data: {
        name: `zz-cuppoints club ${size}`, kind: "club", timeZone: "Europe/London", locale: "en-GB",
        // A plan with the honours board and the season table on it.
        subscription: { create: { plan: "club", planTermsApply: true } },
        members: { create: { userId: user.id, role: "owner" } },
      },
    });
    ids.org = org.id;
    const season = await prisma.series.create({ data: { organizationId: org.id, name: `zz-cuppoints season ${size}` } });
    const event = await prisma.event.create({
      data: {
        organizationId: org.id, seriesId: season.id, name: cupName, status: "completed", format: "match", shape: "single",
        dates: "October 2026", course: "Home", city: "", address: "", regDeadline: "", shareToken: `zz-cuppoints-${size}-${Date.now()}`,
        completedAt: new Date(),
      },
    });
    const oak = await prisma.group.create({ data: { eventId: event.id, name: "Oakmere", position: 0 } });
    const elm = await prisma.group.create({ data: { eventId: event.id, name: "Elmbridge", position: 1 } });
    const singles = await prisma.stage.create({
      data: { eventId: event.id, position: 0, type: "Team Session", format: "Match Play", holes: 18, description: "Singles", lineupPublished: true },
    });
    const carrier = await prisma.group.create({ data: { eventId: event.id, stageId: singles.id, isCarrier: true, name: "Match Play — cup session", position: 10 } });
    const first = ["Ailsa", "Bram", "Cora", "Dev"];
    // Oakmere win three, Elmbridge one: 3–1.
    const results: Array<"A" | "B"> = ["A", "A", "A", "B"];
    let seed = 0;
    /** A roster member behind each entry, so the season can follow them. */
    const entrant = async (name: string, mail: string, groupId: string) => {
      const member = await prisma.member.create({ data: { organizationId: org.id, name, email: mail } });
      return prisma.player.create({
        data: { eventId: event.id, name, email: mail, handicap: 10, seed: ++seed, status: "confirmed", groupId, memberId: member.id },
      });
    };
    for (const [i, f] of first.entries()) {
      const o = await entrant(`${f} Oak`, `zz-cuppoints-${size}-o${i}@example.invalid`, oak.id);
      const e = await entrant(`${f} Elm`, `zz-cuppoints-${size}-e${i}@example.invalid`, elm.id);
      await prisma.match.create({
        data: { eventId: event.id, stageId: singles.id, groupId: carrier.id, round: i + 1, playerAId: o.id, playerBId: e.id, teamAId: "", teamBId: "", holes: card(results[i]), scoreStatus: "confirmed" },
      });
    }
    await prisma.account.create({ data: { eventId: event.id, email, name: "Zz Cup Secretary", role: "admin" } });
    await ctx.addCookies([
      { name: "ng_session", value: sign(signedInNow(user.id)), url: baseURL! },
      { name: "ng_active_event", value: sign(event.id), url: baseURL! },
    ]);

    const page = await ctx.newPage();
    watchPageErrors(page, errors);

    // 1. The report: the cup's own result, final.
    await page.goto(`/reports?bust=${Date.now()}`);
    const sheet = page.locator(".print-card");
    await expect(sheet, "the report sheet did not load").toContainText("Final result", { timeout: 30_000 });
    await expect(sheet).toContainText("Oakmere won the cup 3–1");
    const row = (team: string) => sheet.locator("tr", { hasText: team });
    await expect(row("Oakmere")).toContainText("won the cup");
    await expect(row("Oakmere").locator("td").last()).toHaveText("3");
    await expect(row("Elmbridge").locator("td").last()).toHaveText("1");
    // Never the round-robin's empty table: no player at P0 W0, no "Final standings".
    await expect(sheet).not.toContainText("Final standings");
    await expect(sheet.getByText("Ailsa Oak")).toHaveCount(0);

    // 2. The season: the winning team's four level first, the other four level below.
    await page.goto(`/series?id=${season.id}&bust=${Date.now()}`);
    const seasonRow = (name: string) => page.locator("tbody tr", { has: page.locator("td", { hasText: new RegExp(`^${name}$`) }) });
    await expect(seasonRow("Ailsa Oak"), "the season table did not load").toBeVisible({ timeout: 30_000 });
    const pointsOf = async (name: string) => Number(await seasonRow(name).locator("td").nth(3).innerText());
    const placeOf = async (name: string) => (await seasonRow(name).locator("td").first().innerText()).trim();
    const oakPoints = new Set<number>();
    const elmPoints = new Set<number>();
    for (const f of first) {
      // Four share first, so the next place is fifth — never 2nd.
      expect(await placeOf(`${f} Oak`), `${f} Oak's place in the season`).toBe("1");
      expect(await placeOf(`${f} Elm`), `${f} Elm's place in the season`).toBe("5");
      oakPoints.add(await pointsOf(`${f} Oak`));
      elmPoints.add(await pointsOf(`${f} Elm`));
    }
    expect(oakPoints.size, "Oakmere's players level on points").toBe(1);
    expect(elmPoints.size, "Elmbridge's players level on points").toBe(1);
    expect([...oakPoints][0]).toBeGreaterThan([...elmPoints][0]);

    // 3. The honours board, on the same screen: the champion is the team, with the score.
    const pending = page.locator("div", { hasText: cupName }).filter({ has: page.getByRole("button", { name: /Put on the board/ }) }).last();
    await expect(pending.getByText("Won by")).toBeVisible();
    await expect(pending.locator("b", { hasText: "Oakmere 3–1" })).toBeVisible();
    await expect(page.getByText("No ranked results yet")).toHaveCount(0);
    // Confirmed, it is the board's line in the same words.
    await pending.getByRole("button", { name: /Put on the board/ }).click();
    await expect(page.getByRole("button", { name: /Put on the board/ }), "the cup left the waiting list").toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator("b", { hasText: "Oakmere 3–1" }).first()).toBeVisible();
    await expect(page.getByText(/confirmed by Zz Cup Secretary/).first()).toBeVisible();
    // And the record: one line, the team's words, NO flight id in playerId.
    const lines = await prisma.honoursEntry.findMany({ where: { eventId: event.id } });
    expect(lines.map((l) => ({ championName: l.championName, playerId: l.playerId }))).toEqual([{ championName: "Oakmere 3–1", playerId: "" }]);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close().catch(() => {});
    if (ids.org) {
      await prisma.honoursEntry.deleteMany({ where: { organizationId: ids.org } });
      await prisma.event.deleteMany({ where: { organizationId: ids.org } });
      await prisma.series.deleteMany({ where: { organizationId: ids.org } });
      await prisma.member.deleteMany({ where: { organizationId: ids.org } });
      await prisma.organization.deleteMany({ where: { id: ids.org } });
    }
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
  }
});
