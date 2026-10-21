import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import {
  prisma,
  makeClub,
  dropClub,
  makeEvent,
  signIn,
  signInWith,
  memberSession,
  gotoStages,
  openRound,
  centre,
  saidBeside,
  addDays,
  dayIn,
  NAMES,
} from "./rounds-fixture";

/**
 * A LEAGUE'S WEEKLY SIGN-UP, FROM BOTH ENDS: a member says they cannot make
 * next week, the secretary closes the week's sign-up, the member is refused
 * when they change their mind too late, and the secretary — whom the deadline
 * does not bind — puts them back in.
 *
 * `setAttendance` and `setStageOptDeadline` were performed by no browser test
 * (the reach baseline, 2026-10-21). Two people, two browsers:
 *
 *   the member      on their Today, "Can't make it" for the next round: stored
 *                   as their own answer, under their name, and said back to them
 *                   ("You're not playing …") after a reload
 *   the secretary   sees it on the round ("3 in (3 by default) · 1 out") and on
 *                   the tee sheet's list ("Recorded by" the member); sets the
 *                   sign-up deadline to yesterday — stored, and kept on reload
 *   the member      still holding the screen from before, changes their mind:
 *                   REFUSED, in words, beside the press — and nothing stored;
 *                   reloaded, the week reads "Answers closed — ask the organizer"
 *   the secretary   marks them In on the tee sheet, after the deadline: stored,
 *                   under the secretary's name, and the count moves
 *
 * WHAT IT CANNOT SEE: a captains league (the club records every answer;
 * `security.spec` and the every-action sweep hold the refusals), and the
 * calendar's own toggle (`setOwnAttendance`, `player-calendar.spec`).
 */

const WALKED = ["desktop", "phone"];
const markFor = (project: string) => `zz-wsu-${project}`;

test.describe.configure({ timeout: 180_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  await dropClub("zz-wsu-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

async function openToday(page: Page) {
  await page.goto(`/me?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  expect(new URL(page.url()).pathname, "the member was sent away from Today — not signed in?").toBe("/me");
}

test("a member is out for next week, is refused a late change of mind, and the secretary puts them back in", async ({ page, context, baseURL, browser }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor(testInfo.project.name);
  const club = await makeClub(mark);
  const today = dayIn("");
  const memberCtx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
  try {
    const { event, stages, players } = await makeEvent(club, "Thursday League", {
      status: "live",
      stages: [
        { playedOn: addDays(today, 7), format: "Stroke Play" },
        { playedOn: addDays(today, 14), format: "Stroke Play" },
      ],
      players: 4,
      event: { attendanceMode: "opt-out" },
    });
    const round = stages[0];
    await prisma.stage.update({ where: { id: round.id }, data: { optDeadline: addDays(today, 5) } });
    const ffion = players[0];
    const { session } = await memberSession(event.id, ffion.email, ffion.name);
    await signIn(context, baseURL!, club, event.id);
    await signInWith(memberCtx, baseURL!, session, event.id);
    const member = await memberCtx.newPage();
    watchPageErrors(member, errors, "member");

    const answer = () => prisma.roundAttendance.findUnique({ where: { stageId_playerId: { stageId: round.id, playerId: ffion.id } } });
    expect(await answer(), "an answer exists before anybody gave one").toBeNull();

    // ── the member: can't make it ──
    await openToday(member);
    const card = member.getByRole("region", { name: "Your availability" });
    await expect(card.getByText("Are you playing?", { exact: true })).toBeVisible();
    await expect(card.getByText("You’re down as playing until you say.")).toBeVisible();
    const cant = card.getByRole("button", { name: "Can't make it", exact: true });
    await centre(cant);
    await cant.click();
    await expect.poll(async () => (await answer())?.status ?? null, { message: "the member's 'out' was not stored" }).toBe("out");
    expect((await answer())!.decidedBy, "the answer is not under the member's own name").toBe(ffion.name);
    await openToday(member);
    await expect(card.getByText(/^You.re not playing /), "the member is not told they are out, after a reload").toBeVisible();
    const change = card.getByRole("button", { name: "Change", exact: true });
    await expect(change).toBeVisible();

    // ── the secretary: the round counts it, and the week's sign-up is closed ──
    await gotoStages(page);
    let roundCard = await openRound(page, round.id);
    const deadline = roundCard.getByLabel("Sign-up deadline", { exact: true });
    await expect(roundCard.getByText(/3 in \(3 by default\) · 1 out/), "the round does not count the member out").toBeVisible();
    const yesterday = addDays(today, -1);
    await centre(deadline);
    await deadline.fill(yesterday);
    await expect
      .poll(async () => (await prisma.stage.findUniqueOrThrow({ where: { id: round.id } })).optDeadline, { message: "the sign-up deadline was not stored" })
      .toBe(yesterday);
    await gotoStages(page);
    roundCard = await openRound(page, round.id);
    await expect(roundCard.getByLabel("Sign-up deadline", { exact: true }), "the deadline did not survive a reload").toHaveValue(yesterday);

    // ── the member, on the screen they already had open: too late ──
    await centre(change);
    await change.click();
    const playing = card.getByRole("button", { name: /I.m playing/ });
    await centre(playing);
    await playing.click();
    const refused = card.locator(".form-error", { hasText: "The sign-up window for this round has closed — ask the organizer to change it." });
    await expect(refused, "a change after the deadline was not refused in words").toBeVisible();
    await saidBeside(refused, card.getByRole("button", { name: "Change", exact: true }), "a member's late change of mind");
    expect((await answer())!.status, "the refused change was stored").toBe("out");
    await openToday(member);
    await expect(card.getByText("Answers closed — ask the organizer")).toBeVisible();
    await expect(card.getByText(/^You.re not playing /)).toBeVisible();

    // ── the secretary, whom the deadline does not bind, puts them back ──
    await page.goto(`/foursomes?round=${round.id}&bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const list = page.locator(".card", { has: page.getByText("Who is playing Round 1", { exact: true }) });
    await expect(list.getByText(/3 in \(3 by default\) · 1 out/), "the tee sheet's list does not have the member out").toBeVisible();
    await list.getByRole("button", { name: /Edit the list/ }).click();
    const row = list.locator("tr", { has: page.getByText(ffion.name, { exact: true }) });
    await expect(row.getByRole("radio", { name: "Out", exact: true })).toBeChecked();
    await expect(row.locator("td").last(), "the list does not say who recorded the answer").toHaveText(ffion.name);
    const inLabel = row.getByRole("radio", { name: "In", exact: true }).locator("xpath=ancestor::label[1]");
    await centre(inLabel);
    await inLabel.click();
    await expect.poll(async () => (await answer())?.status, { message: "the secretary's In was not stored after the deadline" }).toBe("in");
    expect((await answer())!.decidedBy, "the change is not under the secretary's name").toBe("Rowan Secretary");
    await page.goto(`/foursomes?round=${round.id}&bust=${Date.now()}`);
    await expect(list.getByText(/^4 in \(3 by default\) · 0 out$/), "the count did not move when the secretary put the member in").toBeVisible();
    await openToday(member);
    await expect(card.getByText(/^You.re playing /), "the member is not told they are back in").toBeVisible();
  } finally {
    await memberCtx.close();
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
