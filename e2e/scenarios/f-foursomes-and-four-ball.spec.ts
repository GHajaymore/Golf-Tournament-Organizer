import { test, expect, type Page, type BrowserContext } from "../coverage";
import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { seed, memberSession, eventFacts, rng, MARK, COURSE, COURSE_CITY, PARS, createTournament, becomesEnabled } from "./kit.mjs";

/**
 * SCENARIO — tournament F: the Eagle club's Foursomes & Four-Ball Day. The
 * whole roster, two team rounds of DIFFERENT formats, each with its own draw:
 * Round 1 Foursomes (one ball), its cards returned as a spreadsheet and
 * imported by side name or a player's name; Round 2 a gross Four-Ball the
 * committee enters as ONE CARD FOR THE SIDE — three sides typed on members'
 * phones, the rest imported. Kept in the dev database.
 */
const PHASE = process.env.PHASE ?? "F1";
const OUT = process.env.PROBE_DIR!;
const LOG = () => join(OUT, `five-${PHASE}.txt`);
export const F_NAME = `${MARK} Foursomes Day${process.env.RUN ? ` ${process.env.RUN}` : ""}`;

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

/** Read-only: a round's sides and the team cards stored for it. */
async function sidesOf(stageId: string) {
  const prisma = new PrismaClient();
  try {
    const teams = await prisma.team.findMany({
      where: { stageId },
      select: { id: true, name: true, members: { select: { player: { select: { id: true, name: true, email: true, handicap: true } } }, orderBy: { position: "asc" } } },
      orderBy: { seed: "asc" },
    });
    const cards = await prisma.teamScorecard.findMany({ where: { stageId }, select: { teamId: true, playerId: true, strokes: true } });
    return { teams, cards };
  } finally {
    await prisma.$disconnect();
  }
}

/** A side's one-ball gross card: about a bogey round with noise. */
function sideCard(r: () => number, offset: number): number[] {
  return PARS.map((par: number) => {
    const x = r();
    return Math.max(2, par + (x < 0.1 ? -1 : x < 0.55 ? 0 : x < 0.88 ? 1 : 2) + (r() < offset ? 1 : 0));
  });
}

/** Paste a CSV into the team importer on /entry for a round and apply it. */
async function importCsv(page: Page, roundId: string, csv: string, rows: number) {
  await open(page, `/entry?round=${roundId}`);
  await page.getByRole("button", { name: "Import scores" }).click();
  await page.locator(".card", { hasText: "Import scores from a file" }).locator("textarea").fill(csv);
  const ready = page.getByText(/\d+ of \d+ rows? ready to import/).first();
  await ready.waitFor({ timeout: 20_000 });
  const said = (await ready.innerText()).trim();
  note(`importer says: ${said} (sent ${rows})`);
  if (!said.startsWith(`${rows} of ${rows} `)) note("IMPORT SHORT");
  await page.getByRole("button", { name: /^Import \d+ rows?/ }).click();
  const done = page.getByText(/Imported \d+ rows?/).first();
  await done.waitFor({ timeout: 60_000 });
  note(`import result: ${(await done.innerText()).replace(/\s+/g, " ").slice(0, 200)}`);
}

test("five F", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== (process.env.PROJECT ?? "desktop"), "one project");
  test.setTimeout(Number(process.env.PHASE_TIMEOUT ?? 900_000));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));
  const s = await seed();
  await as(context, baseURL!, s.club);
  // The console works on the ACTIVE tournament, an HttpOnly cookie a fresh
  // context does not have — choose this one, as a secretary would.
  if (await eventFacts(F_NAME)) {
    await open(page, "/tournaments");
    // No Manage button means it is already the one being managed.
    const manage = page.getByRole("button", { name: `Manage ${F_NAME}` });
    if (await manage.count()) {
      await manage.first().click();
      await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    }
  }

  if (PHASE === "F1") {
    await test.step("the secretary creates the Foursomes Day", async () => {
      if (await eventFacts(F_NAME)) {
        note("this run's tournament already exists — resuming");
      } else {
        // From /choose or from Tournaments, whichever this club is offered; and onto the plan a full field needs.
        // This scenario may be the first the club has met: on GitHub each one is given a database of its own.
        await createTournament(page, F_NAME, "A series of rounds");
      }
    });

    await test.step("date and course", async () => {
      await open(page, "/event");
      const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      await page.getByLabel("Tournament dates, first day").fill(day);
      await page.getByLabel("Tournament dates, last day").fill(day);
      const course = page.getByRole("combobox", { name: "Golf course" });
      await course.click();
      await course.fill(COURSE);
      await page.locator('#course-picker-list [role="option"]', { hasText: COURSE_CITY }).first().click();
      const save = page.locator("button.btn-primary", { hasText: /Save event|Adding the course/ });
      if ((await save.count()) && (await becomesEnabled(save))) {
        await save.click();
        await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 30_000 });
      } else note("event details unchanged — resuming");
    });

    await test.step("the field: the whole club roster", async () => {
      if ((await eventFacts(F_NAME))!.players.length >= 120) return note("field already in — resuming");
      await open(page, "/registration");
      const picker = page.locator(".card", { hasText: "Add from the club roster" }).first();
      const open1 = picker.getByRole("button", { name: /Add from the club roster/ });
      if (await open1.count()) await open1.click().catch(() => {});
      await page.getByRole("checkbox", { name: /^Select all/ }).first().check();
      await page.getByRole("button", { name: /^Add \d+ members? to / }).click();
      await page.waitForTimeout(5000);
      note(`field: ${(await eventFacts(F_NAME))!.players.filter((p) => p.status === "confirmed").length} confirmed`);
    });

    await test.step("Round 1 Foursomes, Round 2 Four-Ball", async () => {
      if ((await eventFacts(F_NAME))!.stages.length >= 2) return note("rounds already in — resuming");
      for (const format of ["Foursomes", "Four-Ball"]) {
        await open(page, "/stages");
        const stroke = page.getByRole("button", { name: /^Stroke play round/ });
        if ((await stroke.count()) === 0) await page.getByRole("button", { name: /^Add a round/ }).click();
        await stroke.click();
        await page.getByLabel("Format for every round added").selectOption(format);
        const howMany = page.getByLabel(/How many rounds|Number of rounds/);
        if (await howMany.count()) await howMany.fill("1");
        await page.getByRole("button", { name: /^Add (1 )?stroke play rounds?/ }).click();
        await page.waitForTimeout(2500);
      }
      await read(page, "/stages", "stages", 3000);
    });

    await test.step("Round 2 is entered as one card for the side", async () => {
      await open(page, "/stages");
      // Round 2's card, opened, and its customisations shown.
      const head = page.getByRole("button", { name: /^Round 2 · / }).first();
      if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
      const pick = page.locator("select").filter({ has: page.locator("option", { hasText: "One card for the side" }) });
      if (!(await pick.first().isVisible().catch(() => false))) {
        const custom = page.getByRole("button", { name: /^Customize this round/ });
        for (let i = 0; i < (await custom.count()); i += 1) {
          if (await custom.nth(i).isVisible()) await custom.nth(i).click().catch(() => {});
        }
      }
      note(`entry controls on the Rounds screen: ${await pick.count()} visible: ${await pick.first().isVisible().catch(() => false)}`);
      await pick.first().selectOption({ label: "One card for the side" });
      await page.waitForTimeout(2500);
      const prisma = new PrismaClient();
      const r2 = (await eventFacts(F_NAME))!.stages[1];
      const row = await prisma.stage.findUnique({ where: { id: r2.id }, select: { scoreInput: true, format: true, scoringBasis: true } });
      await prisma.$disconnect();
      note(`round 2 stored: ${JSON.stringify(row)}`);
    });

    await test.step("each round's sides, drawn by the committee", async () => {
      const facts = (await eventFacts(F_NAME))!;
      for (const r of facts.stages) {
        await open(page, `/teams?round=${r.id}`);
        const draw = page.getByRole("button", { name: /Draw sides automatically/ });
        if (await draw.count()) {
          await draw.click();
          const replace = page.getByRole("button", { name: /Replace and redraw/ });
          if (await replace.count()) await replace.click();
          await page.waitForTimeout(4000);
        }
        note(`round ${r.description}: ${(await sidesOf(r.id)).teams.length} sides`);
      }
      await read(page, `/teams?round=${facts.stages[1].id}`, "teams-r2", 1500);
    });

    await test.step("launch, the board public", async () => {
      await open(page, "/dashboard");
      for (const step of ["Start taking entries", "Mark ready"]) {
        const b = page.getByRole("button", { name: step });
        if (await b.count()) {
          await b.click();
          await expect(b).toHaveCount(0, { timeout: 20_000 });
        }
      }
      await page.getByRole("button", { name: "Launch tournament" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Launch tournament" }).click();
      await expect(page.getByRole("button", { name: "Complete tournament" })).toBeVisible({ timeout: 30_000 });
      await open(page, "/event");
      await page.locator("label", { hasText: "Anyone with the link" }).first().click();
      await page.getByRole("button", { name: /^Save/ }).last().click();
      await page.waitForTimeout(2500);
    });
  }

  if (PHASE === "F2") {
    const r1 = (await eventFacts(F_NAME))!.stages[0];
    const { teams } = await sidesOf(r1.id);
    const r = rng(11);
    await test.step("Round 1's cards come back as a spreadsheet", async () => {
      // Half the rows name the side, half name its first player — the two ways
      // a secretary's sheet is written.
      const lines = teams.map((t, i) => `${i % 2 ? t.members[0].player.name : t.name},${sideCard(r, 0.2).join(",")}`);
      const csv = [`Player,${PARS.map((_: number, i: number) => i + 1).join(",")}`, ...lines].join("\n");
      await importCsv(page, r1.id, csv, lines.length);
      const { cards } = await sidesOf(r1.id);
      note(`round 1 cards stored: ${cards.length} of ${teams.length} sides; per player: ${cards.filter((c) => c.playerId).length}`);
      if (cards.length !== teams.length || cards.some((c) => c.playerId)) note("IMPORT SHORT — round 1 is not one card per side");
      await read(page, `/leaderboard?round=${r1.id}`, "board-r1", 2500);
    });
  }

  if (PHASE === "F3") {
    const r2 = (await eventFacts(F_NAME))!.stages[1];
    const { teams } = await sidesOf(r2.id);
    const r = rng(23);
    const typed = teams.slice(0, 3);
    await test.step("three sides keep their one card on a member's phone", async () => {
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      const p = await phone.newPage();
      p.on("pageerror", (e) => errors.push(`member ${new URL(p.url()).pathname}: ${String(e)}`));
      for (const t of typed) {
        const who = t.members[1].player;
        await phone.clearCookies();
        await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
        await open(p, `/entry?round=${r2.id}`);
        const full = p.getByRole("button", { name: "Full card" });
        if (await full.count()) await full.click();
        const strokes = sideCard(r, 0.1);
        note(`${who.name} (${t.name}): side inputs ${await p.getByLabel(`${t.name}, hole 1, par ${PARS[0]}`).count()}, own inputs ${await p.getByLabel(`${who.name}, hole 1, par ${PARS[0]}`).count()}`);
        for (let h = 1; h <= 18; h += 1) await p.getByLabel(`${t.name}, hole ${h}, par ${PARS[h - 1]}`).fill(String(strokes[h - 1]));
        await p.getByRole("button", { name: /^Save card/ }).first().click();
        await p.getByText(/gross · .* net · 18 holes|didn't load|not on this team|only enter|card for each partner|not one each/).first().waitFor({ timeout: 20_000 }).catch(() => {});
        const t2 = (await p.locator("main").innerText()).replace(/\s+/g, " ");
        const refused = /didn't load|not on this team|only enter|card for each partner|not one each/.test(t2);
        note(`${who.name}: ${refused ? `REFUSED ${t2.slice(0, 200)}` : "saved"}`);
      }
      await phone.close();
    });
    await test.step("the rest imported by a player's name", async () => {
      const rest = teams.slice(3);
      const lines = rest.map((t) => `${t.members[0].player.name},${sideCard(r, 0.15).join(",")}`);
      const csv = [`Player,${PARS.map((_: number, i: number) => i + 1).join(",")}`, ...lines].join("\n");
      await importCsv(page, r2.id, csv, lines.length);
      const { cards } = await sidesOf(r2.id);
      note(`round 2 cards stored: ${cards.length} of ${teams.length} sides; per player: ${cards.filter((c) => c.playerId).length}`);
      if (cards.length !== teams.length || cards.some((c) => c.playerId)) note("IMPORT SHORT — round 2 is not one card per side");
      await read(page, `/leaderboard?round=${r2.id}`, "board-r2", 2500);
      const toPar = [...(await page.locator("body").innerText()).matchAll(/([+-]\d+|E)\s*$/gm)].length;
      note(`board-r2 lines ending in a to-par: ${toPar}`);
    });
  }

  if (PHASE === "F4") {
    await test.step("close both rounds, complete", async () => {
      if ((await eventFacts(F_NAME))!.status === "completed") return note("already completed — resuming");
      for (let i = 0; i < 2; i += 1) {
        await open(page, "/dashboard");
        const ready = page.getByRole("region", { name: "The round is ready to close" });
        if (await ready.count()) {
          await ready.getByRole("button", { name: /^Close / }).first().click();
          await ready.getByRole("button", { name: /Close the round/ }).click();
          await page.waitForTimeout(3000);
        }
      }
      await page.getByRole("button", { name: "Complete tournament" }).first().click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Complete tournament" }).click();
      await expect.poll(async () => (await eventFacts(F_NAME))!.status, { timeout: 20_000 }).toBe("completed");
      note(`status: completed`);
    });
    await test.step("the result", async () => {
      const facts = (await eventFacts(F_NAME))!;
      for (const [i, st] of facts.stages.entries()) await read(page, `/leaderboard?round=${st.id}`, `board-final-r${i + 1}`, 1800);
      // A total belongs exactly where the same pairs played both rounds —
      // a foursomes-and-four-ball aggregate — and nowhere else.
      const keys = await Promise.all(
        facts.stages.map(async (st) => new Set((await sidesOf(st.id)).teams.map((t) => t.members.map((m) => m.player.id).sort().join("|")))),
      );
      const samePairs = keys[0].size === keys[1].size && [...keys[0]].every((k) => keys[1].has(k));
      const shown = (await page.getByRole("heading", { name: "Total over 2 rounds" }).count()) > 0;
      note(`same pairs both rounds: ${samePairs}; total shown: ${shown}`);
      if (shown !== samePairs) note("PAIR TOTAL OVER DIFFERENT PAIRS — or missing over the same ones");
      if (shown) {
        // The first row adds up: R1 + R2 = Total.
        const cells = await page.locator("table").first().locator("tbody tr").first().locator("td").allInnerTexts();
        const [r1, r2, total] = cells.slice(2, 5).map((c) => Number(c));
        note(`top pair: ${cells[1].split("\n")[0]} ${r1} + ${r2} = ${total}`);
        if (r1 + r2 !== total) note("PAIR TOTAL OVER — the sum is wrong");
      }
      await read(page, `/live/${facts.shareToken}`, "live-final", 2500);
      await read(page, "/reports", "reports", 2000);
    });
  }

  appendFileSync(LOG(), `\n# page errors: ${errors.length}\n${errors.join("\n")}\n`);
});
