import { test, expect, type Page, type BrowserContext } from "../coverage";
import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { seed, memberSession, eventFacts, rng, card, MARK, COURSE, COURSE_CITY } from "./kit.mjs";

/**
 * SCENARIO — tournament G: the Eagle club's Thursday Stableford League. The
 * whole roster, three weekly net Stableford rounds, cards imported weekly and
 * one member's typed on her phone each week — and UNEVEN ATTENDANCE: the
 * twenty best players miss week 2. CLAUDE.md: a points board over one round
 * cannot show a per-hole ranking error; it takes a player who misses a week
 * and scores best per hole. Kept in the dev database.
 */
const PHASE = process.env.PHASE ?? "G1";
const OUT = process.env.PROBE_DIR!;
const LOG = () => join(OUT, `five-${PHASE}.txt`);
export const G_NAME = `${MARK} Thursday League${process.env.RUN ? ` ${process.env.RUN}` : ""}`;
const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const ABSENT = 20;

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

/** Who misses week 2: the twenty lowest handicaps, the field's best per hole. */
function absentees(players: { id: string; handicap: number; status: string }[]) {
  return new Set(
    players
      .filter((p) => p.status === "confirmed")
      .sort((a, b) => a.handicap - b.handicap)
      .slice(0, ABSENT)
      .map((p) => p.id),
  );
}

test("five G", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== (process.env.PROJECT ?? "desktop"), "one project");
  test.setTimeout(Number(process.env.PHASE_TIMEOUT ?? 900_000));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));
  const s = await seed();
  await as(context, baseURL!, s.club);
  if (await eventFacts(G_NAME)) {
    await open(page, "/tournaments");
    const manage = page.getByRole("button", { name: `Manage ${G_NAME}` });
    if (await manage.count()) {
      await manage.first().click();
      await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    }
  }

  if (PHASE === "G1") {
    await test.step("the secretary creates the Thursday League", async () => {
      if (await eventFacts(G_NAME)) return note("this run's tournament already exists — resuming");
      await open(page, "/tournaments");
      await page.getByLabel("Create a new tournament").fill(G_NAME);
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
      if ((await eventFacts(G_NAME))!.players.length >= 120) return note("field already in — resuming");
      await open(page, "/registration");
      const picker = page.locator(".card", { hasText: "Add from the club roster" }).first();
      const open1 = picker.getByRole("button", { name: /Add from the club roster/ });
      if (await open1.count()) await open1.click().catch(() => {});
      await page.getByRole("checkbox", { name: /^Select all/ }).first().check();
      await page.getByRole("button", { name: /^Add \d+ members? to / }).click();
      await page.waitForTimeout(5000);
      note(`field: ${(await eventFacts(G_NAME))!.players.filter((p) => p.status === "confirmed").length} confirmed`);
    });

    await test.step("three weekly Stableford rounds", async () => {
      if ((await eventFacts(G_NAME))!.stages.length >= 3) return note("rounds already in — resuming");
      await open(page, "/stages");
      const stroke = page.getByRole("button", { name: /^Stroke play round/ });
      if ((await stroke.count()) === 0) await page.getByRole("button", { name: /^Add a round/ }).click();
      await stroke.click();
      await page.getByLabel("Format for every round added").selectOption("Stableford");
      await page.getByLabel("How many rounds to add").fill("3");
      await page.getByLabel("Date the first round is played").fill(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
      await page.getByLabel("How often the rounds repeat").selectOption("7").catch(async () => {
        await page.getByLabel("How often the rounds repeat").selectOption({ index: 1 });
      });
      await page.getByRole("button", { name: /^Add (3 )?stroke play rounds?/ }).click();
      await page.waitForTimeout(3000);
      await read(page, "/stages", "stages", 2500);
      note(`rounds: ${(await eventFacts(G_NAME))!.stages.length}`);
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

  for (const w of [1, 2, 3]) {
    if (PHASE !== `G${w + 1}`) continue;
    const facts = (await eventFacts(G_NAME))!;
    const round = facts.stages[w - 1];
    const out = w === 2 ? absentees(facts.players) : new Set<string>();
    const field = facts.players.filter((p) => p.status === "confirmed" && !out.has(p.id));
    const phoneName = field[w * 7 % field.length];
    const r = rng(100 + w);
    await test.step(`week ${w}: the draw goes out`, async () => {
      // A league publishes each week's draw — the field's cue that the week is on.
      await open(page, `/foursomes?round=${round.id}`);
      const redraw = page.getByRole("button", { name: /Re-draw this sheet/ });
      if (await redraw.count()) return note(`week ${w}: sheet already out`);
      await page.getByRole("button", { name: "Random", exact: true }).click();
      await page.locator("label.seg-opt", { hasText: /^\s*4\s*$/ }).click();
      await page.getByLabel("First tee").fill("17:00");
      await page.getByRole("button", { name: /^Save & publish/ }).click();
      await page.getByRole("button", { name: "Publish the tee sheet" }).click();
      await page.waitForTimeout(3000);
      // With this week's draw out, last week asks to be closed if it is over.
      await open(page, "/dashboard");
      const ready = page.getByRole("region", { name: "The round is ready to close" });
      if (await ready.count()) {
        note(`week ${w}: dashboard asks — ${(await ready.innerText()).replace(/\s+/g, " ").slice(0, 260)}`);
        await ready.getByRole("button", { name: /^Close / }).first().click();
        await ready.getByRole("button", { name: /Close the round/ }).click();
        await page.waitForTimeout(3000);
      } else note(`week ${w}: nothing to close`);
    });
    await test.step(`week ${w}: ${phoneName.name} keeps her own card on her phone`, async () => {
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      await phone.addCookies([{ name: "ng_session", value: await memberSession(phoneName.email, phoneName.name), url: baseURL! }]);
      const p = await phone.newPage();
      p.on("pageerror", (e) => errors.push(`member ${new URL(p.url()).pathname}: ${String(e)}`));
      // She is in several of the club's live events: she opens this one first.
      await open(p, "/me/events");
      const gCard = p.locator("article", { hasText: G_NAME });
      note(`week ${w}: ${phoneName.name}'s events list holds the league: ${await gCard.count()}; buttons ${JSON.stringify(await gCard.first().locator("button").allInnerTexts().catch(() => []))}`);
      await gCard.first().locator("form button[type=submit]").first().click();
      await p.waitForURL((u) => !u.pathname.startsWith("/me/events"), { timeout: 20_000 }).catch(() => {});
      await p.waitForLoadState("networkidle");
      // Her own card, hole by hole, the way a member keeps it on the course.
      await open(p, "/me/card");
      const strokes = card(Math.round((phoneName.handicap * 128) / 113 - 0.2), r);
      const opens = (await p.locator("main").innerText()).replace(/\s+/g, " ");
      note(`week ${w}: her card opens: ${opens.slice(0, 220)}`);
      if (!opens.startsWith(`Round ${w} `)) note(`WRONG ROUND — week ${w}'s member was handed another round's card`);
      for (let h = 1; h <= 18; h += 1) {
        await p.getByRole("button", { name: new RegExp(`^Hole ${h},`) }).click();
        await p.getByRole("textbox", { name: `Strokes on hole ${h}` }).fill(String(strokes[h - 1]));
        await expect(p.getByRole("button", { name: `Hole ${h}, not scored` })).toHaveCount(0);
      }
      await p.waitForTimeout(1500);
      await open(p, "/me/card");
      const certify = p.getByRole("button", { name: /Certify my card/ });
      if (await certify.count()) {
        await certify.click();
        await p.waitForTimeout(2000);
      }
      const after = (await p.locator("main").innerText()).replace(/\s+/g, " ");
      note(`week ${w}: her card after 18: ${after.slice(0, 260)}`);
      await read(p, "/me/board", `member-board-w${w}`, 900);
      await phone.close();
    });
    await test.step(`week ${w}: the secretary imports the rest${w === 2 ? `, ${ABSENT} away` : ""}`, async () => {
      const rows = field
        .filter((p) => p.id !== phoneName.id)
        .map((p) => `${p.name},${card(Math.round((p.handicap * 128) / 113 - 0.2), r).join(",")}`);
      const csv = ["Player," + Array.from({ length: 18 }, (_, i) => i + 1).join(","), ...rows].join("\n");
      await open(page, `/entry?round=${round.id}`);
      await page.getByRole("button", { name: /Import scores/ }).click();
      await page.locator("textarea").first().fill(csv);
      await page.waitForTimeout(800);
      const go = page.getByRole("button", { name: /^Import \d+ rows?/ });
      const label = (await go.textContent())?.trim() ?? "";
      note(`week ${w}: ${label} (sent ${rows.length})`);
      if (label !== `Import ${rows.length} rows`) note("IMPORT SHORT");
      await go.click();
      await expect(page.getByText(/Imported \d+ row/)).toBeVisible({ timeout: 120_000 });
    });
    await test.step(`week ${w}: approve, close`, async () => {
      await open(page, `/entry?round=${round.id}`);
      const clean = page.getByRole("button", { name: /^Approve \d+ clean card/ });
      if ((await clean.count()) && (await clean.isEnabled())) {
        note(`week ${w}: ${(await clean.textContent())?.trim()}`);
        await clean.click();
        await page.waitForTimeout(3000);
      }
      await read(page, "/dashboard", `dashboard-w${w}`, 2500);
      const ready = page.getByRole("region", { name: "The round is ready to close" });
      note(`week ${w}: ready to close: ${await ready.count()}`);
      if (await ready.count()) {
        await ready.getByRole("button", { name: /^Close / }).first().click();
        await ready.getByRole("button", { name: /Close the round/ }).click();
        await page.waitForTimeout(3000);
      }
      await read(page, "/leaderboard", `board-after-w${w}`, 2000);
    });
  }

  if (PHASE === "G5") {
    const facts = (await eventFacts(G_NAME))!;
    const out = absentees(facts.players);
    const outNames = new Set(facts.players.filter((p) => out.has(p.id)).map((p) => p.name));
    await test.step("the season table reads down, and adds across", async () => {
      await read(page, "/leaderboard", "board-season", 3500);
      const head = (await page.locator("table thead tr").first().locator("th").allInnerTexts()).map((t) => t.trim());
      note(`columns: ${head.join(" | ")}`);
      const rows = await page.locator("table").first().locator("tbody tr").evaluateAll((trs) =>
        trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => (td as HTMLElement).innerText.trim())),
      );
      // Read by ROW, the last figure on each (CLAUDE.md: a points board's
      // position is a bare integer too).
      const lastFig = (cells: string[]) => {
        for (let i = cells.length - 1; i >= 0; i -= 1) {
          const n = Number(cells[i].replace(/[^\d-]/g, ""));
          if (cells[i] && /\d/.test(cells[i]) && Number.isFinite(n)) return n;
        }
        return NaN;
      };
      const figs = rows.map(lastFig).filter((n) => Number.isFinite(n));
      const unsorted = figs.findIndex((n, i) => i > 0 && n > figs[i - 1]);
      note(`rows ${rows.length}; first figures ${figs.slice(0, 8).join(", ")}; ${unsorted < 0 ? "reads down in order" : `UNSORTED at row ${unsorted + 1}`}`);
      // Where an absentee sits: they played two weeks of three.
      const firstOut = rows.findIndex((cells) => cells.some((c) => outNames.has(c.split("\n")[0])));
      note(`first week-2 absentee at row ${firstOut + 1}: ${rows[firstOut]?.join(" / ").slice(0, 200)}`);
      // She played today's round like everybody else: her THRU is today's, not
      // the season's (fixed 2026-10-10 — a nine-hole league read "18").
      const thruAt = head.findIndex((h) => h.trim().toLowerCase() === "thru");
      if (thruAt >= 0 && firstOut >= 0 && rows[firstOut][thruAt] !== rows[0][thruAt]) {
        note(`ABSENTEE THRU WRONG — ${rows[firstOut][thruAt]} against the leader's ${rows[0][thruAt]}`);
      }
      note(`top three: ${rows.slice(0, 3).map((c) => c.join(" / ").slice(0, 160)).join("  ||  ")}`);
    });
    await test.step("complete, and the public board", async () => {
      if ((await eventFacts(G_NAME))!.status !== "completed") {
        // Every round signed off first: the result is not settled until it is.
        for (const st of facts.stages) {
          await open(page, `/entry?round=${st.id}`);
          const clean = page.getByRole("button", { name: /^Approve \d+ clean card/ });
          if ((await clean.count()) && (await clean.isEnabled())) {
            await clean.click();
            await page.waitForTimeout(2500);
          }
          const anyway = page.locator(".card", { hasText: "Approve this round" }).first().getByRole("button", { name: "Approve anyway" });
          for (let left = await anyway.count(); left > 0; left -= 1) {
            await anyway.first().click();
            await expect(anyway).toHaveCount(left - 1, { timeout: 20_000 });
          }
        }
        await open(page, "/dashboard");
        await page.getByRole("button", { name: "Complete tournament" }).first().click();
        await page.getByRole("alertdialog").getByRole("button", { name: "Complete tournament" }).click();
        await expect.poll(async () => (await eventFacts(G_NAME))!.status, { timeout: 20_000 }).toBe("completed");
      }
      await read(page, `/live/${facts.shareToken}`, "live-final", 2500);
      await read(page, "/reports", "reports", 2000);
      const who = facts.players.find((p) => out.has(p.id))!;
      const phone = await context.browser()!.newContext({ viewport: { width: 393, height: 852 }, baseURL });
      await phone.addCookies([{ name: "ng_session", value: await memberSession(who.email, who.name), url: baseURL! }]);
      const p = await phone.newPage();
      p.on("pageerror", (e) => errors.push(`absentee ${new URL(p.url()).pathname}: ${String(e)}`));
      await open(p, "/me/events");
      const card = p.locator("article", { hasText: G_NAME });
      await card.first().locator("form button[type=submit]").first().click();
      await p.waitForURL((u) => !u.pathname.startsWith("/me/events"), { timeout: 20_000 }).catch(() => {});
      await read(p, "/me/board", "absentee-board", 1500);
      await read(p, "/me", "absentee-today", 1200);
      await phone.close();
    });
  }

  appendFileSync(LOG(), `\n# page errors: ${errors.length}\n${errors.join("\n")}\n`);
});
