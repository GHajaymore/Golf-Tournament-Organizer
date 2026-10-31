import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * A FINISHED TEAM CUP SHOWS ITS POINTS, NEVER ZEROS (#967; master backlog A07).
 *
 * The top-priority bug: a completed cup printed its whole field at P0 W0 ½0 L0
 * under "Final standings" on /reports, and the honours board said nobody could be
 * named — both asked the round-robin standings, which hold nothing for a cup.
 * As the secretary meets it, on a cup of four singles that Oakmere won 3–1:
 *
 *   /reports      "Final result": Oakmere 3, won the cup; Elmbridge 1; the note
 *                 "Oakmere won the cup 3–1"; no P0/W0 standings row
 *   /series       the honours board offers "Won by Oakmere 3–1" to confirm
 *
 * The cup is seeded as Score entry leaves it — the lineup announced, each match's
 * holes tapped and confirmed, the tournament completed — under a zz- mark,
 * invented names, `@example.invalid`, deleted in the finally. WHAT IT CANNOT SEE:
 * the season table (held by `a-team-cup-has-one-result.audit.test.ts`).
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
/** Won 3&2 by the A side, or by the B side. */
const card = (w: "A" | "B") => JSON.stringify([...Array(3).fill(w), ...Array(13).fill("H"), null, null]);

test("a completed team cup's report and honours board show the real points", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const size = testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase();
  const email = `zz-cuppoints-${size}@example.invalid`;
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
        // A plan with the honours board on it.
        subscription: { create: { plan: "club", planTermsApply: true } },
        members: { create: { userId: user.id, role: "owner" } },
      },
    });
    ids.org = org.id;
    const event = await prisma.event.create({
      data: {
        organizationId: org.id, name: `zz-cuppoints Autumn Cup ${size}`, status: "completed", format: "match", shape: "single",
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
    for (const [i, f] of first.entries()) {
      const o = await prisma.player.create({ data: { eventId: event.id, name: `${f} Oak`, email: `zz-cuppoints-${size}-o${i}@example.invalid`, handicap: 10, seed: ++seed, status: "confirmed", groupId: oak.id } });
      const e = await prisma.player.create({ data: { eventId: event.id, name: `${f} Elm`, email: `zz-cuppoints-${size}-e${i}@example.invalid`, handicap: 10, seed: ++seed, status: "confirmed", groupId: elm.id } });
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

    // The report: the cup's own result, final.
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

    // The honours board: the champion is the team, with the score.
    await page.goto(`/series?bust=${Date.now()}`);
    await expect(page.getByText(`zz-cuppoints Autumn Cup ${size}`).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Won by").first()).toBeVisible();
    await expect(page.locator("b", { hasText: "Oakmere 3–1" }).first()).toBeVisible();
    await expect(page.getByText("No ranked results yet")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close().catch(() => {});
    if (ids.org) {
      await prisma.event.deleteMany({ where: { organizationId: ids.org } });
      await prisma.organization.deleteMany({ where: { id: ids.org } });
    }
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
  }
});
