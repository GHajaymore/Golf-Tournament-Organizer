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
} from "./rounds-fixture";

/**
 * THE MATCHES A COMMITTEE MAKES DURING A TOURNAMENT, made as the secretary
 * makes them on Rounds & formats and the Bracket — and the one each refuses.
 *
 * `generateNextRound`, `createThirdPlaceMatch`, `createSingleMatch` and
 * `rejectBracketReport` were performed by no browser test (the reach baseline,
 * 2026-10-21):
 *
 *   the second round robin   drawn once the tournament is live: in each flight
 *                            of four, everybody against everybody once — six a
 *                            flight, and nobody across flights; with a hole
 *                            played, Redraw is REFUSED beside the press
 *   the play-off for third   between the two BEATEN semi-finalists, never the
 *                            two who go through (the semis are an upset, so a
 *                            seed-order guess gives the wrong pair); made once —
 *                            a second secretary's press is refused beside it
 *   a named final            the two players the rule names, once; a second
 *                            press is refused beside it
 *   a reported result        turned down: the report is gone, nothing goes on
 *                            the draw, and the player who reported it may report
 *                            again; turning down one already dealt with is
 *                            refused in words
 *
 * The second press in each is a SECOND SECRETARY on another screen — the way a
 * club with two people on the committee meets these refusals, since the screen
 * stops offering the button once the match exists.
 *
 * WHAT IT CANNOT SEE: a cut between the round robins (`the-cut-a-round-is-played-for.spec`),
 * and the matches being played (`match-results.spec`, `organizer-knockout.spec`).
 */

const WALKED = ["desktop", "phone"];
const markFor = (what: string, project: string) => `zz-dpo-${what}-${project}`;

test.describe.configure({ timeout: 180_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  await dropClub("zz-dpo-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

const KNOCKOUT = { shape: "knockout", qualifyMode: "overall", qualifyOverall: 4, bracketMode: "single" };

test("the second round robin is drawn within each flight, and is not redrawn over a hole played", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("rr2", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages, players, flights } = await makeEvent(club, "Winter Groups", {
      status: "live",
      stages: [
        { type: "Round Robin", format: "Match Play", scoringBasis: "net" },
        { type: "Round Robin", format: "Match Play", scoringBasis: "net" },
      ],
      players: 8,
      flights: 2,
    });
    const second = stages[1];
    await signIn(context, baseURL!, club, event.id);
    const matches = () => prisma.match.findMany({ where: { eventId: event.id, stageId: second.id }, orderBy: { id: "asc" } });
    expect(await matches()).toHaveLength(0);

    await gotoStages(page);
    let card = await openRound(page, second.id);
    const draw = card.getByRole("button", { name: "Draw Round 2's matches", exact: true });
    await centre(draw);
    await draw.click();
    await expect.poll(async () => (await matches()).length, { message: "Round 2 was not drawn as two round robins of six" }).toBe(12);

    const flightOf = new Map(players.map((p) => [p.id, p.groupId]));
    const drawn = await matches();
    for (const f of flights) {
      const inFlight = players.filter((p) => p.groupId === f.id).map((p) => p.id);
      const pairs = drawn
        .filter((m) => flightOf.get(m.playerAId) === f.id || flightOf.get(m.playerBId) === f.id)
        .map((m) => [m.playerAId, m.playerBId].sort().join("|"));
      expect(new Set(pairs).size, `${f.name} has a pairing twice, or not six`).toBe(6);
      for (let a = 0; a < inFlight.length; a++) {
        for (let b = a + 1; b < inFlight.length; b++) expect(pairs, `${f.name}: two of its players never meet`).toContain([inFlight[a], inFlight[b]].sort().join("|"));
      }
    }
    expect(drawn.every((m) => flightOf.get(m.playerAId) === flightOf.get(m.playerBId)), "a match was drawn across two flights").toBe(true);

    // ── a hole played in Round 2, then Redraw ──
    const holes = JSON.parse(drawn[0].holes) as (string | null)[];
    holes[0] = "A";
    await prisma.match.update({ where: { id: drawn[0].id }, data: { holes: JSON.stringify(holes) } });
    await gotoStages(page);
    card = await openRound(page, second.id);
    const redraw = card.getByRole("button", { name: "Redraw Round 2's matches", exact: true });
    await expect(redraw, "after a reload the round does not know it is drawn").toBeVisible();
    await centre(redraw);
    await redraw.click();
    const refused = card.getByRole("alert").filter({ hasText: "Not drawn. That round already has scores, so drawing it again would wipe them." });
    await expect(refused, "a redraw over a played hole was not refused in words").toBeVisible();
    await saidBeside(refused, redraw, "redrawing a round with a hole played");
    expect((await matches()).map((m) => m.id), "the refused redraw changed the matches").toEqual(drawn.map((m) => m.id));
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

async function secondSecretary(page: Page) {
  const other = await page.context().newPage();
  return other;
}

test("the play-off for third is between the two beaten semi-finalists, and is made once", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("third", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages, players } = await makeEvent(club, "Club Knockout", {
      status: "live",
      configUnlocked: true,
      stages: [{ type: "Bracket Stage", format: "Match Play", scoringBasis: "gross" }],
      players: 4,
      event: KNOCKOUT,
    });
    const ko = stages[0];
    // The semi-finals, played: the top seed through, and an upset — seed 3 beats seed 2.
    await prisma.bracketWinner.createMany({
      data: [
        { eventId: event.id, key: "winners-0-0", winnerId: players[0].id, result: "3&2" },
        { eventId: event.id, key: "winners-0-1", winnerId: players[2].id, result: "1 up" },
      ],
    });
    const beaten = [players[3], players[1]];
    await signIn(context, baseURL!, club, event.id);
    const playOffs = () => prisma.match.findMany({ where: { eventId: event.id, stageId: ko.id, round: 0 } });

    await gotoStages(page);
    let card = await openRound(page, ko.id);
    const box = card.getByRole("checkbox", { name: /Play-off for third place/ });
    await centre(box);
    await box.check();
    await expect.poll(async () => (await prisma.stage.findUniqueOrThrow({ where: { id: ko.id } })).thirdPlace).toBe(true);
    await gotoStages(page);
    card = await openRound(page, ko.id);
    const pairing = card.locator("strong", { hasText: / v / });
    await expect(pairing, "the play-off is not offered between the two beaten semi-finalists").toHaveText(
      new RegExp(`^(${beaten[0].name} v ${beaten[1].name}|${beaten[1].name} v ${beaten[0].name})$`),
    );
    const createIt = card.getByRole("button", { name: "Create the play-off", exact: true });
    await expect(createIt).toBeVisible();

    // A second secretary, on another screen, makes it first.
    const other = await secondSecretary(page);
    watchPageErrors(other, errors, "second secretary");
    await gotoStages(other);
    const otherCard = await openRound(other, ko.id);
    await otherCard.getByRole("button", { name: "Create the play-off", exact: true }).click();
    await expect(otherCard.getByText(/The play-off is made — .* v .*\. Enter its result on Score entry\./)).toBeVisible({ timeout: 20_000 });
    const made = await playOffs();
    expect(made, "the play-off was not made once").toHaveLength(1);
    expect([made[0].playerAId, made[0].playerBId].sort(), "the play-off is not between the two beaten semi-finalists").toEqual(beaten.map((p) => p.id).sort());

    // The first secretary presses too: refused, in words, where they pressed.
    await centre(createIt);
    await createIt.click();
    const refused = card.locator(".form-error", { hasText: "The play-off for third has already been made." });
    await expect(refused, "a second play-off for third was not refused in words").toBeVisible();
    await saidBeside(refused, createIt, "a second play-off for third");
    expect(await playOffs(), "a second play-off for third was made").toHaveLength(1);
    await gotoStages(page);
    card = await openRound(page, ko.id);
    await expect(card.getByText(/The play-off is made/)).toBeVisible();
    await other.close();
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a final between two named players is made between them, once", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("final", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages, players } = await makeEvent(club, "Champion of Champions", {
      stages: [{}, { type: "Single Match Stage", format: "Match Play", scoringBasis: "gross" }],
      players: 4,
    });
    const final = stages[1];
    const [a, b] = [players[1], players[3]];
    await prisma.stage.update({ where: { id: final.id }, data: { singleMatchRule: JSON.stringify({ kind: "named", a: a.id, b: b.id }) } });
    await signIn(context, baseURL!, club, event.id);
    const finals = () => prisma.match.findMany({ where: { eventId: event.id, stageId: final.id } });

    await gotoStages(page);
    const card = await openRound(page, final.id);
    const picker = card.locator(".card", { has: page.getByText("Who plays this match", { exact: true }) });
    await expect(picker.getByText(`${a.name} v ${b.name}`, { exact: true })).toBeVisible();
    const createIt = picker.getByRole("button", { name: "Create this match", exact: true });
    await expect(createIt).toBeVisible();

    const other = await secondSecretary(page);
    watchPageErrors(other, errors, "second secretary");
    await gotoStages(other);
    const otherCard = await openRound(other, final.id);
    await otherCard.getByRole("button", { name: "Create this match", exact: true }).click();
    await expect(otherCard.getByText("The match is made. Enter its result on Score entry.")).toBeVisible({ timeout: 20_000 });
    const made = await finals();
    expect(made.map((m) => [m.playerAId, m.playerBId]), "the final is not between the two named players").toEqual([[a.id, b.id]]);

    await centre(createIt);
    await createIt.click();
    const refused = picker.locator(".form-error", { hasText: "This round already has its match." });
    await expect(refused, "a second final was not refused in words").toBeVisible();
    await saidBeside(refused, createIt, "a second match for a one-match round");
    expect(await finals(), "a second final was made").toHaveLength(1);
    await other.close();
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a result a player reported is turned down: nothing goes on the draw, and the tie is theirs to report again", async ({ page, context, baseURL, browser }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("report", testInfo.project.name);
  const club = await makeClub(mark);
  const phone = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
  try {
    const { event, players } = await makeEvent(club, "Matchplay Knockout", {
      status: "live",
      stages: [{ type: "Bracket Stage", format: "Match Play", scoringBasis: "gross" }],
      players: 4,
      event: KNOCKOUT,
    });
    // The top seed's semi-final: the fourth seed says he won it. The committee knows he did not.
    const [top, claimant] = [players[0], players[3]];
    await prisma.bracketReport.create({
      data: { eventId: event.id, key: "winners-0-0", winnerId: claimant.id, result: "2&1", reportedById: claimant.id, reportedBy: claimant.name },
    });
    const { session } = await memberSession(event.id, claimant.email, claimant.name);
    await signIn(context, baseURL!, club, event.id);
    await signInWith(phone, baseURL!, session, event.id);
    const his = await phone.newPage();
    watchPageErrors(his, errors, "the player who reported");

    await his.goto(`/me?bust=${Date.now()}`);
    await expect(his.getByText(/you reported it\. Waiting for the organi[sz]er to approve it\./), "the player is not shown his report waiting").toBeVisible({ timeout: 20_000 });

    await page.goto(`/bracket?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const reports = page.locator("section", { has: page.getByRole("heading", { name: "A result to approve" }) });
    await expect(reports.getByText(`Reported by ${claimant.name}`)).toBeVisible();
    const turnDown = reports.getByRole("button", { name: /^Turn down the report of / });

    // A second secretary deals with it first, on another screen.
    const other = await secondSecretary(page);
    watchPageErrors(other, errors, "second secretary");
    await other.goto(`/bracket?bust=${Date.now()}`);
    await other.getByRole("button", { name: /^Turn down the report of / }).click();
    await expect(other.getByRole("heading", { name: "A result to approve" })).toHaveCount(0, { timeout: 20_000 });
    expect(await prisma.bracketReport.count({ where: { eventId: event.id } }), "the report was not turned down").toBe(0);
    expect(await prisma.bracketWinner.count({ where: { eventId: event.id } }), "turning a report down put a result on the draw").toBe(0);

    // The first secretary, still looking at it, presses Turn down too.
    await centre(turnDown);
    await turnDown.click();
    const refused = reports.getByRole("alert").filter({ hasText: "That report has already been dealt with." });
    await expect(refused, "turning down a report already dealt with was not said").toBeVisible();
    await saidBeside(refused, turnDown, "turning down a report already dealt with");

    await page.goto(`/bracket?bust=${Date.now()}`);
    await expect(page.getByRole("heading", { name: "A result to approve" }), "the turned-down report is still waiting").toHaveCount(0);
    // The tie is open: no result on the draw, and the player may report it again.
    await expect(page.getByRole("textbox", { name: new RegExp(`^Result of .*${top.name}`) }), "a result went on the draw").toHaveCount(0);
    await his.goto(`/me?bust=${Date.now()}`);
    await expect(his.getByText(/Waiting for the organi[sz]er to approve it/), "the player is still told his report is waiting").toHaveCount(0);
    await expect(his.getByRole("button", { name: "Report the result" }), "the tie is not the player's to report again").toBeVisible();
    await other.close();
  } finally {
    await phone.close();
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
