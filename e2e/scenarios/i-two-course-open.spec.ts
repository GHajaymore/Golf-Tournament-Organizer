import { test, expect, type Page, type BrowserContext } from "../coverage";
import { playScratch } from "../round-basis";
import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { seed, memberSession, eventFacts, rng, card, MARK, COURSE, COURSE_CITY, createTournament, becomesEnabled } from "./kit.mjs";

/**
 * SCENARIO — tournament I: the Eagle club's Two-Course Open. 36-hole gross
 * medal, Round 1 at home (par 72), Round 2 AWAY at a course with its own card
 * (par 70, its own stroke index). CLAUDE.md: an error that shifts every row
 * by the same amount is invisible to ordering checks — so this pins the VALUE:
 * every player's 36-hole to-par must be gross minus 142, against the played
 * courses' own pars. Kept in the dev database.
 */
const PHASE = process.env.PHASE ?? "I1";
const OUT = process.env.PROBE_DIR!;
const LOG = () => join(OUT, `five-${PHASE}.txt`);
export const I_NAME = `${MARK} Two-Course Open${process.env.RUN ? ` ${process.env.RUN}` : ""}`;
const HOME = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const AWAY = [4, 3, 4, 4, 5, 3, 4, 4, 4, 4, 3, 5, 4, 4, 3, 4, 4, 4];
const AWAY_SI = [2, 16, 6, 10, 4, 18, 8, 12, 14, 1, 17, 3, 11, 7, 15, 9, 5, 13];
const AWAY_NAME = `${MARK} Ardmore Links`;
const AWAY_ID = `${MARK}-away-catalogue`;
const PAR_SUM = HOME.reduce((a, b) => a + b, 0) + AWAY.reduce((a, b) => a + b, 0);

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

/** The away course, in the directory the "Played at" picker searches. */
async function seedAway() {
  const prisma = new PrismaClient();
  try {
    await prisma.courseCatalog.upsert({
      where: { id: AWAY_ID },
      update: {},
      create: {
        id: AWAY_ID, name: AWAY_NAME, city: "Ardmore", state: "PA", country: "US", par: AWAY.reduce((a, b) => a + b, 0),
        pars: JSON.stringify(AWAY), yards: JSON.stringify(AWAY.map((p) => (p === 3 ? 165 : p === 4 ? 390 : 520))),
        strokeIndex: JSON.stringify(AWAY_SI),
        tees: JSON.stringify([{ name: "White", gender: "any", courseRating: 69.8, slopeRating: 124, par: 70, yards: 6300 }]),
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Ardmore in the CLUB's own course library — fixture setup, standing in for
 * the secretary adding it on Tournament details (whose "Look up a course"
 * spends an external lookup allowance this probe must not touch).
 */
async function ardmoreInLibrary(eventName: string) {
  const prisma = new PrismaClient();
  try {
    const ev = await prisma.event.findFirst({ where: { name: eventName }, select: { organizationId: true } });
    const has = await prisma.course.findFirst({ where: { organizationId: ev!.organizationId, name: AWAY_NAME }, select: { id: true } });
    if (has) return has.id;
    const c = await prisma.course.create({
      data: {
        organizationId: ev!.organizationId, name: AWAY_NAME, city: "Ardmore",
        pars: JSON.stringify(AWAY), yards: JSON.stringify(AWAY.map((p) => (p === 3 ? 165 : p === 4 ? 390 : 520))),
        strokeIndex: JSON.stringify(AWAY_SI),
      },
      select: { id: true },
    });
    await prisma.tee.create({ data: { courseId: c.id, name: "White", courseRating: 69.8, slopeRating: 124, par: 70 } });
    return c.id;
  } finally {
    await prisma.$disconnect();
  }
}

/** An away gross card: about bogey golf on Ardmore's own pars. */
function awayCard(r: () => number): number[] {
  return AWAY.map((par) => {
    const x = r();
    return Math.max(2, par + (x < 0.1 ? -1 : x < 0.5 ? 0 : x < 0.85 ? 1 : 2));
  });
}

async function approveAndClose(page: Page, roundId: string, label: string) {
  await open(page, `/entry?round=${roundId}`);
  const clean = page.getByRole("button", { name: /^Approve \d+ clean card/ });
  if ((await clean.count()) && (await clean.isEnabled())) {
    note(`${label}: ${(await clean.textContent())?.trim()}`);
    await clean.click();
    await page.waitForTimeout(3000);
  }
  await open(page, "/dashboard");
  const ready = page.getByRole("region", { name: "The round is ready to close" });
  note(`${label}: ready to close: ${await ready.count()}`);
  if (await ready.count()) {
    await ready.getByRole("button", { name: /^Close / }).first().click();
    await ready.getByRole("button", { name: /Close the round/ }).click();
    await page.waitForTimeout(3000);
  }
}

async function importCards(page: Page, roundId: string, rows: string[], label: string) {
  const csv = ["Player," + Array.from({ length: 18 }, (_, i) => i + 1).join(","), ...rows].join("\n");
  await open(page, `/entry?round=${roundId}`);
  await page.getByRole("button", { name: /Import scores/ }).click();
  await page.locator("textarea").first().fill(csv);
  await page.waitForTimeout(800);
  const go = page.getByRole("button", { name: /^Import \d+ rows?/ });
  const text = (await go.textContent())?.trim() ?? "";
  note(`${label}: ${text} (sent ${rows.length})`);
  if (text !== `Import ${rows.length} rows`) note("IMPORT SHORT");
  await go.click();
  await expect(page.getByText(/Imported \d+ row/)).toBeVisible({ timeout: 120_000 });
}

test("five I", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== (process.env.PROJECT ?? "desktop"), "one project");
  test.setTimeout(Number(process.env.PHASE_TIMEOUT ?? 900_000));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));
  const s = await seed();
  await seedAway();
  await as(context, baseURL!, s.club);
  if (await eventFacts(I_NAME)) {
    await open(page, "/tournaments");
    const manage = page.getByRole("button", { name: `Manage ${I_NAME}` });
    if (await manage.count()) {
      await manage.first().click();
      await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    }
  }

  if (PHASE === "I1") {
    await test.step("the secretary creates the Two-Course Open", async () => {
      if (await eventFacts(I_NAME)) return note("already exists — resuming");
      // From /choose or from Tournaments, whichever this club is offered; and onto the plan a full field needs.
      // This scenario may be the first the club has met: on GitHub each one is given a database of its own.
      await createTournament(page, I_NAME, "A series of rounds");
    });
    await test.step("dates and the home course", async () => {
      await open(page, "/event");
      const first = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      const last = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      await page.getByLabel("Tournament dates, first day").fill(first);
      await page.getByLabel("Tournament dates, last day").fill(last);
      const course = page.getByRole("combobox", { name: "Golf course" });
      await course.click();
      await course.fill(COURSE);
      await page.locator('#course-picker-list [role="option"]', { hasText: COURSE_CITY }).first().click();
      const save = page.locator("button.btn-primary", { hasText: /Save event|Adding the course/ });
      if ((await save.count()) && (await becomesEnabled(save))) {
        await save.click();
        await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 30_000 });
      }
    });
    await test.step("the field: the whole club roster", async () => {
      if ((await eventFacts(I_NAME))!.players.length >= 120) return note("field already in");
      await open(page, "/registration");
      const picker = page.locator(".card", { hasText: "Add from the club roster" }).first();
      const open1 = picker.getByRole("button", { name: /Add from the club roster/ });
      if (await open1.count()) await open1.click().catch(() => {});
      await page.getByRole("checkbox", { name: /^Select all/ }).first().check();
      await page.getByRole("button", { name: /^Add \d+ members? to / }).click();
      await page.waitForTimeout(5000);
    });
    await test.step("two rounds of gross stroke play", async () => {
      if ((await eventFacts(I_NAME))!.stages.length >= 2) return note("rounds already in");
      await open(page, "/stages");
      const stroke = page.getByRole("button", { name: /^Stroke play round/ });
      if ((await stroke.count()) === 0) await page.getByRole("button", { name: /^Add a round/ }).click();
      await stroke.click();
      await page.getByLabel("Format for every round added").selectOption("Stroke Play");
      await page.getByLabel("How many rounds to add").fill("2");
      await page.getByRole("button", { name: /^Add (2 )?stroke play rounds?/ }).click();
      await page.waitForTimeout(3000);
      // Gross, as the Open is: chosen on each round (a new round is off
      // handicap unless the organizer says otherwise, since 2026-10-16).
      await open(page, "/stages");
      await playScratch(page, "Round 1 · ");
      await playScratch(page, "Round 2 · ");
      note(`rounds: ${(await eventFacts(I_NAME))!.stages.length}`);
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
    });
  }

  if (PHASE === "I2") {
    const facts = (await eventFacts(I_NAME))!;
    const r1 = facts.stages[0];
    const r = rng(501);
    await test.step("Round 1 at home: the cards come back, accepted, closed", async () => {
      const rows = facts.players
        .filter((p) => p.status === "confirmed")
        .map((p) => `${p.name},${card(Math.round((p.handicap * 128) / 113 - 0.2), r).join(",")}`);
      await importCards(page, r1.id, rows, "round 1");
      await approveAndClose(page, r1.id, "round 1");
    });
  }

  if (PHASE === "I3") {
    const facts = (await eventFacts(I_NAME))!;
    const r2 = facts.stages[1];
    const r = rng(777);
    await test.step("Round 2 is played at Ardmore", async () => {
      await ardmoreInLibrary(I_NAME);
      await open(page, `/entry?round=${r2.id}`);
      const picker = page.getByRole("combobox", { name: "Played at" });
      note(`"Played at" offered: ${await picker.count()}`);
      await picker.click();
      await picker.fill(AWAY_NAME);
      await page.locator('[role="option"]', { hasText: "Ardmore" }).first().click();
      await page.waitForTimeout(3000);
      const prisma = new PrismaClient();
      const st = await prisma.stage.findUnique({ where: { id: r2.id }, select: { courseId: true, course: { select: { name: true, pars: true } } } });
      await prisma.$disconnect();
      note(`round 2 venue stored: ${st?.course?.name ?? "none"} pars ${st?.course?.pars ?? ""}`);
      if (st?.course?.name !== AWAY_NAME) note("AWAY PAR WRONG — round 2 is not at Ardmore");
    });
    await test.step("the Round 2 draw goes out", async () => {
      await open(page, `/foursomes?round=${r2.id}`);
      if (await page.getByRole("button", { name: /Re-draw this sheet/ }).count()) return;
      await page.getByRole("button", { name: "Random", exact: true }).click();
      await page.locator("label.seg-opt", { hasText: /^\s*4\s*$/ }).click();
      await page.getByLabel("First tee").fill("08:00");
      await page.getByRole("button", { name: /^Save & publish/ }).click();
      await page.getByRole("button", { name: "Publish the tee sheet" }).click();
      await page.waitForTimeout(3000);
    });
    const who = facts.players.filter((p) => p.status === "confirmed")[11];
    await test.step(`${who.name} keeps her Ardmore card on her phone`, async () => {
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
      const p = await phone.newPage();
      p.on("pageerror", (e) => errors.push(`member ${new URL(p.url()).pathname}: ${String(e)}`));
      await open(p, "/me/events");
      const ev = p.locator("article", { hasText: I_NAME });
      if (!(await ev.first().isVisible())) await p.locator("details", { has: ev.first() }).locator("summary").click();
      await ev.first().locator("form button[type=submit]").first().click();
      await p.waitForURL((u) => !u.pathname.startsWith("/me/events"), { timeout: 20_000 }).catch(() => {});
      await open(p, "/me/card");
      const opens = (await p.locator("main").innerText()).replace(/\s+/g, " ");
      note(`her card opens: ${opens.slice(0, 200)}`);
      if (!opens.includes("Ardmore")) note("AWAY PAR WRONG — her card does not name Ardmore");
      // Hole 2 is a par 3 at Ardmore and a par 4 at home: the card must say 3.
      await p.getByRole("button", { name: /^Hole 2,/ }).click();
      const hole2 = (await p.locator("main").innerText()).replace(/\s+/g, " ").match(/HOLE 2 Par (\d)/)?.[1];
      note(`her hole 2 reads par ${hole2}`);
      if (hole2 !== "3") note("AWAY PAR WRONG — hole 2 is not Ardmore's par 3");
      const strokes = awayCard(r);
      for (let h = 1; h <= 18; h += 1) {
        await p.getByRole("button", { name: new RegExp(`^Hole ${h},`) }).click();
        await p.getByRole("textbox", { name: `Strokes on hole ${h}` }).fill(String(strokes[h - 1]));
        await expect(p.getByRole("button", { name: `Hole ${h}, not scored` })).toHaveCount(0);
      }
      await p.waitForTimeout(1500);
      await open(p, "/me/card");
      const certify = p.getByRole("button", { name: /Certify my card/ });
      if (await certify.count()) await certify.click();
      await p.waitForTimeout(1500);
      await phone.close();
    });
    await test.step("the rest of Round 2 comes back, accepted, closed", async () => {
      const rows = facts.players
        .filter((p) => p.status === "confirmed" && p.id !== who.id)
        .map((p) => `${p.name},${awayCard(r).join(",")}`);
      await importCards(page, r2.id, rows, "round 2");
      await approveAndClose(page, r2.id, "round 2");
    });
  }

  if (PHASE === "I4") {
    const facts = (await eventFacts(I_NAME))!;
    await test.step("every to-par is gross minus the two courses' pars", async () => {
      await read(page, "/leaderboard", "board-final", 3000);
      const head = (await page.locator("table thead tr").first().locator("th").allInnerTexts()).map((t) => t.trim().toLowerCase());
      note(`columns: ${head.join(" | ")}`);
      const gi = head.findIndex((h) => h.startsWith("gross") || h === "tot" || h === "total");
      const ti = head.findIndex((h) => h.includes("par"));
      const rows = await page.locator("table").first().locator("tbody tr").evaluateAll((trs) =>
        trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => (td as HTMLElement).innerText.trim())),
      );
      const num = (s: string) => (s === "E" ? 0 : Number(s.replace(/[^\d+-]/g, "")));
      let wrong = 0;
      let checked = 0;
      for (const cells of rows) {
        const g = num(cells[gi] ?? "");
        const t = num(cells[ti] ?? "");
        if (!Number.isFinite(g) || !Number.isFinite(t) || g < 100) continue;
        checked += 1;
        if (t !== g - PAR_SUM) {
          wrong += 1;
          if (wrong <= 3) note(`row ${cells[0]} ${cells[1]?.split("\n")[0]}: gross ${g} to-par ${t}, expected ${g - PAR_SUM}`);
        }
      }
      note(`to-par checked on ${checked} rows against par ${PAR_SUM}: ${wrong} wrong`);
      if (checked === 0) note("AWAY PAR WRONG — no rows could be checked");
      if (wrong > 0) note("AWAY PAR WRONG — the 36-hole to-par is not against the played courses");
    });
    await test.step("complete; the public board says the same", async () => {
      if ((await eventFacts(I_NAME))!.status !== "completed") {
        await open(page, "/dashboard");
        await page.getByRole("button", { name: "Complete tournament" }).first().click();
        await page.getByRole("alertdialog").getByRole("button", { name: "Complete tournament" }).click();
        await expect.poll(async () => (await eventFacts(I_NAME))!.status, { timeout: 20_000 }).toBe("completed");
      }
      await open(page, "/event");
      const pub = page.locator("label", { hasText: "Anyone with the link" }).first();
      if (await pub.count()) {
        await pub.click();
        const save = page.getByRole("button", { name: /^Save/ }).last();
        if (await becomesEnabled(save)) await save.click();
        await page.waitForTimeout(2000);
      }
      await read(page, `/live/${facts.shareToken}`, "live-final", 2000);
    });
  }

  appendFileSync(LOG(), `\n# page errors: ${errors.length}\n${errors.join("\n")}\n`);
});
