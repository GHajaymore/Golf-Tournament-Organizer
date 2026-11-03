import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, returnCard, signIn, signInWith, sessionOf, centre, addDays, dayIn } from "./rounds-fixture";

/**
 * THE SECRETARY'S HOME, AS THE SECRETARY USES IT (2026-10-24, the panel's item 4).
 *
 *   what's next    the club's jobs on the console's home, one line each; the
 *                  button on another tournament's line OPENS that tournament on
 *                  the screen that does the job — here Entries, with the entry
 *                  that is waiting on it
 *   copy last      last summer's medal copied from the home with a new first
 *                  day: what came across and what did not, FIELD BY FIELD
 *                  against the source row; the copy's sign-up link, once
 *                  published, is a NEW address; the original is exactly as it
 *                  was, and its own old link still names it and not the copy
 *   a Guest        made organizer of one of the club's tournaments: reads the
 *                  same lines, and has no button and no copy card
 *   next door      another club's tournament, with an entry waiting, is never
 *                  on this club's home
 *
 * Its own club (`zz-sechome-…`, invented names, `@example.invalid`), dropped in
 * a `finally`; it never touches the shared fixture.
 *
 * WHAT IT CANNOT SEE: the tee-sheet, cards and results lines in a browser (the
 * unit and database tests hold those — `whats-next.test.ts`,
 * `copy-last-event.audit.test.ts`); a copy started from the Tournaments list
 * (`tournaments-copied-switched-deleted.spec.ts`).
 */

const WALKED = ["desktop", "phone"];

async function open(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
}

test.describe.configure({ timeout: 240_000 });
test.use({ actionTimeout: 20_000 });

test("what's next opens the right tournament on the right screen, and copy last event copies the setup and nothing else", async ({ page, context, browser, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = `zz-sechome-copy-${testInfo.project.name}`;
  const club = await makeClub(mark, { timeZone: "Europe/London" });
  const nextDoor = await makeClub(`${mark}-nd`, { timeZone: "Europe/London" });
  const clubToday = dayIn("Europe/London");
  const guestCtx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
  try {
    // ── Last summer's medal: every setting the panel named off its default ──
    const medal = await makeEvent(club, "Summer Medal", {
      status: "completed",
      stages: [
        { format: "Stroke Play", holes: 18, scoringBasis: "net", playedOn: "2026-06-13" },
        { format: "Stroke Play", holes: 18, scoringBasis: "gross", playedOn: "2026-06-14" },
      ],
      players: 4,
      event: {
        startOn: "2026-06-13",
        endOn: "2026-06-14",
        dates: "13–14 Jun 2026",
        regDeadline: "2026-06-10",
        regOpens: "2026-06-01",
        teePolicy: "flight",
        registrationApproval: "approve",
        registrationOpen: true,
        registrationToken: `${mark}-old-link`,
        requirePhone: true,
        capacity: 40,
        leaderboardVisibility: "public",
        flightMode: "count",
        flightValue: 2,
      },
    });
    await prisma.stage.update({ where: { id: medal.stages[0].id }, data: { handicapAllowance: 90, teeSheet: JSON.stringify({ groups: [] }), teeSheetPublished: true } });
    for (const p of medal.players) await returnCard(medal.event.id, medal.stages[0].id, p.id);
    const kp = await prisma.contest.create({ data: { eventId: medal.event.id, stageId: medal.stages[0].id, kind: "closest-pin", name: "KP 7th", hole: 7, buyInCents: 200, sponsorName: "Zz Motors" } });
    await prisma.contestEntry.create({ data: { contestId: kp.id, playerId: medal.players[0].id, won: true } });
    const birdies = await prisma.sideGame.create({ data: { eventId: medal.event.id, stageId: medal.stages[1].id, kind: "birdies", buyInCents: 500 } });
    await prisma.sideGameEntry.create({ data: { sideGameId: birdies.id, playerId: medal.players[1].id } });
    const source = await prisma.event.findUniqueOrThrow({ where: { id: medal.event.id }, include: { stages: { orderBy: { position: "asc" } } } });
    const before = JSON.stringify({
      source,
      players: await prisma.player.count({ where: { eventId: source.id } }),
      cards: await prisma.scorecard.count({ where: { eventId: source.id } }),
      contestEntries: await prisma.contestEntry.count({ where: { contest: { eventId: source.id } } }),
      sideGameEntries: await prisma.sideGameEntry.count({ where: { sideGame: { eventId: source.id } } }),
    });

    // ── The autumn foursomes, taking entries: one waiting for approval ──
    const autumn = await makeEvent(club, "Autumn Foursomes", { status: "registration", stages: [{}], players: 2 });
    const waiting = await prisma.player.create({
      data: { eventId: autumn.event.id, name: "Wren Halloran-Pike", email: `${mark}-w@example.invalid`, handicap: 14.2, seed: 9, status: "pending" },
    });

    // ── Next door, an entry waiting that is nobody here's business ──
    const theirs = await makeEvent(nextDoor, "Next Door Open", { status: "registration", stages: [{}], players: 1 });
    await prisma.player.create({ data: { eventId: theirs.event.id, name: "Zz Neighbour", email: `${mark}-nd-n@example.invalid`, handicap: 9, seed: 2, status: "pending" } });

    // ── A Guest of the club, made organizer of the foursomes ──
    const guest = await prisma.user.create({ data: { email: `${mark}-guest@example.invalid`, name: "Ione Guestwick", password: "x:unusable" } });
    await prisma.organizationMember.create({ data: { organizationId: club.orgId, userId: guest.id, role: "guest" } });
    await prisma.account.create({ data: { eventId: autumn.event.id, email: `${mark}-guest@example.invalid`, name: "Ione Guestwick", role: "admin" } });

    await signIn(context, baseURL!, club, medal.event.id);

    await test.step("what's next: the foursomes' waiting entry, and nothing from next door", async () => {
      await open(page, "/dashboard");
      const next = page.getByRole("region", { name: "What's next" });
      await expect(next, "the home has no What's next").toBeVisible();
      const line = next.locator('[data-job="entries"]').filter({ hasText: autumn.event.name });
      await expect(line).toContainText("1 entry awaiting approval");
      await expect(next, "another club's tournament is on this club's home").not.toContainText(theirs.event.name);
      // A completed tournament waits on nobody.
      await expect(next).not.toContainText(medal.event.name);

      const go = line.getByRole("button", { name: /Approve entries/ });
      await centre(go);
      await go.click();
      await page.waitForURL(/\/registration/, { timeout: 30_000 });
      // The FOURSOMES are open now, on Entries, with the entry that was waiting.
      await expect(page.locator("main"), "the button did not open the tournament the job is in").toContainText(waiting.name);
    });

    // Five days ahead at the club: the medal took entries from 12 days before its first day to 3 days
    // before, so the copy's opening day would already have gone (left empty: open as soon as the link is
    // up) and its closing day is still to come (kept, at its old distance).
    const day = addDays(clubToday, 5);
    const copyName = `${mark} Summer Medal 2027`;
    await test.step("copy last event: last summer's medal, re-dated", async () => {
      await open(page, "/dashboard");
      const card = page.getByRole("region", { name: "Copy last event" });
      await expect(card).toBeVisible();
      await card.getByLabel("Copy from").selectOption({ label: medal.event.name });
      await card.getByLabel("Name of the copy").fill(copyName);
      await card.getByLabel("First day").fill(day);
      await card.getByLabel("Last day (if more than one)").fill(addDays(day, 1));
      const create = card.getByRole("button", { name: "Create the copy" });
      await centre(create);
      await create.click();
      // Into the copy: the bar above every console screen names it.
      await expect(page.getByText(copyName).first(), "the secretary was not taken into the copy").toBeVisible({ timeout: 30_000 });
      await expect(card.getByRole("alert"), "the copy was refused").toHaveCount(0);
    });

    const copy = await prisma.event.findFirstOrThrow({ where: { organizationId: club.orgId, name: copyName }, include: { stages: { orderBy: { position: "asc" } } } });
    await test.step("what came across, field by field against the source row", async () => {
      for (const f of ["format", "shape", "teePolicy", "registrationApproval", "requirePhone", "capacity", "leaderboardVisibility", "flightMode", "flightValue", "customPars", "customStrokeIndex"] as const) {
        expect(copy[f], `the copy's ${f} is not the medal's`).toEqual(source[f]);
      }
      expect(copy.stages.map((s) => [s.format, s.holes, s.scoringBasis, s.handicapAllowance])).toEqual(
        source.stages.map((s) => [s.format, s.holes, s.scoringBasis, s.handicapAllowance]),
      );
      const contests = await prisma.contest.findMany({ where: { eventId: copy.id } });
      expect(contests.map((c) => [c.kind, c.name, c.hole, c.buyInCents, c.sponsorName, c.stageId])).toEqual([
        ["closest-pin", "KP 7th", 7, 200, "Zz Motors", copy.stages[0].id],
      ]);
      const games = await prisma.sideGame.findMany({ where: { eventId: copy.id } });
      expect(games.map((g) => [g.kind, g.buyInCents, g.stageId])).toEqual([["birdies", 500, copy.stages[1].id]]);
    });

    await test.step("what did not: the field, cards, results, money, dates and links", async () => {
      expect(await prisma.player.count({ where: { eventId: copy.id } }), "the copy carried the field").toBe(0);
      expect(await prisma.scorecard.count({ where: { eventId: copy.id } }), "the copy carried cards").toBe(0);
      expect(await prisma.contestEntry.count({ where: { contest: { eventId: copy.id } } }), "the copy carried a winner").toBe(0);
      expect(await prisma.sideGameEntry.count({ where: { sideGame: { eventId: copy.id } } }), "the copy carried a stake").toBe(0);
      expect({ status: copy.status, open: copy.registrationOpen, link: copy.registrationToken }).toEqual({ status: "draft", open: false, link: "" });
      expect(copy.shareToken).not.toBe(source.shareToken);
      // The day picked, and the window and Round 2 at their old distance from it.
      expect([copy.startOn, copy.endOn, copy.regDeadline, copy.regOpens]).toEqual([day, addDays(day, 1), addDays(day, -3), ""]);
      expect(copy.stages.map((s) => s.playedOn)).toEqual([day, addDays(day, 1)]);
      expect(copy.stages.map((s) => s.teeSheetPublished)).toEqual([false, false]);
    });

    let link = "";
    await test.step("published, the copy's sign-up link is a new address", async () => {
      await open(page, "/registration");
      await page.getByRole("button", { name: /Let players sign themselves up/ }).click();
      const publish = page.getByRole("button", { name: "Publish the link" });
      await centre(publish);
      await publish.click();
      await expect(page.getByRole("button", { name: "Take the link down" })).toBeVisible({ timeout: 20_000 });
      link = await page.locator("input").evaluateAll((els) => (els as HTMLInputElement[]).map((e) => e.value).find((v) => v.includes("/register/")) ?? "");
      expect(link, "no sign-up link is shown").toMatch(/\/register\//);
      const token = new URL(link).pathname.split("/").pop();
      expect(token, "the copy answers last year's address").not.toBe(source.registrationToken);
      expect((await prisma.event.findUniqueOrThrow({ where: { id: copy.id } })).registrationToken).toBe(token);

      const visitor = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
      try {
        const v = await visitor.newPage();
        await v.goto(new URL(link).pathname);
        await expect(v.locator("body")).toContainText(copyName);
        await expect(v.getByRole("button", { name: "Register" })).toBeVisible();
        // Last year's address still names last year's tournament, never the copy.
        await v.goto(`/register/${source.registrationToken}`);
        await expect(v.locator("body")).not.toContainText(copyName);
      } finally {
        await visitor.close();
      }
    });

    await test.step("the original is exactly as it was", async () => {
      const after = JSON.stringify({
        source: await prisma.event.findUniqueOrThrow({ where: { id: medal.event.id }, include: { stages: { orderBy: { position: "asc" } } } }),
        players: await prisma.player.count({ where: { eventId: source.id } }),
        cards: await prisma.scorecard.count({ where: { eventId: source.id } }),
        contestEntries: await prisma.contestEntry.count({ where: { contest: { eventId: source.id } } }),
        sideGameEntries: await prisma.sideGameEntry.count({ where: { sideGame: { eventId: source.id } } }),
      });
      expect(after, "copying changed the original").toBe(before);
    });

    await test.step("a Guest reads the same lines and is handed no button and no copy", async () => {
      await signInWith(guestCtx, baseURL!, sessionOf(guest.id), autumn.event.id);
      const g = await guestCtx.newPage();
      watchPageErrors(g, errors, "guest");
      await open(g, "/dashboard");
      const next = g.getByRole("region", { name: "What's next" });
      await expect(next).toContainText("1 entry awaiting approval");
      await expect(next.getByRole("button"), "a Guest was given a job's button").toHaveCount(0);
      await expect(next.getByRole("link"), "a Guest was given a job's link").toHaveCount(0);
      await expect(g.getByRole("region", { name: "Copy last event" }), "a Guest was offered a copy").toHaveCount(0);
      // CONTROL: the secretary, on the same tournament, does have the button.
      await open(page, "/dashboard");
      await expect(page.getByRole("region", { name: "What's next" }).getByRole("button", { name: /Approve entries/ })).toHaveCount(1);
    });
  } finally {
    await guestCtx.close();
    await dropClub(mark);
    await dropClub(`${mark}-nd`);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
