import { test, expect, type Page, type BrowserContext } from "../coverage";
import { appendFileSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { seed, memberSession, eventFacts, rng, MARK, COURSE, COURSE_CITY } from "./kit.mjs";

/**
 * SCENARIO — tournament K: the Eagle club's Winter Match Play League. The
 * whole roster in thirty flights of four, everyone plays everyone in their
 * flight over three rounds, results typed up by the secretary and imported as
 * "final results only". The check is arithmetic the app did not do: each
 * player's won / halved / lost and points, added up from the results this
 * probe fed in, against the table the app shows. Kept in the dev database.
 */
const PHASE = process.env.PHASE ?? "K1";
const OUT = process.env.PROBE_DIR!;
const LOG = () => join(OUT, `five-${PHASE}.txt`);
export const K_NAME = `${MARK} Winter Match Play${process.env.RUN ? ` ${process.env.RUN}` : ""}`;
const FED = () => join(OUT, "fed-results.json");

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

/** Read-only: a round's fixtures, by player name. */
async function fixtures(stageId: string) {
  const prisma = new PrismaClient();
  try {
    const ms = await prisma.match.findMany({ where: { stageId }, select: { playerAId: true, playerBId: true, groupId: true } });
    const ids = [...new Set(ms.flatMap((m) => [m.playerAId, m.playerBId]))].filter(Boolean) as string[];
    const names = new Map((await prisma.player.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    return ms.map((m) => ({ a: names.get(m.playerAId ?? "") ?? "", b: names.get(m.playerBId ?? "") ?? "", groupId: m.groupId }));
  } finally {
    await prisma.$disconnect();
  }
}

type Fed = { a: string; b: string; winner: "A" | "B" | "H" };

test("five K", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== (process.env.PROJECT ?? "desktop"), "one project");
  test.setTimeout(Number(process.env.PHASE_TIMEOUT ?? 900_000));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));
  const s = await seed();
  await as(context, baseURL!, s.club);
  if (await eventFacts(K_NAME)) {
    await open(page, "/tournaments");
    const manage = page.getByRole("button", { name: `Manage ${K_NAME}` });
    if (await manage.count()) {
      await manage.first().click();
      await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    }
  }

  if (PHASE === "K1") {
    await test.step("the secretary creates the Winter Match Play League", async () => {
      if (await eventFacts(K_NAME)) return note("already exists — resuming");
      await open(page, "/tournaments");
      await page.getByLabel("Create a new tournament").fill(K_NAME);
      const shape = page.getByLabel("How is it played?");
      if (await shape.count()) await shape.selectOption({ label: "A series of rounds" });
      await page.getByRole("button", { name: /Create tournament/ }).click();
      await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    });
    await test.step("dates and course", async () => {
      await open(page, "/event");
      const first = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      const last = new Date(Date.now() + 16 * 86400000).toISOString().slice(0, 10);
      await page.getByLabel("Tournament dates, first day").fill(first);
      await page.getByLabel("Tournament dates, last day").fill(last);
      const course = page.getByRole("combobox", { name: "Golf course" });
      await course.click();
      await course.fill(COURSE);
      await page.locator('#course-picker-list [role="option"]', { hasText: COURSE_CITY }).first().click();
      const save = page.locator("button.btn-primary", { hasText: /Save event|Adding the course/ });
      if ((await save.count()) && (await save.isEnabled())) {
        await save.click();
        await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 30_000 });
      }
    });
    await test.step("the field: the whole club roster", async () => {
      if ((await eventFacts(K_NAME))!.players.length >= 120) return note("field already in");
      await open(page, "/registration");
      const picker = page.locator(".card", { hasText: "Add from the club roster" }).first();
      const open1 = picker.getByRole("button", { name: /Add from the club roster/ });
      if (await open1.count()) await open1.click().catch(() => {});
      await page.getByRole("checkbox", { name: /^Select all/ }).first().check();
      await page.getByRole("button", { name: /^Add \d+ members? to / }).click();
      await page.waitForTimeout(5000);
    });
    await test.step("three rounds of round-robin match play", async () => {
      if ((await eventFacts(K_NAME))!.stages.length >= 3) return note("rounds already in");
      await open(page, "/stages");
      const rr = page.getByRole("button", { name: /^Round robin/ });
      if ((await rr.count()) === 0) await page.getByRole("button", { name: /^Add a round/ }).click();
      await rr.click();
      const fmt = page.getByLabel("Format for every round added");
      if (await fmt.count()) await fmt.selectOption("Match Play").catch(() => {});
      await page.getByLabel("How many rounds to add").fill("3");
      await page.getByRole("button", { name: /^Add (3 )?round robins?|^Add (3 )?rounds?/ }).click();
      await page.waitForTimeout(3000);
      await read(page, "/stages", "stages", 2200);
      note(`rounds: ${(await eventFacts(K_NAME))!.stages.length}`);
    });
    await test.step("thirty flights of four, and the fixtures drawn", async () => {
      await open(page, "/grouping");
      await page.getByRole("button", { name: /Balanced skills/ }).click();
      await page.locator("label.seg-opt", { hasText: "Set flights" }).click();
      await page.locator("input.input").last().fill("30");
      await page.getByRole("button", { name: /Generate flights/ }).click();
      await page.waitForTimeout(6000);
      const facts = (await eventFacts(K_NAME))!;
      for (const [i, st] of facts.stages.entries()) note(`round ${i + 1}: ${(await fixtures(st.id)).length} fixtures`);
      await read(page, "/grouping", "flights", 1500);
    });
    await test.step("launch", async () => {
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

  for (const w of [1, 2, 3]) {
    if (PHASE !== `K${w + 1}`) continue;
    const facts = (await eventFacts(K_NAME))!;
    const round = facts.stages[w - 1];
    const r = rng(300 + w);
    await test.step(`round ${w}: the secretary imports the results`, async () => {
      const fx = await fixtures(round.id);
      const margins = ["3&2", "2&1", "1 up", "5&4", "4&3"];
      const fed: Fed[] = fx.map((m) => {
        const x = r();
        return { a: m.a, b: m.b, winner: x < 0.14 ? "H" : x < 0.57 ? "A" : "B" };
      });
      const lines = fed.map((m, i) =>
        m.winner === "H" ? `${m.a},${m.b},H,AS` : `${m.a},${m.b},${m.winner === "A" ? m.a : m.b},${margins[i % margins.length]}`,
      );
      const csv = ["Player A,Player B,Winner,Margin", ...lines].join("\n");
      await open(page, `/entry?round=${round.id}`);
      await page.getByRole("button", { name: /Import scores/ }).click();
      await page.getByRole("button", { name: /Final results only/ }).click();
      await page.locator(".card", { hasText: "Import scores from a file" }).locator("textarea").fill(csv);
      await page.waitForTimeout(800);
      const go = page.getByRole("button", { name: /^Import \d+ rows?/ });
      const label = (await go.textContent())?.trim() ?? "";
      note(`round ${w}: ${label} (sent ${lines.length})`);
      if (label !== `Import ${lines.length} rows`) note("IMPORT SHORT");
      await go.click();
      await expect(page.getByText(/Imported \d+ row/)).toBeVisible({ timeout: 120_000 });
      const all: Fed[] = existsSync(FED()) ? JSON.parse(readFileSync(FED(), "utf8")) : [];
      writeFileSync(FED(), JSON.stringify([...all.filter((x: Fed & { w?: number }) => x.w !== w), ...fed.map((m) => ({ ...m, w }))]));
    });
    await test.step(`round ${w}: the committee accepts the round's results in one go`, async () => {
      await open(page, `/entry?round=${round.id}`);
      const awaiting = page.getByRole("button", { name: /^Awaiting approval/ }).first();
      if (await awaiting.count()) await awaiting.click();
      const approve = page.getByRole("button", { name: /^Approve \d+ shown results?/ });
      const offered = (await approve.count()) > 0;
      note(`round ${w}: ${offered ? (await approve.textContent())?.trim() : "NO BULK APPROVE OFFERED"}`);
      if (offered) {
        await approve.click();
        await page.waitForTimeout(5000);
      }
      const prisma = new PrismaClient();
      const left = await prisma.match.count({ where: { stageId: round.id, scoreStatus: "pending" } });
      await prisma.$disconnect();
      note(`round ${w}: results still awaiting approval: ${left}`);
    });
    await test.step(`round ${w}: what the secretary and one member read`, async () => {
      await read(page, `/entry?round=${round.id}`, `entry-r${w}`, 1800);
      await read(page, "/dashboard", `dashboard-r${w}`, 2200);
      const who = facts.players.filter((p) => p.status === "confirmed")[w * 9];
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
      const p = await phone.newPage();
      p.on("pageerror", (e) => errors.push(`member ${new URL(p.url()).pathname}: ${String(e)}`));
      await open(p, "/me/events");
      const ev = p.locator("article", { hasText: K_NAME });
      if (!(await ev.first().isVisible())) await p.locator("details", { has: ev.first() }).locator("summary").click();
      await ev.first().locator("form button[type=submit]").first().click();
      await p.waitForURL((u) => !u.pathname.startsWith("/me/events"), { timeout: 20_000 }).catch(() => {});
      await read(p, "/me", `member-today-r${w}`, 1100);
      await phone.close();
    });
  }

  if (PHASE === "K5") {
    const fed: (Fed & { w: number })[] = JSON.parse(readFileSync(FED(), "utf8"));
    await test.step("every player's table line is the results added up", async () => {
      // Won / halved / lost, from what was fed in — arithmetic the app did not do.
      const want = new Map<string, { w: number; h: number; l: number }>();
      const bump = (n: string, k: "w" | "h" | "l") => {
        const row = want.get(n) ?? { w: 0, h: 0, l: 0 };
        row[k] += 1;
        want.set(n, row);
      };
      // Each round robin is its own contest unless the organizer carries points
      // forward (nobody answered that here), so the table on the board is the
      // LAST round's — and is checked against that round's results alone.
      for (const m of fed.filter((x) => x.w === 3)) {
        if (m.winner === "H") {
          bump(m.a, "h");
          bump(m.b, "h");
        } else {
          bump(m.winner === "A" ? m.a : m.b, "w");
          bump(m.winner === "A" ? m.b : m.a, "l");
        }
      }
      await read(page, "/leaderboard", "board", 3000);
      const tables = page.locator("table");
      const nTables = await tables.count();
      const head = (await tables.first().locator("thead tr").first().locator("th").allInnerTexts()).map((t) => t.trim().toLowerCase());
      note(`tables ${nTables}; columns: ${head.join(" | ")}`);
      const col = (re: RegExp) => head.findIndex((h) => re.test(h));
      const pi = col(/player|name/);
      const wi = col(/^w$|won/);
      const hi = col(/^½$|^h$|halv|tied|^t$/);
      const li = col(/^l$|lost/);
      const ti = col(/pts|points/);
      let checked = 0;
      let wrong = 0;
      const ptsDown: number[] = [];
      for (let t = 0; t < Math.min(nTables, 1); t += 1) {
        const rows = await tables.nth(t).locator("tbody tr").evaluateAll((trs) =>
          trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => (td as HTMLElement).innerText.trim())),
        );
        for (const cells of rows) {
          const name = (cells[pi] ?? "").split("\n")[0].trim();
          const e = want.get(name);
          if (!e) continue;
          checked += 1;
          const got = { w: Number(cells[wi]), h: Number(cells[hi]), l: Number(cells[li]), pts: Number(cells[ti]) };
          // Won / halved / lost only: points carry a hole-difference share the
          // club sets, so they are checked for ORDER below, not for value.
          const bad = (wi >= 0 && got.w !== e.w) || (hi >= 0 && got.h !== e.h) || (li >= 0 && got.l !== e.l);
          if (bad) {
            wrong += 1;
            if (wrong <= 4) note(`${name}: shown W${got.w} H${got.h} L${got.l}; fed W${e.w} H${e.h} L${e.l}`);
          }
          ptsDown.push(got.pts);
        }
      }
      const outOfOrder = ptsDown.findIndex((p, i) => i > 0 && p > ptsDown[i - 1]);
      note(`table lines checked ${checked} of ${want.size}: ${wrong} wrong; points ${outOfOrder < 0 ? "read down in order" : `OUT OF ORDER at row ${outOfOrder + 1}`}`);
      if (outOfOrder >= 0) note("LEAGUE TABLE WRONG — the table is not in points order");
      if (checked < 100) note("LEAGUE TABLE WRONG — too few lines could be checked");
      if (wrong > 0) note("LEAGUE TABLE WRONG — the table is not the results added up");
    });
    await test.step("complete", async () => {
      if ((await eventFacts(K_NAME))!.status !== "completed") {
        await open(page, "/dashboard");
        const done = page.getByRole("button", { name: "Complete tournament" }).first();
        note(`Complete enabled: ${await done.isEnabled()}`);
        if (await done.isEnabled()) {
          await done.click();
          await page.getByRole("alertdialog").getByRole("button", { name: "Complete tournament" }).click();
          await expect.poll(async () => (await eventFacts(K_NAME))!.status, { timeout: 20_000 }).toBe("completed");
        } else await read(page, "/dashboard", "dashboard-not-ready", 2500);
      }
    });
  }

  appendFileSync(LOG(), `\n# page errors: ${errors.length}\n${errors.join("\n")}\n`);
});
