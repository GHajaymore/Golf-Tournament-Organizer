import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, centre, saidBeside } from "./rounds-fixture";

/**
 * A NAMED SIDE GAME, RENAMED — as the secretary renames it on Side games.
 *
 * A crew's skins and their birdie pot under one name settle as one bet, so a
 * new name moves both, and nobody who has paid in loses their place.
 * `renameBet` was performed by no browser test (the reach baseline, 2026-10-21):
 *
 *   renamed      "Sunday Swindle" becomes "Lunch Club": the skins pot AND the
 *                birdie pot under that name move together, with every entrant
 *                still in each; the screen says the new name after a reload,
 *                and the old one nowhere
 *   a clash      renaming it to the name of the OTHER crew's game on the round
 *                is refused, in words, beside the press — two crews' money in
 *                one pot is the thing the refusal exists to stop — and nothing
 *                moves
 *
 * WHAT IT CANNOT SEE: the settlement of either pot (`skins-pot.spec`,
 * `named-side-bet.spec`).
 */

const WALKED = ["desktop", "phone"];
const markFor = (project: string) => `zz-sgr-${project}`;

test.describe.configure({ timeout: 150_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  await dropClub("zz-sgr-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

async function openSideGames(page: Page) {
  await page.goto(`/group-games?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  expect(new URL(page.url()).pathname, "sent away from Side games — not signed in?").toBe("/group-games");
}

test("a crew's game is renamed with its pots and its people, and a clash with another crew's name is refused", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor(testInfo.project.name);
  const club = await makeClub(mark);
  const [FROM, TO, OTHER] = ["Sunday Swindle", "Lunch Club", "Back Bar"];
  try {
    const { event, stages, players } = await makeEvent(club, "Saturday Medal", { status: "live", stages: [{}], players: 6 });
    const stageId = stages[0].id;
    const crew = players.slice(0, 3);
    const skins = await prisma.skinsPot.create({ data: { eventId: event.id, stageId, groupKey: FROM, net: true, scope: "full", buyInCents: 500 } });
    await prisma.skinsEntry.createMany({ data: crew.map((p) => ({ potId: skins.id, playerId: p.id })) });
    const birdies = await prisma.sideGame.create({ data: { eventId: event.id, stageId, kind: "birdies", groupKey: FROM, buyInCents: 200 } });
    await prisma.sideGameEntry.createMany({ data: crew.map((p) => ({ sideGameId: birdies.id, playerId: p.id, confirmed: true })) });
    // The other crew's game on the same round.
    const theirs = await prisma.skinsPot.create({ data: { eventId: event.id, stageId, groupKey: OTHER, net: true, scope: "full", buyInCents: 300 } });
    await prisma.skinsEntry.createMany({ data: players.slice(3).map((p) => ({ potId: theirs.id, playerId: p.id })) });
    await signIn(context, baseURL!, club, event.id);
    const state = async () => ({
      skins: (await prisma.skinsPot.findUniqueOrThrow({ where: { id: skins.id }, include: { entrants: true } })),
      birdies: (await prisma.sideGame.findUniqueOrThrow({ where: { id: birdies.id }, include: { entrants: true } })),
      theirs: (await prisma.skinsPot.findUniqueOrThrow({ where: { id: theirs.id }, include: { entrants: true } })),
    });
    const potCard = (name: string) => page.locator(".card", { has: page.getByText(`${name} — Skins — net`, { exact: true }) }).last();

    await openSideGames(page);
    let card = potCard(FROM);
    await expect(card, `Side games has no card for ${FROM}`).toBeVisible();
    let rename = card.getByRole("button", { name: "Rename", exact: true });
    await centre(rename);
    await rename.click();
    const box = card.locator(".field", { has: page.getByText("What to call it", { exact: true }) }).locator("input");
    await expect(box).toHaveValue(FROM);
    await box.fill(TO);
    await card.getByRole("button", { name: "Save name", exact: true }).click();

    await expect.poll(async () => {
      const s = await state();
      return [s.skins.groupKey, s.birdies.groupKey];
    }, { message: "the skins pot and the birdie pot did not move to the new name together" }).toEqual([TO, TO]);
    const moved = await state();
    expect(moved.skins.entrants.map((e) => e.playerId).sort(), "a player lost their place in the skins").toEqual(crew.map((p) => p.id).sort());
    expect(moved.birdies.entrants.map((e) => e.playerId).sort(), "a player lost their place in the birdie pot").toEqual(crew.map((p) => p.id).sort());
    expect(moved.theirs.groupKey, "the other crew's game was renamed too").toBe(OTHER);

    await openSideGames(page);
    await expect(potCard(TO), "the new name is not on Side games after a reload").toBeVisible();
    await expect(page.getByText(FROM, { exact: false }), "the old name is still on Side games").toHaveCount(0);

    // ── a clash with the other crew's name ──
    card = potCard(TO);
    rename = card.getByRole("button", { name: "Rename", exact: true });
    await centre(rename);
    await rename.click();
    await card.locator(".field", { has: page.getByText("What to call it", { exact: true }) }).locator("input").fill(OTHER);
    await card.getByRole("button", { name: "Save name", exact: true }).click();
    const refused = card.locator(".form-error", { hasText: `There is already a game called ${OTHER} on this round.` });
    await expect(refused, "renaming onto another crew's game was not refused in words").toBeVisible();
    const after = await state();
    expect([after.skins.groupKey, after.birdies.groupKey, after.theirs.groupKey], "a refused rename moved something").toEqual([TO, TO, OTHER]);
    expect(after.theirs.entrants, "the other crew's pot gained or lost players").toHaveLength(3);
    // Last, because it is the assertion the app currently fails: the refusal is printed at the foot
    // of the pot's card, below the setup and the list of who paid in, off the screen of the person
    // who pressed Save name at its head.
    await saidBeside(refused, rename, "renaming onto another crew's game");
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
