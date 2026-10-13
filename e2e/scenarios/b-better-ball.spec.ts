import { test, expect, type Page, type BrowserContext } from "../coverage";
import { appendFileSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { seed, memberSession, eventFacts, roundCards, rng, card, MARK, COURSE, COURSE_CITY, createTournament } from "./kit.mjs";

/**
 * SCENARIO — tournament B: the Eagle club's Autumn Better-Ball. The
 * whole 120-member roster as 60 pairs drawn automatically, two rounds of
 * Four-Ball Best Ball on net, totals over both. Kept in the dev database.
 */
const PHASE = process.env.PHASE ?? "B1";
const OUT = process.env.PROBE_DIR!;
const LOG = () => join(OUT, `five-${PHASE}.txt`);
export const B_NAME = `${MARK} Autumn Better-Ball${process.env.RUN ? ` ${process.env.RUN}` : ""}`;

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

test("five B", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== (process.env.PROJECT ?? "desktop"), "one project");
  test.setTimeout(Number(process.env.PHASE_TIMEOUT ?? 900_000));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));
  const s = await seed();
  await as(context, baseURL!, s.club);

  if (PHASE === "B1") {
    await test.step("the secretary creates the Autumn Better-Ball", async () => {
      if (await eventFacts(B_NAME)) {
        note("this run's tournament already exists — resuming");
      } else {
        // From /choose or from Tournaments, whichever this club is offered; and onto the plan a full field needs.
        // This scenario may be the first the club has met: on GitHub each one is given a database of its own.
        await createTournament(page, B_NAME, "A series of rounds");
      }
      await read(page, "/dashboard", "dashboard-new", 1500);
    });

    await test.step("date and course", async () => {
      await open(page, "/event");
      const sat = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      const sun = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      await page.getByLabel("Tournament dates, first day").fill(sat);
      await page.getByLabel("Tournament dates, last day").fill(sun);
      const course = page.getByRole("combobox", { name: "Golf course" });
      await course.click();
      await course.fill(COURSE);
      await page.locator('#course-picker-list [role="option"]', { hasText: COURSE_CITY }).first().click();
      await page.locator("button.btn-primary", { hasText: /Save event|Adding the course/ }).click();
      await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 30_000 });
    });

    await test.step("the field: the whole club roster", async () => {
      if ((await eventFacts(B_NAME))!.players.length >= 120) {
        note("field already in — resuming");
        return;
      }
      await open(page, "/registration");
      const picker = page.locator(".card", { hasText: "Add from the club roster" }).first();
      const open1 = picker.getByRole("button", { name: /Add from the club roster/ });
      if (await open1.count()) await open1.click().catch(() => {});
      await page.getByRole("checkbox", { name: /^Select all/ }).first().check();
      const add = page.getByRole("button", { name: /^Add \d+ members? to / });
      note(`add button: ${(await add.textContent())?.trim()}`);
      await add.click();
      await page.waitForTimeout(5000);
      const facts = await eventFacts(B_NAME);
      note(`field: ${facts!.players.filter((p) => p.status === "confirmed").length} confirmed`);
      await read(page, "/registration", "registration", 1500);
    });

    await test.step("two rounds of Four-Ball Best Ball, net", async () => {
      await open(page, "/stages");
      await page.getByRole("button", { name: /^Stroke play round/ }).click();
      await page.getByLabel("Format for every round added").selectOption("Four-Ball");
      const howMany = page.getByLabel(/How many rounds|Number of rounds/);
      if (await howMany.count()) await howMany.fill("2");
      await page.getByRole("button", { name: /^Add (2 )?stroke play rounds?/ }).click();
      await page.waitForTimeout(2500);
      await read(page, "/stages", "stages", 3500);
    });

    await test.step("sixty pairs, drawn by the committee", async () => {
      await open(page, "/teams");
      await read(page, "/teams", "teams-before", 1500);
      const draw = page.getByRole("button", { name: /Draw sides automatically/ });
      note(`draw button: ${await draw.count()}`);
      if (await draw.count()) {
        await draw.click();
        const replace = page.getByRole("button", { name: /Replace and redraw/ });
        if (await replace.count()) await replace.click();
        await page.waitForTimeout(4000);
      }
      await read(page, "/teams", "teams", 3000);
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

    await test.step("the Round 1 tee sheet keeps each pair together", async () => {
      await open(page, "/foursomes");
      await page.getByRole("button", { name: /^Balanced handicap/ }).click();
      await page.locator("label.seg-opt", { hasText: /^\s*4\s*$/ }).click();
      await page.getByLabel("First tee").fill("08:00");
      await page.getByRole("button", { name: /^Save & publish/ }).click();
      await page.getByRole("button", { name: "Publish the tee sheet" }).click();
      await page.waitForTimeout(3000);
      await read(page, "/foursomes", "teesheet", 3000);
      await read(page, "/dashboard", "dashboard-launched", 3000);
    });
  }

  if (PHASE === "B2") {
    const facts = await eventFacts(B_NAME);
    const r1 = facts!.stages[0];
    await test.step("a pair on the course: one member keeps the group's card", async () => {
      // Whoever is first on the published sheet, and their group.
      await open(page, `/foursomes?round=${r1.id}`);
      const firstGroup = (await page.locator("main").innerText()).match(/Group 1 avg [\d.]+ Hole 1 · [^G]*?((?:[A-Z][a-z]+ [A-Z][a-z]+ [\d.]+ ?){2,4})/);
      note(`group 1 text: ${firstGroup?.[1] ?? "?"}`);
      const who = facts!.players.find((p) => firstGroup?.[1]?.includes(p.name)) ?? facts!.players[0];
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
      const p = await phone.newPage();
      p.on("pageerror", (e) => errors.push(`${who.name} ${new URL(p.url()).pathname}: ${String(e)}`));
      note(`KEEPS THE CARD: ${who.name}`);
      await read(p, "/me", "keeper-today", 1500);
      await read(p, "/me/card", "keeper-card", 2000);
      await phone.close();
    });
    await test.step("the secretary's score entry on a pairs round", async () => {
      await read(page, `/entry?round=${r1.id}`, "entry-r1", 3000);
      const importBtn = page.getByRole("button", { name: /Import scores/ });
      note(`import offered: ${await importBtn.count()}`);
    });
  }

  if (PHASE === "B3") {
    const facts = await eventFacts(B_NAME);
    const r1 = facts!.stages[0];
    const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
    // Faye (2.7) mostly pars with three bogeys; Delphine (29.9) bogeys and
    // doubles, with a par on the 4th and the 13th — her strokes make those count.
    const cards: Record<string, number[]> = {
      "Faye Brackenbury": PAR.map((p, i) => (i === 3 || i === 9 || i === 15 ? p + 1 : p)),
      "Delphine Ashgrove": PAR.map((p, i) => (i === 3 || i === 12 ? p : i % 2 ? p + 2 : p + 1)),
    };
    for (const [name, strokes] of Object.entries(cards)) {
      await test.step(`${name} keeps her own four-ball card on her phone`, async () => {
        const who = facts!.players.find((p) => p.name === name)!;
        const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
        await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
        const p = await phone.newPage();
        p.on("pageerror", (e) => errors.push(`${name} ${new URL(p.url()).pathname}: ${String(e)}`));
        await read(p, "/me/card", `${name.split(" ")[0]}-mycard`, 900);
        const enter = p.getByRole("link", { name: /^Enter my card/ });
        note(`${name}: "Enter my card" offered: ${await enter.count()}`);
        await enter.click();
        await p.waitForURL(/\/entry/, { timeout: 30_000 });
        await p.waitForLoadState("networkidle");
        note(`${name}: landed on ${new URL(p.url()).pathname}${new URL(p.url()).search.replace(/bust=\d+&?/, "")}`);
        const full = p.getByRole("button", { name: "Full card" });
        if (await full.count()) await full.click();
        const cardsShown = await p.getByRole("button", { name: /^Save card/ }).count();
        note(`${name}: cards on her screen: ${cardsShown}`);
        for (let h = 1; h <= 18; h += 1) {
          await p.getByLabel(`${name}, hole ${h}, par ${PAR[h - 1]}`).fill(String(strokes[h - 1]));
        }
        await p.getByRole("button", { name: /^Save card/ }).first().click();
        await p.waitForTimeout(2500);
        const said = (await p.locator("main").innerText()).replace(/\s+/g, " ");
        note(`${name}: after save — ${(said.match(/(Saved[^.]*|not[^.]*team[^.]*|only enter[^.]*|error[^.]*)\./gi) || []).join(" | ") || said.slice(0, 200)}`);
        await read(p, "/me", `${name.split(" ")[0]}-today-after`, 900);
        await phone.close();
      });
    }
    await test.step("the side's better ball, on the board", async () => {
      await read(page, `/leaderboard`, "board-r1", 2000);
      const cardsIn = await roundCards(r1.id);
      note(`individual Scorecard rows for round 1 (should be none on a pairs round): ${cardsIn.length}`);
    });
  }

  if (PHASE === "B4" || PHASE === "B4b") {
    const ROUND_N = PHASE === "B4b" ? "2" : (process.env.ROUND ?? "1");
    const facts = await eventFacts(B_NAME);
    const r1 = facts!.stages[ROUND_N === "2" ? 1 : 0];
    const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
    const skip = new Set(ROUND_N === "2" ? [] : ["Faye Brackenbury", "Delphine Ashgrove"]);
    const r = rng(ROUND_N === "2" ? 77 : 41);
    const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
    const p = await phone.newPage();
    p.on("pageerror", (e) => errors.push(`member ${new URL(p.url()).pathname}: ${String(e)}`));
    const kept: Record<string, number[]> = {};
    let saved = 0;
    const refused: string[] = [];
    await test.step("every other member keeps their own card", async () => {
      for (const who of facts!.players.filter((x) => x.status === "confirmed" && !skip.has(x.name))) {
        const strokes = card(Math.round((who.handicap * 128) / 113 - 0.2), r);
        await phone.clearCookies();
        await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
        await open(p, `/entry?round=${r1.id}`);
        const full = p.getByRole("button", { name: "Full card" });
        if (await full.count()) await full.click();
        for (let h = 1; h <= 18; h += 1) await p.getByLabel(`${who.name}, hole ${h}, par ${PAR[h - 1]}`).fill(String(strokes[h - 1]));
        await p.getByRole("button", { name: /^Save card/ }).first().click();
        await p.getByText(/gross · .* net · 18 holes|didn't load|not on this team|only enter/).first().waitFor({ timeout: 20_000 }).catch(() => {});
        const t = (await p.locator("main").innerText()).replace(/\s+/g, " ");
        if (/didn't load|not on this team|only enter/.test(t)) refused.push(`${who.name}: ${t.slice(0, 160)}`);
        else saved += 1;
        kept[who.id] = strokes;
      }
      note(`saved ${saved}; refused ${refused.length}${refused.length ? `: ${refused.slice(0, 3).join(" | ")}` : ""}`);
    });
    await phone.close();
    writeFileSync(join(OUT, `kept-r${ROUND_N}.json`), JSON.stringify(kept));
    await test.step("the board", async () => {
      await read(page, `/leaderboard`, `board-r${ROUND_N}`, 2500);
      await read(page, `/dashboard`, `dashboard-r${ROUND_N}`, 2500);
    });
  }

  if (PHASE === "B5") {
    const facts = await eventFacts(B_NAME);
    const r2 = facts!.stages[1];
    await test.step("close Round 1", async () => {
      await open(page, "/dashboard");
      const ready = page.getByRole("region", { name: "The round is ready to close" });
      note(`ready-to-close: ${await ready.count()}`);
      if (await ready.count()) {
        await ready.getByRole("button", { name: /^Close / }).click();
        await ready.getByRole("button", { name: /Close the round/ }).click();
        await page.waitForTimeout(3000);
      }
      await read(page, "/dashboard", "dashboard-r1-closed", 2500);
    });
    await test.step("Round 2's sides: the same balanced pairs", async () => {
      await open(page, `/teams?round=${r2.id}`);
      const already = await (async () => {
        const prisma = new (await import("@prisma/client")).PrismaClient();
        const n = await prisma.team.count({ where: { stageId: r2.id } });
        await prisma.$disconnect();
        return n;
      })();
      note(`round 2 sides before anything is done: ${already}`);
      const draw = page.getByRole("button", { name: /Draw sides automatically/ });
      if (already > 0) {
        // Drawn with Round 1 — nothing to do here.
      } else if ((await draw.count()) && !(await draw.isEnabled())) {
        note("setup is locked after launch — unlocking to draw Round 2's sides");
        await page.getByRole("button", { name: /^Unlock setup/ }).click();
        const confirm = page.getByRole("button", { name: /^(Unlock|Yes, unlock|Unlock setup)/ }).last();
        if (await confirm.count()) await confirm.click().catch(() => {});
        await expect(draw).toBeEnabled({ timeout: 20_000 });
      }
      if (already === 0 && (await draw.count())) {
        await draw.click();
        const replace = page.getByRole("button", { name: /Replace and redraw/ });
        if (await replace.count()) await replace.click();
        await page.waitForTimeout(4000);
      }
      // Same partners as Round 1? Compare by member names.
      const prisma = new (await import("@prisma/client")).PrismaClient();
      const sides = async (stageId: string) =>
        (await prisma.team.findMany({ where: { stageId }, select: { members: { select: { playerId: true } } } }))
          .map((t) => t.members.map((m) => m.playerId).sort().join("+"))
          .sort();
      const a = await sides(facts!.stages[0].id);
      const b = await sides(r2.id);
      note(`round 2 sides: ${b.length}; same pairs as round 1: ${a.length === b.length && a.every((x, i) => x === b[i])}`);
      await prisma.$disconnect();
    });
    await test.step("the Round 2 draw: by position, leaders last, pairs together", async () => {
      await open(page, `/foursomes?round=${r2.id}`);
      const redraw = page.getByRole("button", { name: /Re-draw this sheet/ });
      if (await redraw.count()) await redraw.click();
      const byPos = page.getByRole("button", { name: /^By position/ });
      // Since 2026-10-10 a pairs round two is drawn off the sides' own board.
      const posOn = (await byPos.count()) > 0 && (await byPos.isEnabled());
      note(posOn ? "by position offered for pairs" : "BY POSITION OFF FOR PAIRS");
      if (posOn) await byPos.click();
      else await page.getByRole("button", { name: /^Balanced handicap/ }).click();
      const last = page.getByRole("button", { name: "Leaders out last" });
      if (await last.isEnabled().catch(() => false)) await last.click();
      await page.locator("label.seg-opt", { hasText: /^\s*4\s*$/ }).click();
      await page.getByLabel("First tee").fill("08:00");
      await page.getByRole("button", { name: /^Save & publish/ }).click();
      await page.getByRole("button", { name: "Publish the tee sheet" }).click();
      await page.waitForTimeout(3000);
      await read(page, `/foursomes?round=${r2.id}`, "teesheet-r2", 2500);
    });
  }

  if (PHASE === "B6") {
    await test.step("close Round 2, complete", async () => {
      await open(page, "/dashboard");
      const ready = page.getByRole("region", { name: "The round is ready to close" });
      note(`ready-to-close: ${await ready.count()}`);
      if (await ready.count()) {
        await ready.getByRole("button", { name: /^Close / }).click();
        await ready.getByRole("button", { name: /Close the round/ }).click();
        await page.waitForTimeout(3000);
      }
      await page.getByRole("button", { name: "Complete tournament" }).first().click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Complete tournament" }).click();
      await expect.poll(async () => (await eventFacts(B_NAME))!.status, { timeout: 20_000 }).toBe("completed");
      await page.waitForTimeout(1500);
      note(`status: ${(await eventFacts(B_NAME))!.status}`);
    });
    await test.step("the result", async () => {
      await read(page, "/leaderboard", "board-final", 3000);
      // A 36-hole pairs event is won on the pairs' total (2026-10-10).
      const total = page.getByRole("heading", { name: "Total over 2 rounds" });
      note((await total.count()) ? "pair total shown" : "NO PAIR TOTAL");
      await read(page, "/reports", "reports", 2500);
      const facts = await eventFacts(B_NAME);
      await read(page, `/live/${facts!.shareToken}`, "live-final", 3000);
      const who = facts!.players.find((p) => p.name === "Faye Brackenbury")!;
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
      const p = await phone.newPage();
      p.on("pageerror", (e) => errors.push(`Faye ${new URL(p.url()).pathname}: ${String(e)}`));
      await read(p, "/me", "faye-final", 1200);
      await read(p, "/me/board", "faye-board-final", 1200);
      await phone.close();
    });
  }

  if (PHASE === "B7") {
    await test.step("a member opens the finished pairs event on her phone", async () => {
      const facts = await eventFacts(B_NAME);
      const who = facts!.players.find((p) => p.name === "Faye Brackenbury")!;
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
      const p = await phone.newPage();
      p.on("pageerror", (e) => errors.push(`Faye ${new URL(p.url()).pathname}: ${String(e)}`));
      await open(p, "/me/events");
      const card = p.locator("article", { hasText: B_NAME });
      note(`event cards for B: ${await card.count()}`);
      // A season the list folds away is opened, as a member would open it.
      if (!(await card.first().isVisible())) {
        const fold = p.locator("details", { has: card.first() }).locator("summary");
        note(`B's card is in a folded group: ${(await fold.innerText().catch(() => "?")).replace(/\s+/g, " ")}`);
        await fold.click();
      }
      const btns = card.first().locator("form button[type=submit]");
      note(`buttons on B's card: ${JSON.stringify(await btns.allInnerTexts())}`);
      await btns.first().click();
      await p.waitForURL((u) => !u.pathname.startsWith("/me/events"), { timeout: 20_000 }).catch(() => {});
      await p.waitForLoadState("networkidle");
      const cookies = (await phone.cookies()).map((c) => c.name);
      note(`after open: ${new URL(p.url()).pathname} cookies=${cookies.join(",")} heading=${(await p.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 160)}`);
      await read(p, "/me/board", "faye-board-b", 2500);
      const total = p.getByRole("heading", { name: "Total over 2 rounds" });
      note((await total.count()) ? "pair total on the member's phone" : "NO PAIR TOTAL");
      const tableWide = await p.evaluate(() => {
        const t = [...document.querySelectorAll("h2")].find((h) => h.textContent?.includes("Total over"))?.parentElement?.querySelector("table");
        return t ? `${Math.round(t.getBoundingClientRect().width)}/${window.innerWidth}` : "none";
      });
      note(`pair table width/viewport: ${tableWide}`);
      await phone.close();
    });
  }

  appendFileSync(LOG(), `\n# page errors: ${errors.length}\n${errors.join("\n")}\n`);
  void roundCards;
  void rng;
  void card;
  void readFileSync;
});
