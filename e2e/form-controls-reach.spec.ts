import { test, writeFormInventory, expect } from "./coverage";
import { statusFixture, prisma } from "./status-fixture";
import { navForRole } from "../src/lib/nav";
import { controlsOn, inventoryLine, screenLine } from "./form-controls";
import { joinFormControls } from "../scripts/qa/form-controls.mjs";

/**
 * THE FORM-CONTROL MEASURE'S WIDER WORLD: the inventory (M) at DESKTOP width, for a medal and for a knockout.
 *
 * "form controls changed by a test: N of M" counted M from one walk, `console-sweep.spec.ts`: the organizer's
 * menu at 320px, for one medal. A control only a wider screen draws (a table that is a card list on a phone,
 * a column that folds away) or only a knockout's menu offers (the Bracket, its seeding and results) was not
 * in M, so no test could ever be said to have missed it. This walk adds them: the same inventory (every
 * `input`, `select`, `textarea` and role of combobox, switch, checkbox or radio, by role and name, with the
 * fixture's names taken out), written as lines of its own into the ledger. It judges NOTHING: no rule of
 * the console sweep is applied here, nothing fails on what a screen draws, so it can never add a line to the
 * sweep's known list. It fails only when it measured nothing.
 *
 *   medal, 1280 wide      the screens `navForRole("admin")` gives one medal, setting up
 *   knockout, 1280 wide   the screens it gives an eight-player knockout (`hasKnockout`), setting up
 *
 * The sweep's controls and these are one figure: a control is one role and name on one screen, so a box
 * both walks draw is one control, and a box only this walk draws is a new one in M.
 *
 * WHAT IT CANNOT SEE: the live stage of either (the sweep's live walk launches a medal; a knockout's
 * launch is `status-knockout.spec.ts`'s), a cup, a league, a dialog, a folded panel and the player's app.
 * The line the figure prints still says so.
 *
 * Runs on Chromium's DESKTOP project only (1280 wide) and skips itself elsewhere, as the sweep does at its
 * own width. Memory: one browser context, one page, about 200 MB; the two fixtures one after the other.
 */
const elsewhere = (project: string, browserName: string) =>
  project !== "desktop" || browserName !== "chromium" || !!process.env.E2E_DEVICES || !!process.env.E2E_CHANNEL;

test.describe("the form-control inventory, wider", () => {
  test("the organizer's screens at desktop width, for a medal and for a knockout, are written into the inventory", async ({ browser, baseURL, browserName }, testInfo) => {
    test.skip(elsewhere(testInfo.project.name, browserName), "Chromium desktop only: it is the one width this adds");
    test.setTimeout(600_000);
    const lines: string[] = [];

    const walkWorld = async (world: string, family: string, opts: Parameters<typeof statusFixture>[3], nav: Parameters<typeof navForRole>[2]) => {
      const f = await statusFixture(browser, baseURL, testInfo, opts);
      try {
        const page = await f.ctx.newPage();
        await page.setViewportSize({ width: 1280, height: 900 });
        const players = await prisma.player.findMany({ where: { eventId: f.eventId }, select: { name: true } });
        const names = [...players.map((p) => p.name), "Zz Status Organizer", f.mark];
        const screens = [...new Set(navForRole("admin", undefined, nav).flatMap((section) => section.items.map((item) => item.href)))];
        expect(screens.length, `the ${family} menu gave ${screens.length} screens`).toBeGreaterThan(15);
        const stage = `${world}-desktop-setting-up`;
        let reached = 0;
        for (const path of screens) {
          const response = await page.goto(`${path}?bust=${Date.now()}`);
          await page.waitForLoadState("networkidle").catch(() => {});
          // ON the screen before anything about it: a redirect is a 200 that measures nothing.
          if ((response?.status() ?? 0) !== 200 || new URL(page.url()).pathname !== path) continue;
          if ((await page.locator("#__next_error__").count()) > 0 || !(await page.locator("h1").first().isVisible().catch(() => false))) continue;
          reached += 1;
          const take = async () => {
            lines.push(screenLine(stage, path));
            for (const control of await controlsOn(page)) lines.push(inventoryLine(stage, path, control, names));
          };
          await take();
          // A section's controls belong to its screen, as the sweep keys them.
          const tabs = (await page.locator('main [role="tab"]').evaluateAll((els) => els.map((el) => el.id))).filter(Boolean);
          for (const id of tabs) {
            const tab = page.locator(`main [id="${id}"]`);
            await tab.click();
            await expect(tab).toHaveAttribute("aria-selected", "true");
            await take();
          }
        }
        expect(reached, `${world}: too few screens opened for the inventory to mean anything`).toBeGreaterThan(10);
      } finally {
        await f.done();
      }
    };

    await walkWorld("medal", "medal", { family: "reachmedal", rounds: [{ type: "Stroke Play Round", format: "Stroke Play" }], saves: true }, {});
    await walkWorld(
      "knockout",
      "knockout",
      {
        family: "reachko",
        players: 8,
        event: { shape: "knockout", qualifyMode: "overall", qualifyOverall: 8, bracketMode: "single" },
        rounds: [{ type: "Bracket Stage", format: "Match Play", scoringBasis: "gross" }],
        saves: true,
      },
      { hasKnockout: true },
    );

    // Written whole and once: a worker's file is the walk that has just finished.
    const file = writeFormInventory(lines);
    const counted = joinFormControls(lines);
    console.log(`[form-controls] wider inventory: ${counted.total} controls a person could change on ${counted.screensWalked} screens, ${counted.stages.join(" and ")}; written to ${file}.`);
    expect(counted.total, "the walk saw no form control on any screen").toBeGreaterThan(0);
  });
});
