import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, CARD_PARS, dayIn, addDays } from "./rounds-fixture";

/**
 * ROUNDS & FORMATS, STEP 2 — "COURSE DAY" (`?view=timeline`, behind its switch; Ajay, 2 Nov).
 *
 * Ajay's test for it: "the main thing is ease of using the configuration and guided one". So this
 * walks it the way a new organizer meets it, at every width the suite runs:
 *
 *   guided        "Needs you" names the ONE next thing first, with what it costs the players, and
 *                 its button is the screen's one filled button
 *   opens it      a gap's "Open Round 3" opens that round's panel, which says the effect before it
 *                 happens and is laid out as the four numbered golf sections
 *   it clears     setting the date takes "Round 3 has no date" off the list, with no reload
 *   golf facts    the course's par strip draws every hole of the card; tee times as ticks
 *   fits          nothing scrolls sideways; every new control is a 44px target on a phone
 *   docked        at 1280 and wider there is no scrim: the rounds stay readable left of the panel
 *
 * The panel's own promises (focus, Escape, outside, one at a time, saves) are `rounds-panel.spec`.
 */

const markFor = (project: string) => `zz-rtime-${project}`;

test.describe.configure({ timeout: 120_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  await dropClub("zz-rtime-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

async function open(page: Page) {
  await page.goto(`/stages?view=timeline&bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.locator("main h1")).toBeVisible();
}

test("the timeline guides: the next thing first with its consequence, opened in one press, cleared when set", async ({ page, context, baseURL }, testInfo) => {
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor(testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const today = dayIn("");
    const { event, stages, players } = await makeEvent(club, "Autumn Meeting", {
      stages: [{ playedOn: addDays(today, 7) }, { playedOn: addDays(today, 14) }, {}],
      players: 8,
    });
    const [r1, r2, r3] = stages;
    // Round 1 has its tee times: two groups of four, saved.
    await prisma.stage.update({
      where: { id: r1.id },
      data: {
        teeSheet: JSON.stringify({
          savedAt: new Date().toISOString(),
          startType: "tee",
          groups: [
            { name: "Group 1", startHole: 1, time: "8:00", playerIds: players.slice(0, 4).map((p) => p.id) },
            { name: "Group 2", startHole: 1, time: "8:10", playerIds: players.slice(4, 8).map((p) => p.id) },
          ],
        }),
      },
    });
    await signIn(context, baseURL!, club, event.id);
    await open(page);

    // ── guided: the next thing first, its consequence in words, the one filled button ──
    const needs = page.getByRole("region", { name: /Needs you/ });
    await expect(needs).toBeVisible();
    const words = await needs.locator(".rt-need-words").allInnerTexts();
    expect(words, "Needs you is not in the order a round is set up").toEqual([
      "Round 2 has no tee times — players cannot see when they start.",
      "Round 3 has no date — players cannot see when they play.",
      "Round 3 has no tee times — players cannot see when they start.",
    ]);
    const filled = page.locator("main .btn-primary").filter({ visible: true });
    await expect(filled, "more than one filled button on the screen").toHaveCount(1);
    await expect(filled).toHaveAttribute("href", `/foursomes?round=${r2.id}`);

    // ── a round's facts on the spine: Round 1's two saved groups as ticks ──
    await expect(page.locator(`[id="round-${r1.id}"] .rt-tick`)).toHaveCount(2);
    await expect(page.locator(`[id="round-${r1.id}"] .rt-field-words`)).toContainText("8:00–8:10");

    // ── opened in one press, from the gap ──
    await needs.getByRole("button", { name: "Open Round 3" }).click();
    const panel = page.getByRole("dialog", { name: "Round 3" });
    await expect(panel).toBeVisible();
    await expect(panel.locator(".side-panel-kicker")).toContainText("Round 3 of 3");
    // The effect, before anything is touched — from what is stored.
    await expect(panel.locator(".rt-effect")).toContainText("8 players; no tee times yet");
    // The four golf sections, numbered, each saying what it decides.
    await expect(panel.locator(".rt-sect-title")).toHaveText(["Date & course", "Format & scoring", "Groups & pairings", "Extra rules"]);
    for (const line of await panel.locator(".rt-sect-decides").allInnerTexts()) {
      expect(line.split(/\s+/).length, `a decides-line over 20 words: ${line}`).toBeLessThanOrEqual(20);
    }
    // The course as a scorecard: every hole of the card, par 3s and 5s marked.
    await expect(panel.locator(".rt-hole")).toHaveCount(CARD_PARS.length);
    await expect(panel.locator('.rt-hole[data-par="3"]')).toHaveCount(CARD_PARS.filter((p) => p === 3).length);

    // ── it fits: nothing sideways, the new controls thumb-sized on a phone ──
    const viewport = page.viewportSize()!;
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), "the page scrolls sideways").toBeLessThanOrEqual(0);
    if (viewport.width < 768) {
      const small = await page.evaluate(() =>
        [...document.querySelectorAll(".rt-needs a, .rt-needs button, .rt-sect-link")]
          .map((el) => ({ text: (el as HTMLElement).innerText.trim(), h: el.getBoundingClientRect().height }))
          .filter((t) => t.h > 0 && t.h < 44),
      );
      expect(small, "a new control is smaller than 44px on a phone").toEqual([]);
    }

    // ── docked at 1280 and wider: no scrim, and the rounds stay clear of the panel ──
    if (viewport.width >= 1280) {
      const dock = await page.evaluate((id) => {
        const backdrop = [...document.querySelectorAll(".side-panel-backdrop")].find((b) => !(b as HTMLElement).hidden)!;
        const panelBox = backdrop.querySelector(".side-panel")!.getBoundingClientRect();
        const row = document.querySelector(`[id="round-${id}"] button[aria-expanded]`)!.getBoundingClientRect();
        return { scrim: getComputedStyle(backdrop).backgroundColor, rowRight: row.right, panelLeft: panelBox.left };
      }, r1.id);
      expect(dock.scrim, "a scrim darkens the rounds at this width").toBe("rgba(0, 0, 0, 0)");
      expect(dock.rowRight, "the panel covers the rounds").toBeLessThanOrEqual(dock.panelLeft);
    } else {
      testInfo.annotations.push({ type: "not walked", description: "docking: at this width the panel is over the list by design (full screen on a phone)" });
    }

    // ── it clears: a date set in the panel takes the gap off the list ──
    await panel.getByLabel("Date Round 3 is played").fill(addDays(today, 21));
    await expect
      .poll(async () => (await prisma.stage.findUniqueOrThrow({ where: { id: r3.id } })).playedOn, { message: "the date was not stored" })
      .toBe(addDays(today, 21));
    await page.keyboard.press("Escape");
    await expect(needs.locator(".rt-need-words").filter({ hasText: "Round 3 has no date" }), "the gap stayed listed after it was set").toHaveCount(0);
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
