import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, centre, CARD_PARS, NAMES } from "./rounds-fixture";

/**
 * MEMBERS, AS THE SECRETARY KEEPS THEM: a club handicap the committee accepts
 * from a member's own cards, and a field brought onto the club's list.
 *
 * `acceptClubHandicap` and `addFieldToRoster` were performed by no browser test
 * (the reach baseline, 2026-10-21):
 *
 *   a club handicap   three approved medal cards off rated tees; the record says
 *                     what they give BY THE RULES (Appendix E: three scores, the
 *                     lowest differential less 2.0 — worked here, not asked of
 *                     the app); Set stores it on the roster, as the club's own
 *                     figure, and leaves the rounds already played alone
 *   an association's  a member whose index comes from their association is shown
 *                     the same record and offered nothing: nothing stored
 *   the field         four entries, one of whom is already a member by address:
 *                     "Add 3 to the roster" makes three members from the entries
 *                     — names, addresses and handicaps as entered — points the
 *                     entries at them, and makes nobody twice
 *
 * WHAT IT CANNOT SEE: either action's refusals through the screen — the Set
 * button is drawn only where the action would accept, and the field banner only
 * where there is somebody to add. `handicap-record.audit.test.ts` holds the
 * gathering of the cards; the every-action sweep calls both as a stranger.
 */

const WALKED = ["desktop", "phone"];
const markFor = (what: string, project: string) => `zz-rhf-${what}-${project}`;

test.describe.configure({ timeout: 150_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  await dropClub("zz-rhf-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

async function openMembers(page: Page) {
  await page.goto(`/roster?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  expect(new URL(page.url()).pathname, "sent away from Members — not signed in?").toBe("/roster");
  await expect(page.locator("main h1")).toHaveText("Members");
}

// ── The Rule, worked here (Rules of Handicapping 5.1, 5.2, Appendix E) ─────────
const TEE = { courseRating: 74.9, slopeRating: 144, par: 71 };
/** A card `over` shots worse than par, a bogey at a time — no hole is past net double bogey. */
const cardOf = (over: number) => CARD_PARS.map((p, i) => p + (i < over ? 1 : 0));
/** A score differential: (113 / Slope) × (adjusted gross − Course Rating), to the nearest tenth. */
const differential = (gross: number) => Math.round(((113 / TEE.slopeRating) * (gross - TEE.courseRating)) * 10) / 10;

test("three approved cards give a club handicap the committee accepts; an association's member is offered none", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("hcp", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const course = await prisma.course.create({
      data: {
        organizationId: club.orgId,
        name: `${mark} Hollins Moss`,
        pars: JSON.stringify(CARD_PARS),
        strokeIndex: JSON.stringify([7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14]),
        yards: JSON.stringify(new Array(18).fill(380)),
      },
    });
    const tee = await prisma.tee.create({ data: { courseId: course.id, name: "Blue", gender: "any", ...TEE } });
    const { event, stages, players } = await makeEvent(club, "Monthly Medals", {
      status: "completed",
      stages: [{ playedOn: "2026-05-02" }, { playedOn: "2026-06-06" }, { playedOn: "2026-07-04" }],
      players: 2,
    });
    await prisma.eventCourse.create({ data: { eventId: event.id, courseId: course.id } });
    for (const s of stages) await prisma.stage.update({ where: { id: s.id }, data: { courseId: course.id } });

    // Ffion keeps her handicap with the club; Tomás's comes from his association.
    const ffion = await prisma.member.create({
      data: { organizationId: club.orgId, name: NAMES[0], email: players[0].email, handicap: 18, handicapSource: "manual" },
    });
    const tomas = await prisma.member.create({
      data: { organizationId: club.orgId, name: NAMES[1], email: players[1].email, handicap: 18, handicapSource: "ghin" },
    });
    for (const [p, m] of [[players[0], ffion], [players[1], tomas]] as const) {
      await prisma.player.update({ where: { id: p.id }, data: { memberId: m.id, teeId: tee.id, handicap: 18 } });
    }
    const overs = [16, 14, 18];
    for (const [i, s] of stages.entries()) {
      for (const p of players) {
        await prisma.scorecard.create({
          data: { eventId: event.id, stageId: s.id, playerId: p.id, strokes: JSON.stringify(cardOf(overs[i])), status: "approved" },
        });
      }
    }
    // Three scores: the lowest differential, less 2.0 (Appendix E, Table 5.2a).
    const lowest = Math.min(...overs.map((o) => differential(cardOf(o).reduce((a, b) => a + b, 0))));
    const expected = Math.round((lowest - 2.0) * 10) / 10;
    expect(expected, "the worked handicap is not a plausible figure for these cards").toBeGreaterThan(3);
    const figure = expected.toFixed(1);

    await signIn(context, baseURL!, club, event.id);
    await openMembers(page);

    // ── the association's member: the record, and nothing offered ──
    await centre(page.getByRole("button", { name: `Handicap record for ${NAMES[1]}`, exact: true }));
    await page.getByRole("button", { name: `Handicap record for ${NAMES[1]}`, exact: true }).click();
    const tomasPanel = page.locator(".card", { has: page.getByText(`${NAMES[1]} — what their cards say`, { exact: true }) }).last();
    await expect(tomasPanel.getByText("3 approved cards, of which 3 could be scored for handicap.")).toBeVisible({ timeout: 20_000 });
    await expect(tomasPanel.getByText(/Their handicap comes from their association, so\s+TourneyHQ won.t replace it/)).toBeVisible();
    await expect(tomasPanel.getByRole("button", { name: /^Set .* to / }), "an association's member was offered a club handicap").toHaveCount(0);
    await tomasPanel.getByRole("button", { name: "Close", exact: true }).click();

    // ── Ffion: what her cards say, by the Rule, and accepted ──
    await centre(page.getByRole("button", { name: `Handicap record for ${NAMES[0]}`, exact: true }));
    await page.getByRole("button", { name: `Handicap record for ${NAMES[0]}`, exact: true }).click();
    const panel = page.locator(".card", { has: page.getByText(`${NAMES[0]} — what their cards say`, { exact: true }) }).last();
    await expect(panel.getByText("3 approved cards, of which 3 could be scored for handicap.")).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByText(/from the lowest 1 of 3, -2 adjustment/)).toBeVisible();
    const set = panel.getByRole("button", { name: `Set ${NAMES[0]} to ${figure}`, exact: true });
    await expect(set, `the record does not offer the Rule's ${figure}`).toBeVisible();
    await centre(set);
    await set.click();
    await expect(panel.getByText(`${NAMES[0]} now plays off ${figure}. Rounds already played are unchanged.`)).toBeVisible();

    const after = await prisma.member.findUniqueOrThrow({ where: { id: ffion.id } });
    expect({ handicap: after.handicap, source: after.handicapSource }, "the club handicap was not stored as the club's own figure").toEqual({
      handicap: expected,
      source: "manual",
    });
    // The rounds she played keep what she played them off.
    expect((await prisma.player.findUniqueOrThrow({ where: { id: players[0].id } })).handicap).toBe(18);
    // And the association's member is exactly as he was.
    expect((await prisma.member.findUniqueOrThrow({ where: { id: tomas.id } })).handicap).toBe(18);

    await openMembers(page);
    const row = page.locator("tbody tr").filter({ hasText: NAMES[0] }).first();
    await expect(row.getByText(figure, { exact: true }).first(), "the roster does not show the accepted handicap after a reload").toBeVisible();
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a field entered before the club list existed is brought onto it, and nobody is made twice", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("field", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, players } = await makeEvent(club, "Charity Shield", { stages: [{}], players: 4 });
    // Kiri is already a member — by her address, with no link from her entry.
    const kiri = await prisma.member.create({
      data: { organizationId: club.orgId, name: NAMES[2], email: players[2].email.toUpperCase(), handicap: 12.8, handicapSource: "manual" },
    });
    await signIn(context, baseURL!, club, event.id);
    const members = () => prisma.member.findMany({ where: { organizationId: club.orgId }, orderBy: { name: "asc" } });
    expect(await members()).toHaveLength(1);

    await openMembers(page);
    const banner = page.locator(".card", { has: page.getByText(/3 in .*Charity Shield aren.t on the roster/) });
    await expect(banner, "the screen does not say three of the field are not on the roster").toBeVisible();
    const add = banner.getByRole("button", { name: "Add 3 to the roster", exact: true });
    await centre(add);
    await add.click();
    await expect(page.getByText("3 added to the roster from the field.")).toBeVisible({ timeout: 20_000 });

    const now = await members();
    expect(now, "the field was not made into exactly three new members").toHaveLength(4);
    expect(now.filter((m) => m.id === kiri.id), "the member already on the list was made again").toHaveLength(1);
    for (const i of [0, 1, 3]) {
      const m = now.find((x) => x.name === NAMES[i]);
      expect(m, `${NAMES[i]} is not on the roster`).toBeTruthy();
      expect({ email: m!.email.toLowerCase(), handicap: m!.handicap }, `${NAMES[i]}'s roster details are not what they entered with`).toEqual({
        email: players[i].email.toLowerCase(),
        handicap: players[i].handicap,
      });
      const entry = await prisma.player.findUniqueOrThrow({ where: { id: players[i].id } });
      expect(entry.memberId, `${NAMES[i]}'s entry does not point at their new member row`).toBe(m!.id);
    }

    await openMembers(page);
    await expect(page.getByText(/aren.t on the roster/), "the banner is still there after the field was added").toHaveCount(0);
    for (const name of NAMES.slice(0, 4)) await expect(page.locator("tbody tr").filter({ hasText: name }), `${name} is not on the roster once`).toHaveCount(1);
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
