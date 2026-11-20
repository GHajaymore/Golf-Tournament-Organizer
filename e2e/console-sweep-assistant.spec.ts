import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./coverage";
import { statusFixture, cardsIn, dayFromNow, prisma } from "./status-fixture";
import { sessionOf, signInWith } from "./rounds-fixture";
import { navForRole } from "../src/lib/nav";
import { sweep, keyOf, ratchet, knownFile, knownFor, stageFor, SWEEP_WIDTH, REASON_WITHIN_PX } from "./console-sweep";

/**
 * THE CONSOLE SWEEP, WALKED AS AN ASSISTANT (master backlog J51, the second walk).
 *
 * `console-sweep.spec.ts` walks the console as the Organizer, who may press everything. The person
 * who meets a CONTROL SHUT BY THE ROLE is the other one: the ASSISTANT (`Role` "assistant" in
 * `src/lib/roles.ts`, the `Account.role` of a person added on Staff & helpers; shown as
 * "Assistant"). Staff who run the day and may not reshape the tournament. A box greyed because of
 * who is looking, with no sentence saying so, is the same fault as one greyed by a lock, met by
 * somebody who cannot ask the organizer sitting beside them.
 *
 * THE SAME THREE RULES, THE SAME MEDAL, THE SAME TWO STAGES (setting up; live with the first card
 * in), measured at 320 (`console-sweep.ts` has the rules and what each cannot see). What differs:
 *
 *   - The screens are `navForRole("assistant", undefined, {})`: the menu the app draws for an
 *     assistant, not the Organizer's. It drops Tournament details, Staff & helpers, Club settings
 *     and Tournaments (SCREEN_ACCESS: "admin" only), so most of what an Organizer can set is not
 *     walked here; this walk sees the screens an assistant shares with the Organizer, where a role
 *     check can shut one control (`canSetTees`, `canChange`, `isAdmin`, `viewRole !== "admin"`).
 *   - The person is a REAL assistant: a User at an `@example.invalid` address with an `Account`
 *     row of role "assistant" on the fixture's tournament and NO seat in the club, signed in with
 *     `signedInNow` (the sessions in `rounds-fixture.ts`). Not the preview ("viewing as"), which
 *     changes `viewRole` for an Organizer and nothing else about them.
 *   - The Organizer's own context still presses Launch, as `console-sweep.spec.ts` does it, so the
 *     locks the assistant meets are the app's own.
 *
 * THE KNOWN LIST is the same file, `console-sweep-known.json`; a line here carries "assistant-" in
 * front of its stage ("assistant-live /grouping :: …", `stageFor`), and each walk is held to its own
 * lines only (`knownFor`). The list starts with none: the first CI run prints what this walk found,
 * as the Organizer's first run did, and the lines are pasted in.
 *
 * WHAT IT CANNOT SEE, ON TOP OF THE ORGANIZER'S WALK'S LIST: a flight's tees select
 * (`FlightBoard`, `FlightTeeSelect`) is drawn only where the tournament sets tees by flight and
 * the field has been drawn into flights, which this medal has not; a screen the role has no menu
 * entry for is not walked (the control below checks that the app really does refuse it);
 * the inventory of form controls is the Organizer's walk's, so this one writes none.
 *
 * Chromium at 320 only, saves nothing itself (the launch is the Organizer's), so the service worker
 * is blocked as the save specs do. Memory: two browser contexts, one page each, about 250 MB.
 */
const WHOLE_LIST: string[] = JSON.parse(readFileSync(join(process.cwd(), "e2e", "console-sweep-known.json"), "utf8"));
const KNOWN = knownFor(WHOLE_LIST, "assistant");
const ORGANIZERS = knownFor(WHOLE_LIST, "organizer");

const ONE_PLACE = "Chromium at 320 only: the known list is one engine's layout at one width";
const elsewhere = (project: string, browserName: string) =>
  project !== "small-phone" || browserName !== "chromium" || !!process.env.E2E_DEVICES || !!process.env.E2E_CHANNEL;

test.describe("the console sweep, as an assistant", () => {
  test("every screen on the assistant's menu, setting up and live, keeps the three rules (or is on the known list)", async ({ browser, baseURL, browserName }, testInfo) => {
    test.skip(elsewhere(testInfo.project.name, browserName), ONE_PLACE);
    test.setTimeout(900_000);
    const f = await statusFixture(browser, baseURL, testInfo, {
      family: "sweepasst",
      rounds: [{ type: "Stroke Play Round", format: "Stroke Play" }],
      saves: true,
    });
    const assistantEmail = `${f.mark}-assistant@example.invalid`;
    const assistantName = "Zz Status Assistant";
    let assistantCtx: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    try {
      // THE ASSISTANT: a person with the role on this tournament and no seat in the club.
      const user = await prisma.user.create({ data: { email: assistantEmail, name: assistantName, password: "x:unusable", emailVerifiedAt: new Date() } });
      await prisma.account.create({ data: { eventId: f.eventId, name: assistantName, email: assistantEmail, role: "assistant" } });
      assistantCtx = await browser.newContext({
        ...testInfo.project.use,
        baseURL,
        storageState: { cookies: [], origins: [] },
        serviceWorkers: "block",
      });
      await signInWith(assistantCtx, baseURL!, sessionOf(user.id), f.eventId);
      const page = await assistantCtx.newPage();
      await page.setViewportSize({ width: SWEEP_WIDTH, height: 568 });
      // The Organizer's context presses Launch below.
      const organizerPage = await f.ctx.newPage();
      await organizerPage.setViewportSize({ width: SWEEP_WIDTH, height: 568 });

      // The fixture's own facts, read from it: the names a control may carry, taken out of every signature.
      const players = await prisma.player.findMany({ where: { eventId: f.eventId }, select: { name: true } });
      const names = [...players.map((p) => p.name), "Zz Status Organizer", assistantName, f.mark];

      // The menu's own answer for an Assistant of a one-round medal, and the Organizer's, to compare.
      const hrefs = (role: "admin" | "assistant") => [...new Set(navForRole(role, undefined, {}).flatMap((s) => s.items.map((i) => i.href)))];
      const screens = hrefs("assistant");
      const organizersScreens = hrefs("admin");
      const lost = organizersScreens.filter((h) => !screens.includes(h));
      expect(screens.length, `the assistant's menu gave ${screens.length} screens: ${screens.join(" ")}`).toBeGreaterThan(10);
      for (const must of ["/dashboard", "/stages", "/registration", "/grouping", "/prizes"]) expect(screens, "the menu's list").toContain(must);
      // A menu identical to the Organizer's would mean the role shuts nothing at the door: say so, as a failure to read.
      expect(lost, "the assistant's menu is the Organizer's menu: the role shuts no screen, which is itself a finding").not.toEqual([]);

      const found = new Set<string>();
      const said: string[] = [];
      const unreached: string[] = [];
      const seen = { disabled: 0, primaries: 0, screens: 0 };

      const walk = async (stage: string) => {
        const named = stageFor("assistant", stage);
        for (const path of screens) {
          const response = await page.goto(`${path}?bust=${Date.now()}`);
          await page.waitForLoadState("networkidle").catch(() => {});
          // ON the screen before anything about it: a redirect to the front door is a 200 that measures nothing.
          const status = response?.status() ?? 0;
          const landed = new URL(page.url()).pathname;
          if (status !== 200 || landed !== path) {
            unreached.push(`${named} ${path}: answered ${status} and landed on ${landed}`);
            continue;
          }
          if ((await page.locator("#__next_error__").count()) > 0 || !(await page.locator("h1").first().isVisible().catch(() => false))) {
            unreached.push(`${named} ${path}: drew an error or no heading`);
            continue;
          }
          const look = async (where: string) => {
            const result = await sweep(page, { width: SWEEP_WIDTH, names });
            seen.disabled += result.seen.disabled;
            seen.primaries += result.seen.primaries;
            for (const v of result.violations) {
              const key = keyOf(named, where, v);
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

      // CONTROL ON THE PERSON: the app treats this fixture as an assistant. A screen the Organizer's
      // menu has and the assistant's does not must turn this person away; a sign-in that quietly
      // made an Organizer would otherwise walk the Organizer's console under this name.
      for (const path of lost.filter((h) => ["/event", "/access", "/organization"].includes(h))) {
        await page.goto(`${path}?bust=${Date.now()}`);
        await page.waitForLoadState("networkidle").catch(() => {});
        expect(new URL(page.url()).pathname, `${path} opened for the assistant: the fixture is not an assistant`).not.toBe(path);
      }

      // SETTING UP.
      expect(await f.status()).toBe("draft");
      await walk("setting-up");

      // LIVE, with the round's first card in: launched by the Organizer's own press.
      const day = dayFromNow(10);
      await prisma.event.update({ where: { id: f.eventId }, data: { dates: "Saturday medal", startOn: day, endOn: day } });
      await organizerPage.goto(`/dashboard?bust=${Date.now()}`);
      await organizerPage.getByRole("button", { name: "Launch tournament" }).first().click();
      const dialog = organizerPage.getByRole("dialog");
      await expect(dialog.getByRole("region", { name: "Still open" })).toBeVisible({ timeout: 15_000 });
      await dialog.getByRole("button", { name: "Launch tournament" }).click();
      await expect.poll(f.status, { timeout: 20_000, message: "the press did not launch it" }).toBe("live");
      await cardsIn(f, f.stageIds[0], f.playerIds.slice(0, 1));
      const beforeLive = { ...seen };
      await walk("live");

      // CONTROL ON THE WALK ITSELF: more screens measured than the menu holds (two stages), real
      // buttons, and real greyed ones on a live tournament.
      expect(seen.screens, "screens measured").toBeGreaterThan(screens.length);
      expect(seen.primaries, "the walk saw no primary button on any screen").toBeGreaterThan(0);
      expect(seen.disabled - beforeLive.disabled, "the walk saw no disabled control on a live tournament").toBeGreaterThan(0);

      const { added, gone } = ratchet([...found], KNOWN);
      if (added.length || gone.length || unreached.length) {
        console.log(
          [
            "",
            "=== CONSOLE SWEEP, AS AN ASSISTANT ===",
            `screens: ${screens.length} from the assistant's menu (the Organizer's has ${organizersScreens.length}; not offered: ${lost.join(" ")}), ${seen.screens} measured across two stages; disabled controls seen: ${seen.disabled}; primaries seen: ${seen.primaries}`,
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
            // The Organizer's walk's lines stay in the file this one prints: it holds no ratchet over them.
            knownFile([...found, ...ORGANIZERS]),
            "--- end console-sweep-known.json ---",
            "",
          ].join("\n"),
        );
      }
      expect(unreached, `screens the walk could not measure:\n${unreached.join("\n")}`).toEqual([]);
      expect(added, `new violations (fix the screen; the log above has them in the list's own form):\n${added.join("\n")}`).toEqual([]);
      expect(gone, `fixed now, delete from e2e/console-sweep-known.json:\n${gone.join("\n")}`).toEqual([]);
    } finally {
      await assistantCtx?.close().catch(() => {});
      await prisma.account.deleteMany({ where: { email: assistantEmail } });
      await prisma.user.deleteMany({ where: { email: assistantEmail } });
      await f.done();
    }
  });
});
