import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, signInWith, memberSession, centre } from "./rounds-fixture";

/**
 * A QUICK ROUND, KEPT BY WHOEVER SET IT UP.
 *
 * A casual round deletes itself about a day after it is set up, and the only
 * reason that is acceptable is that its people are TOLD, and whoever set it up
 * can stop it in one press. `keepRound` was performed by no browser test (the
 * reach baseline, 2026-10-21):
 *
 *   the host       is told, and has Keep round; pressed, the round's expiry is
 *                  gone from the database and the warning from the screen — and
 *                  stays gone after a reload
 *   the partner    is told too, with the remedy they actually have ("ask whoever
 *                  set it up"), and no button: `keepRound` is staff-only
 *   on Par         a round on the free plan's terms keeps its day: the host is
 *                  offered "See plans" instead, and nothing is stored
 *
 * WHAT IT CANNOT SEE: the round actually being deleted when its day is up (the
 * sweep that does it is `round-expiry` on the server, held by
 * `round-expiry.audit.test.ts`), and a refusal through the screen — the button
 * is drawn only where the action would accept.
 */

const WALKED = ["desktop", "phone"];
const markFor = (what: string, project: string) => `zz-crk-${what}-${project}`;

test.describe.configure({ timeout: 150_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  await dropClub("zz-crk-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

async function openToday(page: Page) {
  await page.goto(`/me?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** A Sunday four-ball set up by the club's secretary on their own account, with a friend in it. */
async function quickRound(mark: string, opts: { plan?: string; planTermsApply?: boolean }) {
  const club = await makeClub(mark, opts);
  await prisma.organization.update({ where: { id: club.orgId }, data: { kind: "personal" } });
  const host = await prisma.user.findUniqueOrThrow({ where: { id: club.userId } });
  const { event, players } = await makeEvent(club, "Sunday Fourball", {
    status: "live",
    stages: [{ format: "Stroke Play", scoringBasis: "gross" }],
    players: 2,
    event: { shape: "match", expiresAt: new Date(Date.now() + 20 * 3600_000) },
  });
  // The host plays in it too, under their own address.
  await prisma.player.update({ where: { id: players[0].id }, data: { email: host.email, name: host.name } });
  return { club, event, partner: players[1] };
}

test("whoever set up a quick round keeps it in one press; their partner is told whom to ask", async ({ page, context, baseURL, browser }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "host");
  const mark = markFor("keep", testInfo.project.name);
  const partnerCtx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
  try {
    const { club, event, partner } = await quickRound(mark, { plan: "society" });
    const expiry = async () => (await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).expiresAt;
    expect(await expiry(), "the round has no expiry to keep it from").not.toBeNull();
    const { session } = await memberSession(event.id, partner.email, partner.name);
    await signIn(context, baseURL!, club, event.id);
    await signInWith(partnerCtx, baseURL!, session, event.id);
    const partnerPage = await partnerCtx.newPage();
    watchPageErrors(partnerPage, errors, "partner");

    // The partner is told, and given the remedy they have — not a button.
    await openToday(partnerPage);
    await expect(partnerPage.getByText("Deleted after a day — ask whoever set it up to keep it."), "the partner is not told the round is temporary").toBeVisible();
    await expect(partnerPage.getByRole("button", { name: /^Keep (round|this round)$/ }), "the partner was offered a keep they cannot do").toHaveCount(0);

    await openToday(page);
    await expect(page.getByText("Deleted after a day.", { exact: true }), "the host is not told the round is temporary").toBeVisible();
    const keep = page.getByRole("button", { name: "Keep round", exact: true });
    await centre(keep);
    await keep.click();
    await expect.poll(expiry, { message: "Keep round did not take the round's expiry away" }).toBeNull();
    await expect(page.getByText("Deleted after a day.", { exact: true })).toHaveCount(0);

    await openToday(page);
    await expect(page.getByText(/Deleted after a day/), "a kept round still says it will be deleted, after a reload").toHaveCount(0);
    await openToday(partnerPage);
    await expect(partnerPage.getByText(/Deleted after a day/), "the partner is still told a kept round will be deleted").toHaveCount(0);
  } finally {
    await partnerCtx.close();
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("on the free plan's terms a quick round keeps its day: the host is offered the plans, and nothing is kept", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "host");
  const mark = markFor("par", testInfo.project.name);
  try {
    const { club, event } = await quickRound(mark, { plan: "free", planTermsApply: true });
    const before = (await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).expiresAt;
    await signIn(context, baseURL!, club, event.id);
    await openToday(page);
    await expect(page.getByText("Deleted after a day.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "See plans", exact: true }), "the host on Par is not shown the remedy that exists").toBeVisible();
    await expect(page.getByRole("button", { name: "Keep round", exact: true }), "a round that cannot be kept was offered Keep").toHaveCount(0);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).expiresAt).toEqual(before);
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
