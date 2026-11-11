import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./coverage";
import { statusFixture, cardsIn, dayFromNow, prisma } from "./status-fixture";
import { navForRole } from "../src/lib/nav";
import { sweep, keyOf, ratchet, knownFile, SWEEP_WIDTH, REASON_WITHIN_PX, type Violation } from "./console-sweep";

/**
 * THE CONSOLE SWEEP (master backlog J51, the part left unbuilt): every screen
 * the organizer's menu offers, for a tournament being set up and again once it
 * is live with a card in, held to three rules at 320 pixels wide:
 *
 *   sideways-scroll            the page is no wider than the screen
 *   disabled-without-reason    a greyed control says why, on the control
 *                              (`aria-describedby`) or in a sentence within
 *                              96px of it; a save button with nothing to save
 *                              is its own reason
 *   two-primaries              one filled button to a row or card
 *
 * The rules, why 96, what "primary", "row" and "card" mean in the markup, and
 * what each rule cannot see are at the top of `console-sweep.ts`, which the
 * walk and the controls below both call.
 *
 * THE SCREENS COME FROM THE MENU (`navForRole`), not from a list here, so a
 * screen added to the menu is swept the day it is added. Each is asked for,
 * must answer 200, must still be the address asked for (a sign-in page is a
 * 200 too) and must have drawn its heading before anything is measured. A
 * screen shown one section at a time (Club settings' tabs) has each section
 * pressed open and measured, as `layout.spec.ts` does.
 *
 * A RATCHET, NOT A BAN. `console-sweep-known.json` holds today's violations,
 * one line each: "<stage> <screen> :: <rule> :: <the thing>". A violation not
 * on the list fails; a line on the list that is no longer found fails too,
 * until it is deleted, so the list only shrinks and never goes on claiming a
 * fault that is fixed. On either, the test prints the lines to add, the lines
 * to delete, and the whole file as it should now be, ready to paste.
 * The screens are fixed in their own pull requests, not here.
 *
 * WHERE IT RUNS: Chromium at 320 (the `small-phone` project), and nowhere
 * else. The list is one engine's layout at one width; a tablet or another
 * engine draws a different page, and a list held to five engines is five
 * lists. The other sizes and engines keep `layout.spec.ts` for sideways scroll.
 *
 * WHAT IT CANNOT SEE: a screen the menu does not offer this tournament (Teams,
 * Bracket, Team cup, This week: a medal has none of them); anything behind a
 * press other than a tab (a dialog, a folded round, a side panel); a control
 * greyed only while a save is in the air; the stages after live (completed,
 * reopened). One line stands for every control of its kind on a screen, so a
 * second greyed box like one already listed is not news.
 *
 * It SAVES once (the launch), so the service worker is blocked, the save
 * specs' rule. Memory: one browser context and one page, about 150 MB.
 */
const KNOWN: string[] = JSON.parse(readFileSync(join(process.cwd(), "e2e", "console-sweep-known.json"), "utf8"));

const ONE_PLACE = "Chromium at 320 only: the known list is one engine's layout at one width";
const elsewhere = (project: string, browserName: string) =>
  project !== "small-phone" || browserName !== "chromium" || !!process.env.E2E_DEVICES || !!process.env.E2E_CHANNEL;

const PAGE = (body: string) =>
  `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>t</title>
  <style>body { margin: 0; font: 14px sans-serif; } button, input { height: 34px; }</style></head><body><main><h1>t</h1>${body}</main></body></html>`;

const rulesOf = (vs: Violation[]) => vs.map((v) => v.rule).sort();

test.describe("the console sweep", () => {
  test("CONTROL: the sweep catches a page that breaks each rule, and passes one that keeps them", async ({ page, browserName }, testInfo) => {
    test.skip(elsewhere(testInfo.project.name, browserName), ONE_PLACE);
    await page.setViewportSize({ width: SWEEP_WIDTH, height: 568 });
    const look = async (body: string) => {
      await page.setContent(PAGE(body));
      return (await sweep(page, { width: SWEEP_WIDTH })).violations;
    };

    // Rule 1: a 400px box on a 320px screen, and the same box in its own scroller.
    expect(rulesOf(await look(`<div style="width: 400px; height: 20px; background: #ccc"></div>`))).toEqual(["sideways-scroll"]);
    expect(await look(`<div style="overflow-x: auto"><div style="width: 400px; height: 20px; background: #ccc"></div></div>`)).toEqual([]);

    // Rule 2: a greyed button that says nothing.
    const bare = await look(`<button class="btn btn-secondary" disabled>Delete round</button>`);
    expect(rulesOf(bare)).toEqual(["disabled-without-reason"]);
    expect(bare[0].sig).toBe(`button.btn.btn-secondary "Delete round"`);
    // A caption beside it is not a reason; nor is a sentence a screen away; nor one that is not drawn.
    expect(rulesOf(await look(`<button disabled>Delete round</button><span>Round one</span>`))).toEqual(["disabled-without-reason"]);
    expect(rulesOf(await look(`<button disabled>Delete round</button><div style="height: 600px"></div><p>Round 1 has scores, so it cannot be deleted.</p>`))).toEqual(["disabled-without-reason"]);
    expect(rulesOf(await look(`<button disabled aria-describedby="why">Delete round</button><div style="height: 600px"></div><p id="why" hidden>Round 1 has scores, so it cannot be deleted.</p>`))).toEqual(["disabled-without-reason"]);
    // The same faults on the app's other shapes: a refused button that stays focusable, and a box in a disabled fieldset.
    expect(rulesOf(await look(`<button aria-disabled="true">Launch tournament</button>`))).toEqual(["disabled-without-reason"]);
    expect(rulesOf(await look(`<fieldset disabled style="border: 0"><input type="text" aria-label="Course name"></fieldset>`))).toEqual(["disabled-without-reason"]);
    // And the three ways of saying why: on the control, in a sentence beside it, or being a save button with nothing to save.
    expect(await look(`<button disabled aria-describedby="why">Delete round</button><div style="height: 600px"></div><p id="why">Round 1 has scores, so it cannot be deleted.</p>`)).toEqual([]);
    expect(await look(`<button disabled>Delete round</button><p style="margin: 4px 0 0">Round 1 has scores, so it cannot be deleted.</p>`)).toEqual([]);
    expect(await look(`<div class="card"><button class="btn btn-primary" disabled>Saved</button></div><div style="height: 300px"></div><div class="card"><button class="btn btn-primary" disabled>Save changes</button></div>`)).toEqual([]);

    // Rule 3: two filled buttons in one card; one to a card, and one to a row, are fine.
    const two = await look(`<div class="card"><button class="btn btn-primary">Save event</button><button class="btn btn-primary">Launch tournament</button></div>`);
    expect(rulesOf(two)).toEqual(["two-primaries"]);
    expect(two[0].sig).toBe("div.card [Launch tournament | Save event]");
    expect(rulesOf(await look(`<div><button class="btn btn-primary">Save event</button> <button class="btn btn-primary">Launch tournament</button></div>`))).toEqual(["two-primaries"]);
    expect(await look(`<div class="card"><button class="btn btn-primary">Save event</button></div><div class="card"><button class="btn btn-primary">Launch tournament</button></div>`)).toEqual([]);
    expect(await look(`<div class="card"><table><tbody><tr><td><button class="btn btn-primary">Approve</button></td></tr><tr><td><button class="btn btn-primary">Approve</button></td></tr></tbody></table></div>`)).toEqual([]);
    // A filled button that is not drawn is not counted.
    expect(await look(`<div class="card"><button class="btn btn-primary">Save event</button><button class="btn btn-primary" hidden>Launch tournament</button></div>`)).toEqual([]);

    // All three at once are three findings, each under its own rule.
    expect(rulesOf(await look(`<div style="width: 400px; height: 20px"></div><button disabled>Delete round</button>
      <div class="card"><button class="btn btn-primary">One</button><button class="btn btn-primary">Two</button></div>`))).toEqual(["disabled-without-reason", "sideways-scroll", "two-primaries"]);
  });

  test("every screen on the organizer's menu, setting up and live, keeps the three rules (or is on the known list)", async ({ browser, baseURL, browserName }, testInfo) => {
    test.skip(elsewhere(testInfo.project.name, browserName), ONE_PLACE);
    test.setTimeout(900_000);
    const f = await statusFixture(browser, baseURL, testInfo, {
      family: "sweep",
      rounds: [{ type: "Stroke Play Round", format: "Stroke Play" }],
      saves: true,
    });
    try {
      const page = await f.ctx.newPage();
      await page.setViewportSize({ width: SWEEP_WIDTH, height: 568 });

      // The fixture's own facts, read from it: the names a control may carry, taken out of every signature.
      const players = await prisma.player.findMany({ where: { eventId: f.eventId }, select: { name: true } });
      const names = [...players.map((p) => p.name), "Zz Status Organizer", f.mark];

      // The menu's own answer for the Organizer of a one-round medal: no team round, knockout, cup or league.
      const screens = [...new Set(navForRole("admin", undefined, {}).flatMap((section) => section.items.map((item) => item.href)))];
      expect(screens.length, `the menu gave ${screens.length} screens: ${screens.join(" ")}`).toBeGreaterThan(15);
      for (const must of ["/dashboard", "/event", "/stages", "/registration", "/organization"]) expect(screens, "the menu's list").toContain(must);

      const found = new Set<string>();
      const said: string[] = [];
      const unreached: string[] = [];
      const seen = { disabled: 0, primaries: 0, screens: 0 };

      const walk = async (stage: string) => {
        for (const path of screens) {
          const response = await page.goto(`${path}?bust=${Date.now()}`);
          await page.waitForLoadState("networkidle").catch(() => {});
          // ON the screen before anything about it: a redirect to the front door is a 200 that measures nothing.
          const status = response?.status() ?? 0;
          const landed = new URL(page.url()).pathname;
          if (status !== 200 || landed !== path) {
            unreached.push(`${stage} ${path}: answered ${status} and landed on ${landed}`);
            continue;
          }
          if ((await page.locator("#__next_error__").count()) > 0 || !(await page.locator("h1").first().isVisible().catch(() => false))) {
            unreached.push(`${stage} ${path}: drew an error or no heading`);
            continue;
          }
          const look = async (where: string) => {
            const result = await sweep(page, { width: SWEEP_WIDTH, names });
            seen.disabled += result.seen.disabled;
            seen.primaries += result.seen.primaries;
            for (const v of result.violations) {
              const key = keyOf(stage, where, v);
              if (!found.has(key)) said.push(`${key}\n      ${v.detail}`);
              found.add(key);
            }
          };
          seen.screens += 1;
          await look(path);
          const tabs = (await page.locator('main [role="tab"]').evaluateAll((els) => els.map((el) => el.id))).filter(Boolean);
          for (const id of tabs) {
            const tab = page.locator(`main [id="${id}"]`);
            await tab.click();
            await expect(tab).toHaveAttribute("aria-selected", "true");
            await look(`${path}#${id.replace(/^tab-/, "")}`);
          }
        }
      };

      // SETTING UP: as the fixture makes it, nothing locked.
      expect(await f.status()).toBe("draft");
      await walk("setting-up");

      // LIVE, with the round's first card in: launched by the Organizer's own press (as
      // `status-stroke.spec.ts` does it), so the locks and the round's shut doors are the app's own.
      const day = dayFromNow(10);
      await prisma.event.update({ where: { id: f.eventId }, data: { dates: "Saturday medal", startOn: day, endOn: day } });
      await page.goto(`/dashboard?bust=${Date.now()}`);
      await page.getByRole("button", { name: "Launch tournament" }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("region", { name: "Still open" })).toBeVisible({ timeout: 15_000 });
      await dialog.getByRole("button", { name: "Launch tournament" }).click();
      await expect.poll(f.status, { timeout: 20_000, message: "the press did not launch it" }).toBe("live");
      await cardsIn(f, f.stageIds[0], f.playerIds.slice(0, 1));
      const beforeLive = { ...seen };
      await walk("live");

      // CONTROL ON THE WALK ITSELF: it looked at the app's real buttons, and at real greyed ones
      // (a live tournament with a card in has shut doors; a walk that saw none measured nothing).
      expect(seen.screens, "screens measured").toBeGreaterThan(screens.length);
      expect(seen.primaries, "the walk saw no primary button on any screen").toBeGreaterThan(0);
      expect(seen.disabled - beforeLive.disabled, "the walk saw no disabled control on a live tournament").toBeGreaterThan(0);

      const { added, gone } = ratchet([...found], KNOWN);
      if (added.length || gone.length || unreached.length) {
        // Printed whole, in the form the list takes, so it can be pasted from the log.
        console.log(
          [
            "",
            "=== CONSOLE SWEEP ===",
            `screens: ${screens.length} from the menu, ${seen.screens} measured across two stages; disabled controls seen: ${seen.disabled}; primaries seen: ${seen.primaries}`,
            `rule 2's distance: ${REASON_WITHIN_PX}px; width: ${SWEEP_WIDTH}px`,
            ...(unreached.length ? ["", "NOT REACHED (never goes on the list; the list below is incomplete while any screen is here):", ...unreached.map((u) => `  ${u}`)] : []),
            "",
            `FOUND AND NOT ON THE LIST (${added.length}): add to e2e/console-sweep-known.json, or fix the screen`,
            ...added.map((k) => `  ${JSON.stringify(k)},`),
            "",
            `ON THE LIST AND NO LONGER FOUND (${gone.length}): delete from e2e/console-sweep-known.json`,
            ...gone.map((k) => `  ${JSON.stringify(k)},`),
            "",
            "EVERYTHING FOUND, WITH WHAT WAS MEASURED:",
            ...said.map((s) => `  ${s}`),
            "",
            "THE WHOLE FILE AS IT SHOULD BE NOW (paste over e2e/console-sweep-known.json):",
            "--- begin console-sweep-known.json ---",
            knownFile([...found]),
            "--- end console-sweep-known.json ---",
            "",
          ].join("\n"),
        );
      }
      expect(unreached, `screens the walk could not measure:\n${unreached.join("\n")}`).toEqual([]);
      expect(added, `new violations (fix the screen; the log above has them in the list's own form):\n${added.join("\n")}`).toEqual([]);
      expect(gone, `fixed now, delete from e2e/console-sweep-known.json:\n${gone.join("\n")}`).toEqual([]);
    } finally {
      await f.done();
    }
  });
});
