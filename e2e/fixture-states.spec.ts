import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, signInWith, gotoStages, openRound, centre } from "./rounds-fixture";
import {
  themedClub, SECOND_THEME, DEFAULT_THEME_KEY,
  twoRoundsCutAhead, assistantFor, playedCup, threeFlights,
} from "./state-fixtures";

/**
 * THE WORLDS THE SHARED FIXTURE DOES NOT HOLD, EACH WALKED ONCE (master backlog J52, 2026-11-06).
 *
 * `fixture.mjs` is one Verdigris club with one secretary, one live tournament and no cut, no
 * assistant, no finished cup and no more than two flights. Whole states were therefore never opened
 * by any browser. `state-fixtures.ts` builds each; this opens each as the person who would meet it:
 *
 *   a second theme     the accent the console wears is not Verdigris's, and no screen runs sideways in it
 *   a cut not made     two rounds, round 1 played, round 2 cut to the top five: the cut is SET and not MADE
 *   an assistant       staff of one tournament: runs the Rounds screen, is turned away from Access
 *   a cup played out   the report names the team that won and the score, with no empty league table
 *   three flights      a round robin drawn per flight: 3 + 3 + 1 matches, none across two flights
 *
 * Each reads the facts it asserts from the fixture, not from a number typed here. Own clubs
 * (`zz-states-…`), invented names, `@example.invalid`, dropped in a `finally`.
 *
 * WHAT IT CANNOT SEE: the second theme's CONTRAST (`themes.test.ts` grades every preset on both
 * grounds), or the cut being MADE (that is `a-tie-at-the-cut.spec.ts`).
 */

const WALKED = ["desktop", "phone"];
test.describe.configure({ timeout: 120_000 });
test.use({ actionTimeout: 15_000 });
test.afterAll(async () => {
  await prisma.$disconnect();
});

const markFor = (what: string, project: string) => `zz-states-${what}-${project}`;

/** The accent colour a page is wearing, read as the club-theme spec reads it: off a probe inside <main>. */
async function accentOf(page: Page, path: string): Promise<string> {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.locator("main h1")).toBeVisible();
  return page.evaluate(() => {
    const at = document.querySelector("main") ?? document.body;
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;width:0;height:0;color:var(--color-accent)";
    at.appendChild(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
}
const sidewaysBy = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("a club on a second theme wears a different accent, and no screen runs sideways in it", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name === "small-phone", "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const verdigris = await makeClub(markFor("v", testInfo.project.name));
  const other = await themedClub(markFor("t", testInfo.project.name));
  try {
    const a = await makeEvent(verdigris, "Spring Medal", { stages: [{}], players: 4 });
    const b = await makeEvent(other, "Spring Medal", { stages: [{}], players: 4 });
    // Read from the fixture: the two clubs are on the themes we think they are on.
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: verdigris.orgId }, select: { themeKey: true } })).themeKey).toBe(DEFAULT_THEME_KEY);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: other.orgId }, select: { themeKey: true } })).themeKey).toBe(SECOND_THEME);

    await signIn(context, baseURL!, verdigris, a.event.id);
    const was = await accentOf(page, "/dashboard");
    await signIn(context, baseURL!, other, b.event.id);
    const now = await accentOf(page, "/dashboard");
    expect(now, "the second theme's accent is the default theme's").not.toBe(was);

    for (const path of ["/dashboard", "/stages", "/registration"]) {
      await page.goto(`${path}?bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(page.locator("main h1")).toBeVisible();
      expect(await sidewaysBy(page), `${path} runs sideways in ${SECOND_THEME}`).toBeLessThanOrEqual(0);
    }
  } finally {
    await dropClub(markFor("v", testInfo.project.name));
    await dropClub(markFor("t", testInfo.project.name));
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("two rounds with a cut set and not made: round 1 says so, and nothing has been cut", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("cut", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, round1, round2, players, cutCount } = await twoRoundsCutAhead(club);
    await signIn(context, baseURL!, club, event.id);

    // The state itself, from the rows: the cut is on, round 2 has no cut made into it, no card yet.
    const r2 = await prisma.stage.findUniqueOrThrow({ where: { id: round2.id } });
    expect(r2.cutEnabled && r2.cutMadeAt === null, "the fixture's cut is not 'set and not made'").toBe(true);
    expect(await prisma.scorecard.count({ where: { stageId: round2.id } })).toBe(0);
    expect(await prisma.scorecard.count({ where: { stageId: round1.id } })).toBe(players.length);

    await gotoStages(page);
    const card = await openRound(page, round1.id);
    await expect(card.getByText("The cut", { exact: true })).toBeVisible();
    const cut = card.getByRole("checkbox", { name: "Cut the field for Round 2" });
    await centre(cut);
    await expect(cut, "round 1 does not show the cut into round 2 as set").toBeChecked();
    await expect(card.getByRole("spinbutton", { name: "Players who make the cut for Round 2" })).toHaveValue(String(cutCount));

    // Looking made nothing: still not made, and nobody was dropped.
    expect((await prisma.stage.findUniqueOrThrow({ where: { id: round2.id } })).cutMadeAt, "opening the screen made the cut").toBeNull();
    expect(await prisma.player.count({ where: { eventId: event.id, status: "confirmed" } })).toBe(players.length);
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("an assistant runs the Rounds screen and is turned away from Access", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "assistant");
  const mark = markFor("asst", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages } = await makeEvent(club, "Spring Medal", { stages: [{}, {}], players: 4 });
    const asst = await assistantFor(club, event.id);
    // Read from the fixture: the account the assistant signs in as holds the assistant role, and no seat in the club.
    expect((await prisma.account.findFirstOrThrow({ where: { eventId: event.id, email: asst.email } })).role).toBe("assistant");
    expect(await prisma.organizationMember.count({ where: { userId: asst.userId } }), "the assistant is also a member of the club").toBe(0);

    await signInWith(context, baseURL!, asst.session, event.id);
    await gotoStages(page);
    await openRound(page, stages[0].id);

    await page.goto(`/access?bust=${Date.now()}`);
    await expect(page, "an assistant stayed on Access").not.toHaveURL(/\/access/);
    await expect(page.locator("main h1")).toBeVisible();
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a cup played to its end: the report names the winners and the score, and has no league table", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name === "small-phone", "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("cup", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const cup = await playedCup(club);
    await signIn(context, baseURL!, club, cup.event.id);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: cup.event.id } })).status, "the fixture's cup is not finished").toBe("completed");
    expect(await prisma.match.count({ where: { eventId: cup.event.id, scoreStatus: "confirmed" } }), "the fixture's cup has unconfirmed matches").toBe(4);

    await page.goto(`/reports?bust=${Date.now()}`);
    const sheet = page.locator(".print-card");
    await expect(sheet, "the report sheet did not load").toContainText("Final result", { timeout: 30_000 });
    await expect(sheet).toContainText(`${cup.winner} won the cup ${cup.score}`);
    await expect(sheet.locator("tr", { hasText: cup.loser })).toBeVisible();
    await expect(sheet, "a cup shows the round-robin's empty standings").not.toContainText("Final standings");
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a round robin in three flights is drawn within each flight, and across none", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("three", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages, players, flights } = await threeFlights(club);
    expect(flights, "the fixture did not make three flights").toHaveLength(3);
    const sizes = flights.map((f) => players.filter((p) => p.groupId === f.id).length);
    // Pairs inside a flight of n: n(n-1)/2. Worked from the fixture's own flights, not typed.
    const expected = sizes.reduce((sum, n) => sum + (n * (n - 1)) / 2, 0);
    expect(expected, "an uneven field of eight in three flights is 3 + 3 + 1").toBe(7);

    const second = stages[1];
    await signIn(context, baseURL!, club, event.id);
    const matches = () => prisma.match.findMany({ where: { eventId: event.id, stageId: second.id } });
    expect(await matches()).toHaveLength(0);

    await gotoStages(page);
    const card = await openRound(page, second.id);
    const draw = card.getByRole("button", { name: "Draw Round 2's matches", exact: true });
    await centre(draw);
    await draw.click();
    await expect.poll(async () => (await matches()).length, { message: "Round 2 was not drawn flight by flight" }).toBe(expected);

    const flightOf = new Map(players.map((p) => [p.id, p.groupId]));
    const drawn = await matches();
    expect(drawn.every((m) => flightOf.get(m.playerAId) === flightOf.get(m.playerBId)), "a match was drawn across two flights").toBe(true);
    for (const f of flights) {
      const inFlight = drawn.filter((m) => flightOf.get(m.playerAId) === f.id).length;
      const n = players.filter((p) => p.groupId === f.id).length;
      expect(inFlight, `${f.name}: every pair meets once`).toBe((n * (n - 1)) / 2);
    }
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
