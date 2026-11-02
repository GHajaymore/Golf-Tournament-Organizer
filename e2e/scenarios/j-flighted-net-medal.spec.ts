import { test, expect, type Page, type BrowserContext } from "../coverage";
import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { seed, eventFacts, rng, card, MARK, COURSE, COURSE_CITY, createTournament, becomesEnabled } from "./kit.mjs";

/**
 * SCENARIO — tournament J: the Eagle club's Flighted Net Medal, tees by
 * flight. One net stroke round, three handicap divisions, and the third
 * division off the RED tees (69.0 / 118) while the rest play White (71.8 /
 * 128). The check is against the Rules of Handicapping, not the app: every
 * row's strokes received (gross − net) must be the Playing Handicap worked out
 * from that player's own tees — Course Handicap = index × slope / 113 +
 * (rating − par), then 95% for individual stroke play. Kept in the dev database.
 */
const PHASE = process.env.PHASE ?? "J1";
const OUT = process.env.PROBE_DIR!;
const LOG = () => join(OUT, `five-${PHASE}.txt`);
export const J_NAME = `${MARK} Flighted Net Medal${process.env.RUN ? ` ${process.env.RUN}` : ""}`;
const RED = { name: "Red", courseRating: 69.0, slopeRating: 118, par: 72 };

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

/** A second rated set on the club's home course — the secretary's "add tees". */
async function redTees(eventName: string) {
  const prisma = new PrismaClient();
  try {
    const ev = await prisma.event.findFirst({ where: { name: eventName }, select: { courseId: true } });
    if (!ev?.courseId) return "";
    const has = await prisma.tee.findFirst({ where: { courseId: ev.courseId, name: RED.name }, select: { id: true } });
    if (has) return has.id;
    return (await prisma.tee.create({ data: { courseId: ev.courseId, ...RED, position: 5 }, select: { id: true } })).id;
  } finally {
    await prisma.$disconnect();
  }
}

/** What the Rules give each player, from their own tees. Read-only. */
async function expectedHandicaps(eventName: string) {
  const prisma = new PrismaClient();
  try {
    const ev = await prisma.event.findFirst({
      where: { name: eventName },
      select: {
        id: true, defaultTeeId: true, teePolicy: true, courseId: true,
        groups: { select: { id: true, name: true, teeId: true } },
        players: { where: { status: "confirmed" }, select: { name: true, handicap: true, groupId: true } },
      },
    });
    const tees = await prisma.tee.findMany({ where: { courseId: ev!.courseId ?? "" }, orderBy: { position: "asc" } });
    const roundTee = tees.find((t) => t.id === ev!.defaultTeeId) ?? tees[0];
    const out = new Map<string, { tee: string; rounded: number; unrounded: number }>();
    for (const p of ev!.players) {
      const g = ev!.groups.find((x) => x.id === p.groupId);
      const tee = tees.find((t) => t.id === g?.teeId) ?? roundTee;
      const raw = (p.handicap * tee.slopeRating) / 113 + (tee.courseRating - tee.par);
      // `unrounded` is the Rule's (6.2a): 95% of the course handicap BEFORE it is rounded, rounded
      // once, a half upwards. `rounded` is what the app did until 2026-10-13, kept so the note
      // below can say which of the two a wrong row followed.
      out.set(p.name, {
        tee: tee.name,
        rounded: Math.round((Math.round(raw + 1e-9) * 95) / 100 + 1e-9),
        unrounded: Math.round((raw * 95) / 100 + 1e-9),
      });
    }
    return { policy: ev!.teePolicy, groups: ev!.groups.map((g) => `${g.name}:${tees.find((t) => t.id === g.teeId)?.name ?? "round's"}`), out };
  } finally {
    await prisma.$disconnect();
  }
}

test("five J", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== (process.env.PROJECT ?? "desktop"), "one project");
  test.setTimeout(Number(process.env.PHASE_TIMEOUT ?? 900_000));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));
  const s = await seed();
  await as(context, baseURL!, s.club);
  if (await eventFacts(J_NAME)) {
    await open(page, "/tournaments");
    const manage = page.getByRole("button", { name: `Manage ${J_NAME}` });
    if (await manage.count()) {
      await manage.first().click();
      await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    }
  }

  if (PHASE === "J1") {
    await test.step("the secretary creates the Flighted Net Medal", async () => {
      if (await eventFacts(J_NAME)) return note("already exists — resuming");
      // From /choose or from Tournaments, whichever this club is offered; and onto the plan a full field needs.
      // This scenario may be the first the club has met: on GitHub each one is given a database of its own.
      await createTournament(page, J_NAME, "A series of rounds");
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
      }
      // The course is stored by the save above, and on a busy machine after it says "Saved".
      // Asked once, straight after, this found no course and so added no Red set (round 2,
      // 2026-10-14) — and the third flight then had no Red tees to be put on. Wait for it.
      await expect
        .poll(async () => !!(await redTees(J_NAME)), { message: "the tournament's course was never stored, so there is nowhere to put a Red set", timeout: 30_000 })
        .toBe(true);
      note("red tees on the home course: yes");
    });
    await test.step("the field: the whole club roster", async () => {
      if ((await eventFacts(J_NAME))!.players.length >= 120) return note("field already in");
      await open(page, "/registration");
      const picker = page.locator(".card", { hasText: "Add from the club roster" }).first();
      const open1 = picker.getByRole("button", { name: /Add from the club roster/ });
      if (await open1.count()) await open1.click().catch(() => {});
      await page.getByRole("checkbox", { name: /^Select all/ }).first().check();
      await page.getByRole("button", { name: /^Add \d+ members? to / }).click();
      await page.waitForTimeout(5000);
    });
    await test.step("one stroke round, on NET", async () => {
      await open(page, "/stages");
      if (!(await page.getByRole("button", { name: /^Round 1 · Stroke Play Round/ }).count())) {
        await page.getByRole("button", { name: /^Stroke play round/ }).click();
        await page.getByLabel("Format for every round added").selectOption("Stroke Play");
        await page.getByRole("button", { name: /^Add (1 )?stroke play rounds?/ }).click();
        await page.waitForTimeout(2500);
      }
      await open(page, "/stages");
      const header = page.getByRole("button", { name: /^Round 1 · Stroke Play Round/ });
      if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
      const customize = page.getByRole("button", { name: /^Customize this round/ }).first();
      if ((await customize.getAttribute("aria-expanded")) !== "true") await customize.click();
      await page.locator("label.seg-opt", { hasText: /^\s*Net\s*$/ }).first().click();
      await page.waitForTimeout(2500);
    });
    await test.step("each flight plays its own tees", async () => {
      await open(page, "/event");
      const flight = page.locator("label", { hasText: "A flight may play its own tees" }).first();
      note(`tee-policy choice offered: ${await flight.count()}`);
      await flight.click();
      const save = page.getByRole("button", { name: /^Save settings/ });
      if ((await save.count()) && (await becomesEnabled(save.first()))) await save.first().click();
      await page.waitForTimeout(2500);
    });
    await test.step("three handicap divisions; the third off the Reds", async () => {
      await open(page, "/grouping");
      if ((await page.getByLabel(/^Tees for /).count()) === 0) {
        await page.getByRole("button", { name: /Handicap divisions/ }).click();
        await page.locator("label.seg-opt", { hasText: "Set flights" }).click();
        await page.locator("input.input").last().fill("3");
        await page.getByRole("button", { name: /Generate flights/ }).click();
        await page.waitForTimeout(3000);
        await open(page, "/grouping");
      }
      const tees = page.getByLabel(/^Tees for /);
      note(`flight tee selects: ${await tees.count()}`);
      await tees.last().selectOption({ label: "Red" });
      await page.waitForTimeout(2500);
      const exp = await expectedHandicaps(J_NAME);
      note(`policy ${exp.policy}; flights ${exp.groups.join(", ")}`);
    });
    await test.step("launch", async () => {
      await open(page, "/dashboard");
      await page.getByRole("button", { name: "Launch tournament" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Launch tournament" }).click();
      await expect(page.getByRole("button", { name: "Complete tournament" })).toBeVisible({ timeout: 30_000 });
    });
  }

  if (PHASE === "J2") {
    const facts = (await eventFacts(J_NAME))!;
    const r1 = facts.stages[0];
    const r = rng(909);
    await test.step("the cards come back and are accepted", async () => {
      const rows = facts.players
        .filter((p) => p.status === "confirmed")
        .map((p) => `${p.name},${card(Math.round((p.handicap * 128) / 113 - 0.2), r).join(",")}`);
      const csv = ["Player," + Array.from({ length: 18 }, (_, i) => i + 1).join(","), ...rows].join("\n");
      await open(page, `/entry?round=${r1.id}`);
      await page.getByRole("button", { name: /Import scores/ }).click();
      await page.locator("textarea").first().fill(csv);
      await page.waitForTimeout(800);
      const go = page.getByRole("button", { name: /^Import \d+ rows?/ });
      note(`${(await go.textContent())?.trim()} (sent ${rows.length})`);
      await go.click();
      await expect(page.getByText(/Imported \d+ row/)).toBeVisible({ timeout: 120_000 });
      await open(page, `/entry?round=${r1.id}`);
      const clean = page.getByRole("button", { name: /^Approve \d+ clean card/ });
      if ((await clean.count()) && (await clean.isEnabled())) {
        await clean.click();
        await page.waitForTimeout(3000);
      }
    });
    await test.step("every player's strokes are their own tees' Playing Handicap", async () => {
      const exp = await expectedHandicaps(J_NAME);
      await read(page, "/leaderboard", "board", 2500);
      const head = (await page.locator("table thead tr").first().locator("th").allInnerTexts()).map((t) => t.trim().toLowerCase());
      note(`columns: ${head.join(" | ")}`);
      const pi = head.findIndex((h) => h.startsWith("player"));
      const gi = head.findIndex((h) => h.startsWith("gross"));
      const ni = head.findIndex((h) => h === "net");
      const rows = await page.locator("table").first().locator("tbody tr").evaluateAll((trs) =>
        trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => (td as HTMLElement).innerText.trim())),
      );
      let checked = 0;
      let asRounded = 0;
      let asUnrounded = 0;
      let neither = 0;
      const byTee: Record<string, number> = {};
      for (const cells of rows) {
        const name = (cells[pi] ?? "").split("\n")[0].trim();
        const e = exp.out.get(name);
        const g = Number(cells[gi]);
        const n = Number(cells[ni]);
        if (!e || !Number.isFinite(g) || !Number.isFinite(n)) continue;
        checked += 1;
        byTee[e.tee] = (byTee[e.tee] ?? 0) + 1;
        const got = g - n;
        if (got === e.rounded) asRounded += 1;
        if (got === e.unrounded) asUnrounded += 1;
        /**
         * THE RULE'S FIGURE, AND ONLY THAT. This accepted either — "Rules give 9 (or 8
         * unrounded)" — and so walked 120 players through a board that was a stroke out
         * for a fifth of them and wrote nothing. A check that accepts two answers has
         * measured that the app is one of two things.
         */
        if (got !== e.unrounded) {
          neither += 1;
          if (neither <= 4) note(`${name} (${e.tee}): received ${got}, the Rules give ${e.unrounded} (rounded first it is ${e.rounded})`);
        }
      }
      note(`checked ${checked} rows — by tee ${JSON.stringify(byTee)}; match rounded-CH ${asRounded}, unrounded-CH ${asUnrounded}, neither ${neither}`);
      if (checked < 100) note("TEE HANDICAP WRONG — too few rows could be checked");
      if (!byTee.Red) note("TEE HANDICAP WRONG — nobody was on the Red tees");
      if (neither > 0) note("TEE HANDICAP WRONG — strokes received do not follow the player's own tees");
    });
  }

  appendFileSync(LOG(), `\n# page errors: ${errors.length}\n${errors.join("\n")}\n`);
});
