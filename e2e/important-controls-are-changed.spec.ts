import { test, expect } from "./coverage";
import { statusFixture, dayFromNow, prisma } from "./status-fixture";
import { watchPageErrors } from "./page-errors";

/**
 * THE CONTROLS NO TEST CHANGED, THE MOST IMPORTANT FIRST (the form-control measure's follow-up).
 *
 * "form controls changed by a test: N of M" (`scripts/e2e-coverage.mjs`) names, by screen, every form control
 * the console sweep saw that no spec altered. Ranked by what it can cost a club (money, then scores, then
 * handicaps, then the field), these were on it, with no spec naming them. Each is CHANGED here as the
 * person who would change it, and the effect is read from the database, not from the press:
 *
 *   Entries      "Handicap index for <name> — 9-hole or 18-hole"   organizer   the player's handicap is a nine-hole one
 *   Prizes       "Stake for Low gross"                              organizer   a side game of 12.50 a head exists for the round
 *   Prizes       "Stake for Birdie pot"                             organizer   a second one, of 5, beside it, the first untouched
 *   Score entry  "Player" (the card's picker)                       organizer   the card is the OTHER player's: the option chosen is theirs
 *   Entries      "Select <name>"                                    organizer   the bulk bar counts one, then two, then goes; nobody is removed
 *
 * The first three save by themselves when left (a blur), so each is left with Tab and the row is polled for.
 * The fourth and fifth change nothing stored; their effect is what the screen says next, and a count of
 * players proves nothing was removed by ticking.
 *
 * WHAT IT CANNOT SEE: that the figure on a player's own screen follows (the money specs read that); that the
 * card shows the other player's holes (the score specs read the card). This spec is for the control.
 *
 * Its own throwaway club (`zz-status-impctl-*`), deleted in `finally`. No money moves: the app records a stake.
 */
test("the organizer changes the handicap type, two stakes, the scoring player and a selection, and each does what it says", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "impctl",
    rounds: [{ type: "Stroke Play Round", format: "Stroke Play" }],
    saves: true,
  });
  try {
    const page = await f.ctx.newPage();
    watchPageErrors(page, errors);
    // The fixture's facts, read from it, never assumed.
    const field = await prisma.player.findMany({ where: { eventId: f.eventId }, orderBy: { seed: "asc" }, select: { id: true, name: true, handicap: true, handicapType: true } });
    expect(field.length).toBeGreaterThan(2);
    const [first, second, third] = field;
    expect(first.handicapType, "the fixture's player starts on an 18-hole index").not.toBe("9");
    const stageId = f.stageIds[0];

    // ── Handicaps: Entries, the 9-hole / 18-hole choice beside the index ─────────────────────────
    await page.goto(`/registration?bust=${Date.now()}`);
    const kind = page.getByLabel(new RegExp(`^Handicap index for ${first.name} `));
    await expect(kind).toHaveValue("18");
    await kind.selectOption("9");
    await expect
      .poll(async () => (await prisma.player.findUniqueOrThrow({ where: { id: first.id } })).handicapType, { timeout: 20_000, message: "the handicap type was not saved" })
      .toBe("9");
    // The press changed THIS player only, and the index itself stayed.
    const after = await prisma.player.findMany({ where: { eventId: f.eventId, id: { not: first.id } }, select: { id: true, handicapType: true } });
    expect(after.every((p) => p.handicapType !== "9"), "choosing it for one player moved somebody else").toBe(true);
    expect((await prisma.player.findUniqueOrThrow({ where: { id: first.id } })).handicap).toBe(first.handicap);

    // ── Money: the two stakes on Prizes, each saved when its box is left ──────────────────────────
    await page.goto(`/prizes?bust=${Date.now()}`);
    const stakeOf = (kindName: string) => prisma.sideGame.findFirst({ where: { eventId: f.eventId, stageId, kind: kindName }, select: { buyInCents: true } });
    expect(await stakeOf("low-gross"), "the fixture has no side game yet").toBeNull();
    const lowGross = page.getByLabel("Stake for Low gross");
    await lowGross.fill("12.50");
    await lowGross.press("Tab");
    await expect.poll(async () => (await stakeOf("low-gross"))?.buyInCents ?? null, { timeout: 20_000, message: "the Low gross stake was not recorded" }).toBe(1250);
    expect(await stakeOf("birdies"), "a stake typed in one row started another game").toBeNull();
    const birdies = page.getByLabel("Stake for Birdie pot");
    await birdies.fill("5");
    await birdies.press("Tab");
    await expect.poll(async () => (await stakeOf("birdies"))?.buyInCents ?? null, { timeout: 20_000, message: "the Birdie pot stake was not recorded" }).toBe(500);
    expect((await stakeOf("low-gross"))?.buyInCents, "the second stake changed the first").toBe(1250);

    // ── Entries: ticking a player selects, and removes nobody ────────────────────────────────────
    await page.goto(`/registration?bust=${Date.now()}`);
    const tick = (name: string) => page.getByLabel(`Select ${name}`, { exact: true });
    await expect(page.getByRole("button", { name: /Delete \d+ selected/ })).toHaveCount(0);
    await tick(second.name).check();
    await expect(page.getByRole("button", { name: "Delete 1 selected" })).toBeVisible();
    await tick(third.name).check();
    await expect(page.getByRole("button", { name: "Delete 2 selected" })).toBeVisible();
    await tick(second.name).uncheck();
    await tick(third.name).uncheck();
    await expect(page.getByRole("button", { name: /Delete \d+ selected/ })).toHaveCount(0);
    expect(await prisma.player.count({ where: { eventId: f.eventId } }), "ticking a box removed somebody").toBe(field.length);

    // ── Scores: the picker on Score entry, on a live tournament ──────────────────────────────────
    const day = dayFromNow(0);
    await prisma.event.update({ where: { id: f.eventId }, data: { status: "live", dates: "Saturday medal", startOn: day, endOn: day } });
    await page.goto(`/entry?bust=${Date.now()}`);
    const picker = page.locator("select[id$='-entry-player']");
    await expect(picker).toBeVisible();
    await picker.selectOption(second.id);
    await expect(picker).toHaveValue(second.id);
    // The option chosen is that player's, not the first's.
    const chosen = await picker.evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? "");
    expect(chosen).toContain(second.name);
    expect(chosen).not.toContain(first.name);

    expect(errors, "a screen threw").toEqual([]);
  } finally {
    await f.done();
  }
});
