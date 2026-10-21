import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, signInWith, memberSession, returnCard, centre, saidBeside } from "./rounds-fixture";

/**
 * THE TWO PRESSES THAT CANNOT BE UNDONE: a member deletes their account, and a
 * secretary deletes their club. Both on throwaway rows made here, and both
 * checked for what went AND for what did not.
 *
 * `deleteMyAccount` and `deleteClub` were performed by no browser test (the
 * reach baseline, 2026-10-21):
 *
 *   the account   asked first — the address typed, then "for good"; a wrong
 *                 address is refused beside the press and nothing goes; "Keep"
 *                 keeps it; then the sign-in and every access row are gone, the
 *                 member is signed out, and what the CLUB keeps — their entry,
 *                 their card, their roster row — and every other member are
 *                 exactly as they were. A sole Commissioner is not offered it.
 *   the club      the same two steps against the club's name; then the club,
 *                 its tournaments, entries, cards and roster are gone, and the
 *                 secretary's OTHER club, their own sign-in, and everything in
 *                 it are untouched
 *
 * WHAT IT CANNOT SEE: a club with a paid plan running, which is refused before
 * the box is offered (`club-deletion.test.ts`), and push subscriptions — the
 * bench has none to delete.
 */

const WALKED = ["desktop", "phone"];
const markFor = (what: string, project: string) => `zz-dfg-${what}-${project}`;

test.describe.configure({ timeout: 180_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  await dropClub("zz-dfg-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

test("a member deletes their account: asked first, refused a wrong address, and the club keeps what is the club's", async ({ page, context, baseURL, browser }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  const mark = markFor("acct", testInfo.project.name);
  const club = await makeClub(mark);
  const theirs = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
  try {
    const { event, stages, players } = await makeEvent(club, "Club Medal", { status: "live", stages: [{}], players: 3 });
    const [leaving, staying] = [players[0], players[1]];
    for (const p of [leaving, staying]) {
      await prisma.member.create({ data: { organizationId: club.orgId, name: p.name, email: p.email, handicap: p.handicap } });
      await returnCard(event.id, stages[0].id, p.id);
    }
    const gone = await memberSession(event.id, leaving.email, leaving.name);
    const kept = await memberSession(event.id, staying.email, staying.name);
    await signInWith(theirs, baseURL!, gone.session, event.id);
    const me = await theirs.newPage();
    watchPageErrors(me, errors, "leaving member");
    const snapshot = async () => ({
      user: await prisma.user.count({ where: { id: gone.userId } }),
      access: await prisma.account.count({ where: { email: leaving.email } }),
      entry: await prisma.player.count({ where: { id: leaving.id } }),
      card: await prisma.scorecard.count({ where: { playerId: leaving.id } }),
      roster: await prisma.member.count({ where: { organizationId: club.orgId, email: leaving.email } }),
      other: (await prisma.user.count({ where: { id: kept.userId } })) + (await prisma.account.count({ where: { email: staying.email } })),
      club: await prisma.organization.count({ where: { id: club.orgId } }),
      tournament: await prisma.event.count({ where: { id: event.id } }),
    });
    const before = { user: 1, access: 1, entry: 1, card: 1, roster: 1, other: 2, club: 1, tournament: 1 };
    expect(await snapshot()).toEqual(before);

    await me.goto(`/account?bust=${Date.now()}`);
    await me.waitForLoadState("networkidle").catch(() => {});
    const section = me.locator("section", { has: me.getByRole("heading", { name: "Delete my account" }) });
    const box = section.getByLabel(/Type .* to confirm/);
    const del = section.getByRole("button", { name: "Delete my account", exact: true });

    // ── a wrong address: refused where they pressed, nothing gone ──
    await box.fill("somebody-else@example.invalid");
    await centre(del);
    await del.click();
    await section.getByRole("button", { name: /Delete my account for good/ }).click();
    const refused = section.getByRole("alert").filter({ hasText: "Type your account's email address exactly to confirm." });
    await expect(refused, "a wrong address was not refused in words").toBeVisible();
    await saidBeside(refused, del, "deleting an account with the wrong address typed");
    expect(await snapshot(), "a refused deletion deleted something").toEqual(before);

    // ── asked first: Keep keeps it ──
    await box.fill(leaving.email);
    await del.click();
    await expect(section.getByRole("button", { name: /Delete my account for good/ })).toBeVisible();
    await section.getByRole("button", { name: "Keep", exact: true }).click();
    await expect(section.getByRole("button", { name: /Delete my account for good/ })).toHaveCount(0);
    expect(await snapshot(), "Keep deleted something").toEqual(before);

    // ── for good ──
    await del.click();
    await section.getByRole("button", { name: /Delete my account for good/ }).click();
    await me.waitForURL((u) => u.pathname === "/", { timeout: 30_000 });
    await expect
      .poll(snapshot, { message: "the account went, or the club's rows did not stay" })
      .toEqual({ ...before, user: 0, access: 0 });
    // Signed out: the phone that held the account opens nothing of the club.
    await me.goto(`/me?bust=${Date.now()}`);
    expect(new URL(me.url()).pathname, "a deleted account still opens the player app").not.toBe("/me");

    // A club's only Commissioner is not offered it at all.
    watchPageErrors(page, errors, "secretary");
    await signIn(context, baseURL!, club, event.id);
    await page.goto(`/account?bust=${Date.now()}`);
    const own = page.locator("section", { has: page.getByRole("heading", { name: "Delete my account" }) });
    await expect(own.getByRole("note"), "the club's only Commissioner is not told why they cannot delete their account").toContainText(
      `You’re the only Commissioner of ${mark} Golf Society`,
    );
    await expect(own.getByRole("button", { name: "Delete my account", exact: true })).toHaveCount(0);
  } finally {
    await theirs.close();
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a secretary deletes their club: asked against its name, and their other club is untouched", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("club", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const doomed = await makeEvent(club, "Practice League", { status: "live", stages: [{}], players: 3 });
    for (const p of doomed.players) await returnCard(doomed.event.id, doomed.stages[0].id, p.id);
    await prisma.member.create({ data: { organizationId: club.orgId, name: doomed.players[0].name, email: doomed.players[0].email } });
    // The same secretary's other club, with a tournament of its own.
    const other = await prisma.organization.create({ data: { name: `${mark} Keep Golf Club`, kind: "club" } });
    await prisma.organizationMember.create({ data: { organizationId: other.id, userId: club.userId, role: "owner" } });
    const kept = await makeEvent({ ...club, orgId: other.id }, "Members' Medal", { stages: [{}], players: 2 });
    for (const p of kept.players) await returnCard(kept.event.id, kept.stages[0].id, p.id);

    const snapshot = async () => ({
      club: await prisma.organization.count({ where: { id: club.orgId } }),
      tournaments: await prisma.event.count({ where: { organizationId: club.orgId } }),
      entries: await prisma.player.count({ where: { eventId: doomed.event.id } }),
      cards: await prisma.scorecard.count({ where: { eventId: doomed.event.id } }),
      roster: await prisma.member.count({ where: { organizationId: club.orgId } }),
      secretary: await prisma.user.count({ where: { id: club.userId } }),
      otherClub: await prisma.organization.count({ where: { id: other.id } }),
      otherEntries: await prisma.player.count({ where: { eventId: kept.event.id } }),
      otherCards: await prisma.scorecard.count({ where: { eventId: kept.event.id } }),
      otherSeat: await prisma.organizationMember.count({ where: { organizationId: other.id, userId: club.userId } }),
    });
    const before = { club: 1, tournaments: 1, entries: 3, cards: 3, roster: 1, secretary: 1, otherClub: 1, otherEntries: 2, otherCards: 2, otherSeat: 1 };
    expect(await snapshot()).toEqual(before);
    await signIn(context, baseURL!, club, doomed.event.id);

    await page.goto(`/organization?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Delete this club" }) });
    const box = section.getByLabel(/Type .* to confirm/);
    const del = section.getByRole("button", { name: "Delete club", exact: true });

    await box.fill(`${mark} Golf Societ`);
    await centre(del);
    await del.click();
    await section.getByRole("button", { name: "Delete the club for good" }).click();
    const refused = section.getByRole("alert").filter({ hasText: "Type the club's name exactly as it appears to confirm." });
    await expect(refused, "a wrong name was not refused in words").toBeVisible();
    await saidBeside(refused, del, "deleting a club with the wrong name typed");
    expect(await snapshot(), "a refused deletion deleted something").toEqual(before);

    await box.fill(`${mark} Golf Society`);
    await del.click();
    await section.getByRole("button", { name: "Keep", exact: true }).click();
    await expect(section.getByRole("button", { name: "Delete the club for good" })).toHaveCount(0);
    expect(await snapshot(), "Keep deleted something").toEqual(before);

    await del.click();
    await section.getByRole("button", { name: "Delete the club for good" }).click();
    await page.waitForURL(/\/choose/, { timeout: 30_000 });
    await expect
      .poll(snapshot, { message: "the club did not go with everything in it, or something else went with it" })
      .toEqual({ ...before, club: 0, tournaments: 0, entries: 0, cards: 0, roster: 0 });
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
