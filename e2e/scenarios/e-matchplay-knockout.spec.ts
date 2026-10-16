import { test, expect, type Page, type BrowserContext } from "../coverage";
import { playScratch } from "../round-basis";
import { appendFileSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { seed, memberSession, eventFacts, roundCards, rng, card, MARK, COURSE, COURSE_CITY, createTournament } from "./kit.mjs";

/**
 * SCENARIO — tournament E: the Eagle club's Matchplay Championship. The
 * whole 120-member roster in a gross stroke-play qualifier, the top 64 overall
 * into a match-play knockout decided on the bracket. Kept in the dev database.
 */
const PHASE = process.env.PHASE ?? "E1";
const OUT = process.env.PROBE_DIR!;
const LOG = () => join(OUT, `five-${PHASE}.txt`);
export const E_NAME = `${MARK} Matchplay Championship${process.env.RUN ? ` ${process.env.RUN}` : ""}`;

test.use({ actionTimeout: 45_000, navigationTimeout: 60_000 });

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(LOG(), "");
});

async function open(page: Page, path: string) {
  const res = await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
  return res;
}

async function read(page: Page, path: string, name: string, chars = 3000) {
  const res = await open(page, path);
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  appendFileSync(LOG(), `\n## ${name} [${res?.status()} → ${new URL(page.url()).pathname}] sideways=${wide}\n${text.slice(0, chars)}\n`);
  await page.screenshot({ path: join(OUT, `five-${PHASE}-${name}.png`), fullPage: false });
}

const note = (s: string) => appendFileSync(LOG(), `\n# ${s}\n`);

async function as(context: BrowserContext, baseURL: string, session: string) {
  await context.clearCookies();
  await context.addCookies([{ name: "ng_session", value: session, url: baseURL }]);
}

test("five E", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== (process.env.PROJECT ?? "desktop"), "one project");
  test.setTimeout(Number(process.env.PHASE_TIMEOUT ?? 900_000));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));
  const s = await seed();
  await as(context, baseURL!, s.club);

  if (PHASE === "E1") {
    await test.step("the secretary creates the Matchplay Championship", async () => {
      if (await eventFacts(E_NAME)) note("this run's tournament already exists — resuming");
      else {
        // From /choose or from Tournaments, whichever this club is offered; and onto the plan a full field needs.
        // This scenario may be the first the club has met: on GitHub each one is given a database of its own.
        await createTournament(page, E_NAME, "A series of rounds");
      }
    });
    await test.step("date and course", async () => {
      await open(page, "/event");
      const d = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
      const d2 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      await page.getByLabel("Tournament dates, first day").fill(d);
      await page.getByLabel("Tournament dates, last day").fill(d2);
      const course = page.getByRole("combobox", { name: "Golf course" });
      await course.click();
      await course.fill(COURSE);
      await page.locator('#course-picker-list [role="option"]', { hasText: COURSE_CITY }).first().click();
      await page.locator("button.btn-primary", { hasText: /Save event|Adding the course/ }).click();
      await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 30_000 });
    });
    await test.step("the field: the whole club roster", async () => {
      if ((await eventFacts(E_NAME))!.players.length >= 120) return note("field already in");
      await open(page, "/registration");
      await page.getByRole("checkbox", { name: /^Select all/ }).first().check();
      await page.getByRole("button", { name: /^Add \d+ members? to / }).click();
      await page.waitForTimeout(5000);
      note(`field: ${(await eventFacts(E_NAME))!.players.length}`);
    });
    await test.step("a gross stroke-play qualifier, then a match-play bracket for the top 64", async () => {
      await open(page, "/stages");
      if (!(await page.getByRole("button", { name: /^Round 1 · Stroke Play Round/ }).count())) {
        await page.getByRole("button", { name: /^Stroke play round/ }).click();
        await page.getByLabel("Format for every round added").selectOption("Stroke Play");
        await page.getByRole("button", { name: /^Add (1 )?stroke play round/ }).click();
        await page.waitForTimeout(2500);
        await page.getByRole("button", { name: /^Bracket/ }).click();
        await page.getByLabel("Format for every round added").selectOption("Match Play");
        await page.getByRole("button", { name: /^Add bracket/ }).click();
        await page.waitForTimeout(2500);
      }
      await open(page, "/stages");
      // A gross qualifier and a scratch knockout: Gross on both, as the
      // organizer chooses it (a new round is off handicap since 2026-10-16).
      await playScratch(page, "Round 1 · Stroke Play Round");
      await playScratch(page, "Round 2 · Bracket Stage");
      const bracketHeader = page.getByRole("button", { name: /Bracket Stage/ }).first();
      if ((await bracketHeader.getAttribute("aria-expanded")) !== "true") await bracketHeader.click();
      await page.locator("label.seg-opt", { hasText: /^\s*Overall\s*$/ }).first().click();
      await page.waitForTimeout(1500);
      const top = page.locator('input[type="number"]').last();
      await top.fill("64");
      await top.blur();
      await page.waitForTimeout(2500);
      await read(page, "/stages", "stages", 4000);
    });
    await test.step("launch, the board public, the qualifier's tee sheet", async () => {
      await open(page, "/dashboard");
      for (const step of ["Start taking entries", "Mark ready"]) {
        const b = page.getByRole("button", { name: step });
        if (await b.count()) {
          await b.click();
          await expect(b).toHaveCount(0, { timeout: 20_000 });
        }
      }
      const launch = page.getByRole("button", { name: "Launch tournament" });
      if (await launch.count()) {
        await launch.click();
        await page.getByRole("dialog").getByRole("button", { name: "Launch tournament" }).click();
        await expect(page.getByRole("button", { name: "Complete tournament" })).toBeVisible({ timeout: 30_000 });
      }
      await open(page, "/event");
      await page.locator("label", { hasText: "Anyone with the link" }).first().click();
      await page.getByRole("button", { name: /^Save/ }).last().click();
      await page.waitForTimeout(2000);
      await open(page, "/foursomes");
      await page.getByRole("button", { name: /^Balanced handicap/ }).click();
      await page.locator("label.seg-opt", { hasText: /^\s*3\s*$/ }).click();
      await page.getByLabel("First tee").fill("07:30");
      await page.getByRole("button", { name: /^Save & publish/ }).click();
      await page.getByRole("button", { name: "Publish the tee sheet" }).click();
      await page.waitForTimeout(3000);
      await read(page, "/dashboard", "dashboard-launched", 3000);
      await read(page, "/bracket", "bracket-before", 2000);
    });
  }

  if (PHASE === "E2") {
    const facts = await eventFacts(E_NAME);
    const q = facts!.stages[0];
    await test.step("the qualifier's cards, imported, and approved", async () => {
      const r = rng(53);
      const rows = facts!.players
        .filter((p) => p.status === "confirmed")
        .map((p) => `${p.name},${card(Math.round((p.handicap * 128) / 113 - 0.2), r).join(",")}`);
      const csv = ["Player," + Array.from({ length: 18 }, (_, i) => i + 1).join(","), ...rows].join("\n");
      await open(page, `/entry?round=${q.id}`);
      await page.getByRole("button", { name: /Import scores/ }).click();
      await page.locator("textarea").first().fill(csv);
      await page.waitForTimeout(800);
      await page.getByRole("button", { name: /^Import \d+ rows?/ }).click();
      await expect(page.getByText(/Imported \d+ row/)).toBeVisible({ timeout: 120_000 });
      note(`import: ${(await page.getByText(/Imported \d+ row/).first().textContent())?.trim()}`);
      await open(page, `/entry?round=${q.id}`);
      const panel = page.locator(".card", { hasText: "Approve this round" }).first();
      const anyway = panel.getByRole("button", { name: "Approve anyway" });
      const t = Date.now();
      for (let left = await anyway.count(); left > 0; left -= 1) {
        await anyway.first().click();
        await expect(anyway).toHaveCount(left - 1, { timeout: 20_000 });
      }
      note(`approved in ${Math.round((Date.now() - t) / 1000)}s`);
    });
    await test.step("close the qualifier", async () => {
      await open(page, "/dashboard");
      const ready = page.getByRole("region", { name: "The round is ready to close" });
      note(`ready-to-close: ${await ready.count()}`);
      if (await ready.count()) {
        await ready.getByRole("button", { name: /^Close / }).click();
        await ready.getByRole("button", { name: /Close the round/ }).click();
        await page.waitForTimeout(3000);
      }
      await read(page, "/dashboard", "dashboard-qualified", 3000);
      await read(page, "/leaderboard", "board-qualifier", 3000);
      await read(page, "/bracket", "bracket-after-qualifier", 3500);
    });
  }

  if (PHASE === "E3") {
    const ROUNDS = ["Round of 64", "Round of 32", "Round of 16", "Quarterfinals", "Semifinals", "Final"];
    const MARGINS = ["3&2", "2&1", "1 UP", "4&3", "19th", "5&4"];
    await test.step("the committee records the knockout, round by round", async () => {
      await open(page, "/bracket");
      // The first column, in draw order: "Name seed Name seed …".
      const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
      const first = text.slice(text.indexOf("ROUND OF 64") + "ROUND OF 64".length);
      const facts = await eventFacts(E_NAME);
      const names = facts!.players.map((p) => p.name).sort((a, b) => b.length - a.length);
      const seeded: Array<{ name: string; seed: number }> = [];
      let rest = first;
      while (seeded.length < 64) {
        rest = rest.trimStart();
        const name = names.find((n) => rest.startsWith(n));
        if (!name) break;
        rest = rest.slice(name.length).trimStart();
        const m = rest.match(/^(\d+)/);
        seeded.push({ name, seed: m ? Number(m[1]) : 99 });
        rest = rest.slice(m ? m[1].length : 0);
      }
      note(`read ${seeded.length} seats off the first column; first pair ${seeded[0]?.name} (${seeded[0]?.seed}) v ${seeded[1]?.name} (${seeded[1]?.seed})`);
      let field = seeded;
      for (const [ri, round] of ROUNDS.entries()) {
        const next: typeof field = [];
        for (let i = 0; i + 1 < field.length; i += 2) {
          const [a, b] = [field[i], field[i + 1]];
          // The higher seed wins, except every seventh tie, which goes the other way.
          const upset = (i / 2 + ri) % 7 === 3;
          const [winner, loser] = (a.seed < b.seed) !== upset ? [a, b] : [b, a];
          const seats = page.getByRole("button", { name: new RegExp(`^${winner.name}`) });
          await seats.nth(ri).click();
          const pair = [winner.name, loser.name];
          const box = page.getByRole("textbox", { name: new RegExp(`^Result of (${pair.join("|")}) v (${pair.join("|")}), ${round}$`) });
          await expect(box, `no margin box for ${winner.name} v ${loser.name}, ${round}`).toBeVisible({ timeout: 20_000 });
          await box.fill(round === "Final" ? "2&1" : MARGINS[(i / 2) % MARGINS.length]);
          await box.press("Tab");
          await expect(page.getByRole("status").filter({ hasText: "Saved" }).first()).toBeVisible({ timeout: 20_000 });
          next.push(winner);
        }
        note(`${round}: ${next.length} through${next.length <= 2 ? ` — ${next.map((w) => `${w.name} (${w.seed})`).join(", ")}` : ""}`);
        field = next;
      }
      note(`champion by the script: ${field[0]?.name} (${field[0]?.seed})`);
    });
    await test.step("the champion, as the club, the public and a member read it", async () => {
      await read(page, "/bracket", "bracket-final", 2500);
      await read(page, "/dashboard", "dashboard-champion", 2500);
      const facts = await eventFacts(E_NAME);
      await read(page, `/live/${facts!.shareToken}`, "live-final", 2500);
      const who = facts!.players.find((p) => p.name === "Jessamy Brackenbury")!;
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
      const p = await phone.newPage();
      p.on("pageerror", (e) => errors.push(`Jessamy ${new URL(p.url()).pathname}: ${String(e)}`));
      await read(p, "/me", "jessamy-today", 1200);
      await read(p, "/me/board", "jessamy-board", 1200);
      await phone.close();
    });
  }

  appendFileSync(LOG(), `\n# page errors: ${errors.length}\n${errors.join("\n")}\n`);
  void roundCards;
  void readFileSync;
  void memberSession;
});
