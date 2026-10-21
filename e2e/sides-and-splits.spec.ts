import { test, expect, type Locator, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, gotoStages, openRound, centre, saidBeside } from "./rounds-fixture";

/**
 * SIDES: A ROUND ROBIN OF THEM DRAWN, AND A GREENSOMES SPLIT SET BY THE
 * COMMITTEE — each done as the secretary does it, and read back.
 *
 * `generateTeamMatches` and `setStageAllowanceWeights` were performed by no
 * browser test (the reach baseline, 2026-10-21; `teams-and-pairs.spec` pins
 * that a stroke-play four-ball is NOT offered Generate matches, and could see
 * neither of these):
 *
 *   a round robin    four sides, Generate matches: six matches, every side
 *                    against every other exactly once, each side once in each
 *                    of three rounds (a round robin, by definition); the screen
 *                    then offers Regenerate and says how many it would replace
 *   with a score     setup unlocked on the day and a card on the round:
 *                    Regenerate → Replace them is REFUSED, said where the press
 *                    was, and the six matches are the same six matches
 *   a split          greensomes is 60 / 40 (Appendix C): the committee's 70 / 30
 *                    is stored, said to be the committee's, and every side's
 *                    "Plays off" on Teams moves to the Rule's figure for it —
 *                    worked here (70% of the lower course handicap plus 30% of
 *                    the higher, rounded once); 0 / 0 and 150 are refused beside
 *                    Save with nothing stored; Back to 60 / 40 stores nothing
 *
 * WHAT IT CANNOT SEE: the matches being played (`match-results.spec`), and a
 * scramble's three- and four-way shares, whose arithmetic `shares-agree.test.ts`
 * holds.
 */

const WALKED = ["desktop", "phone"];
const markFor = (what: string, project: string) => `zz-sas-${what}-${project}`;

test.describe.configure({ timeout: 180_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  await dropClub("zz-sas-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

async function openTeams(page: Page, stageId: string) {
  await page.goto(`/teams?round=${stageId}&bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  expect(new URL(page.url()).pathname, "sent away from Teams — not signed in?").toBe("/teams");
}

const SIDES = ["Fairway Foxes", "Bunker Badgers", "Links Larks", "Heather Hares"];

test("a round robin of four sides is drawn as six matches, and is not redrawn over a score", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("rr", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages, players } = await makeEvent(club, "Four-Ball League", {
      stages: [{ type: "Round Robin", format: "Four-Ball", scoringBasis: "net" }],
      players: 8,
    });
    const round = stages[0];
    const teams = [];
    for (const [i, name] of SIDES.entries()) {
      const t = await prisma.team.create({ data: { eventId: event.id, stageId: round.id, name, seed: i + 1 } });
      await prisma.teamMember.createMany({
        data: [players[i * 2], players[i * 2 + 1]].map((p, position) => ({ teamId: t.id, playerId: p.id, position })),
      });
      teams.push(t);
    }
    await signIn(context, baseURL!, club, event.id);
    const matches = () => prisma.match.findMany({ where: { eventId: event.id, stageId: round.id }, orderBy: [{ round: "asc" }, { id: "asc" }] });
    expect(await matches()).toHaveLength(0);

    await openTeams(page, round.id);
    const generate = page.getByRole("button", { name: "Generate matches", exact: true });
    await centre(generate);
    await generate.click();
    await expect.poll(async () => (await matches()).length, { message: "Generate matches did not make the round robin's six" }).toBe(6);

    // A round robin, by definition: every side meets every other side exactly once…
    const drawn = await matches();
    const pairs = drawn.map((m) => [m.teamAId, m.teamBId].sort().join("|"));
    expect(new Set(pairs).size, "a pairing was drawn twice").toBe(6);
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        expect(pairs, `${SIDES[a]} never meets ${SIDES[b]}`).toContain([teams[a].id, teams[b].id].sort().join("|"));
      }
    }
    // …and in each of the three rounds every side plays once.
    const rounds = [...new Set(drawn.map((m) => m.round))].sort();
    expect(rounds, "four sides are not drawn over three rounds").toHaveLength(3);
    for (const r of rounds) {
      const sides = drawn.filter((m) => m.round === r).flatMap((m) => [m.teamAId, m.teamBId]);
      expect(new Set(sides).size, `round ${r} does not have every side playing once`).toBe(4);
    }
    expect(drawn.every((m) => m.playerAId === "" && m.playerBId === ""), "a side's match was filed against players").toBe(true);

    await openTeams(page, round.id);
    const regenerate = page.getByRole("button", { name: "Regenerate matches", exact: true });
    await expect(regenerate, "after a reload the round does not know it has its matches").toBeVisible();

    // ── on the day: setup unlocked, and a card on the round ──
    await prisma.event.update({ where: { id: event.id }, data: { status: "live", configUnlocked: true } });
    await prisma.teamScorecard.create({
      data: { eventId: event.id, stageId: round.id, teamId: teams[0].id, matchId: drawn[0].id, strokes: JSON.stringify([4, 5, 3]) },
    });
    await openTeams(page, round.id);
    await centre(regenerate);
    await regenerate.click();
    const ask = page.locator(".card", { has: page.getByText("Replace this round's matches?", { exact: true }) });
    await expect(ask.getByText(/This round already has 6 matches\./), "the question does not say how many matches it would replace").toBeVisible();
    await ask.getByRole("button", { name: "Replace them", exact: true }).click();
    const refused = page.getByText("Scores have already been recorded for this round.", { exact: true });
    await expect(refused, "a redraw over a recorded score was not refused in words").toBeVisible();
    await saidBeside(refused, regenerate, "regenerating a round robin that has a score");
    expect((await matches()).map((m) => m.id), "the refused redraw changed the matches").toEqual(drawn.map((m) => m.id));
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

/** The Rule for a greensomes side, worked here: a% of the lower handicap plus b% of the higher, rounded once, a half up. */
const sidePlaysOff = (h: number[], [a, b]: number[]) => {
  const [lo, hi] = [...h].sort((x, y) => x - y);
  return Math.floor((a * lo + b * hi) / 100 + 0.5 + 1e-9);
};

async function split(card: Locator) {
  return card.locator("p", { hasText: /^Handicap split/ });
}

test("a committee's greensomes split is kept and prices the sides; a split of nothing is refused beside Save", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("split", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages, players } = await makeEvent(club, "Greensomes Cup", {
      stages: [{ format: "Greensomes", scoringBasis: "net" }],
      players: 4,
    });
    const round = stages[0];
    // Handicaps 6.0, 9.4, 12.8, 16.2: a side of the lowest and the highest, and one of the middle two.
    const sides = [
      { name: "Gorse Gang", members: [players[0], players[3]] },
      { name: "Bracken Pair", members: [players[1], players[2]] },
    ];
    for (const [i, s] of sides.entries()) {
      const t = await prisma.team.create({ data: { eventId: event.id, stageId: round.id, name: s.name, seed: i + 1 } });
      await prisma.teamMember.createMany({ data: s.members.map((p, position) => ({ teamId: t.id, playerId: p.id, position })) });
    }
    await signIn(context, baseURL!, club, event.id);
    const weights = async () => (await prisma.stage.findUniqueOrThrow({ where: { id: round.id } })).allowanceWeights;
    expect(await weights()).toEqual([]);

    const playsOff = async (shares: number[]) => {
      await openTeams(page, round.id);
      for (const s of sides) {
        const want = sidePlaysOff(s.members.map((p) => p.handicap), shares);
        const card = page.locator(".card", { has: page.getByRole("textbox", { name: `Name of ${s.name}`, exact: true }) }).last();
        await expect(card.getByText(`Plays off ${want}`, { exact: true }), `${s.name} does not play off the Rule's ${want} at ${shares.join(" / ")}`).toBeVisible();
      }
    };
    // The control: the committee's split must give a different figure, or this proves nothing.
    expect(sidePlaysOff(sides[0].members.map((p) => p.handicap), [70, 30])).not.toBe(sidePlaysOff(sides[0].members.map((p) => p.handicap), [60, 40]));
    await playsOff([60, 40]);

    await gotoStages(page);
    let card = await openRound(page, round.id);
    await expect(await split(card)).toContainText("60 / 40 — the recommended split for this format.");
    const change = (await split(card)).locator("xpath=..").getByRole("button", { name: "Change", exact: true });
    await centre(change);
    await change.click();
    const lower = card.getByLabel("Share of the lower handicap, percent", { exact: true });
    const higher = card.getByLabel("Share 2, percent", { exact: true });
    const save = lower.locator("xpath=ancestor::div[1]").getByRole("button", { name: "Save", exact: true });

    // ── a split of nothing, and a share over a whole handicap: refused where Save was pressed ──
    await lower.fill("0");
    await higher.fill("0");
    await centre(save);
    await save.click();
    let refused = card.locator(".form-error", { hasText: "At least one share has to be above zero." });
    await expect(refused, "a split of 0 / 0 was not refused in words").toBeVisible();
    await saidBeside(refused, save, "a greensomes split of nothing");
    await lower.fill("150");
    await save.click();
    refused = card.locator(".form-error", { hasText: "Each share must be between 0 and 100 percent." });
    await expect(refused, "a share of 150% was not refused in words").toBeVisible();
    await saidBeside(refused, save, "a share over a whole handicap");
    expect(await weights(), "a refused split was stored").toEqual([]);

    // ── the committee's 70 / 30 ──
    await lower.fill("70");
    await higher.fill("30");
    await save.click();
    await expect.poll(weights, { message: "the committee's split was not stored" }).toEqual([70, 30]);
    await gotoStages(page);
    card = await openRound(page, round.id);
    await expect(await split(card), "the split is not said to be the committee's after a reload").toContainText(
      "70 / 30 — set by your committee, in place of the usual 60 / 40.",
    );
    await playsOff([70, 30]);
    await expect(page.getByText(/Handicap split\s*70 \/ 30/).first(), "Teams does not say the split in force").toBeVisible();

    // ── back to the Rules' own ──
    await gotoStages(page);
    card = await openRound(page, round.id);
    await (await split(card)).locator("xpath=..").getByRole("button", { name: "Change", exact: true }).click();
    const back = card.getByRole("button", { name: "Back to 60 / 40", exact: true });
    await centre(back);
    await back.click();
    await expect.poll(weights, { message: "Back to 60 / 40 did not clear the committee's split" }).toEqual([]);
    await playsOff([60, 40]);
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
