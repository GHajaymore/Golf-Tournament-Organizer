import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { seed, teardown } from "../scripts/seed-club.mjs";

/**
 * THE ORGANIZER'S BOARD AND THE PUBLIC BOARD GIVE EVERY PLAYER THE SAME PLACE.
 *
 * Step 9 of `docs/one-rule-one-place.md`: two screens never give different
 * answers. The class no screen test can see — every screen right on its own
 * terms, and a member reading T1 on the link the club sent while the secretary
 * reads 2nd. On 2026-10-14 the team boards and the Modified Stableford board
 * were moved to countback and their places decided once
 * (`TeamStanding.place`, `ModStablefordRow.place`); this holds the screens a
 * club actually compares to that, on every round of the seeded club that has a
 * public board and results in it.
 *
 * For each such round, asked of both by `?round=`:
 *
 *   the console's board, as the secretary     the last table with a # column
 *   the public link, signed out               its list (`li[data-flip-key]`) or
 *                                             its table, for a team round
 *
 * every name on both carries the same place text — "T1" against "T1", "3"
 * against "3", "–" against "–".
 *
 * WHAT IT CANNOT SEE: a player's own board on their phone (`/me/board`, which
 * prints the same component as the public link), a tournament whose board is
 * not public, and a knockout or cup, whose results are a draw, not places. It
 * reads; it changes nothing.
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

type Club = Awaited<ReturnType<typeof seed>>;
let club: Club;
test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== "desktop") return;
  club = await seed();
});
test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name === "desktop") await teardown();
  await prisma.$disconnect();
});

/** The places a table with a # column prints: the first line of the name cell → the # cell. */
async function tablePlaces(page: Page): Promise<Map<string, string> | null> {
  const tables = page.locator("main table", { has: page.locator("thead th", { hasText: /^#$/ }) });
  const n = await tables.count();
  if (n === 0) return null;
  // The round's own table is the last: a total over several rounds comes first.
  const table = tables.nth(n - 1);
  const heads = (await table.locator("thead th").allInnerTexts()).map((h) => h.trim().toLowerCase());
  const at = heads.findIndex((h) => h === "#");
  const nameAt = heads.findIndex((h) => h === "player" || h === "side" || h === "team" || h === "name");
  if (at < 0 || nameAt < 0) return null;
  const rows = await table.locator("tbody tr").evaluateAll((trs) =>
    trs.map((tr) => [...tr.querySelectorAll("td, th")].map((td) => ((td as HTMLElement).innerText ?? "").trim().split("\n")[0].trim())),
  );
  const out = new Map<string, string>();
  for (const r of rows) if (r[nameAt]) out.set(r[nameAt], r[at] ?? "");
  return out;
}

/** The places the public list prints: each row's name → the place in front of it. */
async function listPlaces(page: Page): Promise<Map<string, string> | null> {
  const rows = page.locator("li[data-flip-key]");
  if ((await rows.count()) === 0) return null;
  const pairs = await rows.evaluateAll((lis) =>
    lis.map((li) => {
      const spans = li.querySelectorAll(":scope > div > span");
      const place = ((spans[0] as HTMLElement | undefined)?.innerText ?? "").trim();
      const name = ((spans[1]?.querySelector("span") as HTMLElement | null)?.innerText ?? "").trim();
      return [name, place] as const;
    }),
  );
  return new Map(pairs.filter(([name]) => name));
}

const norm = (p: string) => (p === "-" || p === "—" || p === "" ? "–" : p);

test("every player and side has the same place on the secretary's board and on the public link", async ({ page, context, browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one size: a place does not depend on the width of the screen");
  test.setTimeout(420_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  await context.addCookies([{ name: "ng_session", value: club.organizer.session, url: baseURL! }]);
  const visitor = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const outside = await visitor.newPage();
  watchPageErrors(outside, errors, "visitor");

  const disagree: string[] = [];
  const said: string[] = [];
  let compared = 0;
  let rounds = 0;
  let shared = 0;

  try {
    for (const ev of club.events) {
      const event = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
      if (event.leaderboardVisibility !== "public") continue;
      const stages = await prisma.stage.findMany({ where: { eventId: ev.id }, orderBy: { position: "asc" } });
      await context.addCookies([{ name: "ng_active_event", value: sign(ev.id), url: baseURL! }]);
      for (const stage of stages) {
        const cards =
          (await prisma.scorecard.count({ where: { stageId: stage.id } })) + (await prisma.teamScorecard.count({ where: { stageId: stage.id } }));
        if (cards === 0) continue;

        await page.goto(`/leaderboard?round=${stage.id}&bust=${Date.now()}`);
        await page.waitForLoadState("networkidle").catch(() => {});
        const inside = await tablePlaces(page);

        await outside.goto(`/live/${event.shareToken}?round=${stage.id}&bust=${Date.now()}`);
        await outside.waitForLoadState("networkidle").catch(() => {});
        const shown = (await listPlaces(outside)) ?? (await tablePlaces(outside));

        const label = `${ev.slug} ${stage.description || `round ${stage.position + 1}`} (${stage.format})`;
        if (!inside || !shown) {
          said.push(`${label}: NOT COMPARED — ${!inside ? "no table with places on the console" : "no places on the public link"}`);
          continue;
        }
        rounds += 1;
        for (const [name, place] of inside) {
          const there = shown.get(name);
          if (there === undefined) continue;
          compared += 1;
          if (norm(place).startsWith("T")) shared += 1;
          if (norm(place) !== norm(there)) disagree.push(`${label}: ${name} is ${place} on the console and ${there} on the public link`);
        }
      }
    }
  } finally {
    await visitor.close();
  }

  console.log([`${rounds} rounds compared, ${compared} places, ${shared} of them shared`, ...said].join("\n"));
  // CONTROL: the seeded club has public boards with results, so a comparison of nothing is a broken instrument.
  expect(rounds, "no round was compared — the readers cannot see the boards").toBeGreaterThanOrEqual(3);
  expect(compared, "no place was compared").toBeGreaterThanOrEqual(20);
  expect(disagree, "the same player in two places").toEqual([]);
  expect(errors).toEqual([]);
});
