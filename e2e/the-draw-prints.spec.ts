import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn } from "./rounds-fixture";
import { buildBracket } from "../src/lib/domain/bracket";
import type { Player as DomainPlayer } from "../src/lib/domain/types";

/**
 * THE DRAW PRINTS: A SHEET A QUARTER, AND THE FINALS (the panel, 2026-10-23,
 * part c). A knockout of 129, part played, printed from the secretary's
 * drawing and from the club's public board:
 *
 *   - "Print the draw" mounts the sheets and marks the page; under print media
 *     the app's own chrome is gone and only the sheets show;
 *   - Chromium's PDF of it is FIVE A4 landscape pages — Quarter 1 to 4 and the
 *     Finals — counted in the PDF itself, "Printed on" on each;
 *   - a result line under every tie still to play, none under a played one.
 *
 * Its own club (`zz-bracket-print-<project>`), dropped in a `finally`. PDFs are
 * Chromium's alone, so the PDF half runs on Chromium projects; WebKit is not run.
 */

const FIRST = ["Alder", "Briony", "Caspian", "Delphine", "Ewan", "Fenella", "Gwendolyn", "Honor", "Ivo", "Juniper", "Kester", "Cressida", "Alasdair"];
const LAST = ["Ashgrove", "Bramwell", "Cobbledene", "Elphinstone", "Fernsby", "Gorsefield", "Hazelrigg", "Sandilands", "Larkworthy", "Wedderburn"];
const N = 129;

test.describe.configure({ timeout: 240_000 });
test.afterAll(async () => {
  await prisma.$disconnect();
});

async function open(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.locator("h1").first()).toBeVisible();
}

/** Pages in a PDF, counted off the PDF: each page object is `/Type /Page` (not `/Pages`). */
function pdfPages(pdf: Buffer): { count: number; boxes: string[] } {
  const text = pdf.toString("latin1");
  const count = (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  const boxes = [...text.matchAll(/\/MediaBox\s*\[\s*([\d.\s]+)\]/g)].map((m) => m[1].trim().replace(/\s+/g, " "));
  return { count, boxes };
}

async function printAndRead(page: Page, where: string, project: string) {
  await page.getByRole("button", { name: "Print the draw" }).first().click();
  await expect(page.locator("body")).toHaveClass(/printing-draw/);
  const sheets = page.locator(".bracket-print .bracket-print-page");
  await expect(sheets).toHaveCount(5);
  expect(await sheets.evaluateAll((els) => els.map((e) => e.getAttribute("data-print-section")))).toEqual(["q1", "q2", "q3", "q4", "finals"]);
  await page.emulateMedia({ media: "print" });
  // Only the sheets print: the app's own page is not displayed.
  await expect(page.locator(".bracket-print")).toBeVisible();
  await expect(page.locator(".bracket-drawing").first()).toBeHidden();
  for (const sheet of await sheets.all()) await expect(sheet).toContainText("Printed on");
  // A result line under each tie still to play in Quarter 1, none under a played one.
  const q1 = page.locator('.bracket-print-page[data-print-section="q1"]');
  const ties = q1.locator(".bracket-print-tie");
  const played = await ties.evaluateAll((els) => els.filter((e) => e.textContent?.includes("✓")).length);
  expect(played, `${where}: no played tie on the Quarter 1 sheet`).toBeGreaterThan(0);
  expect(await q1.locator(".bracket-print-result").count(), `${where}: result lines`).toBe((await ties.count()) - played);
  const dir = process.env.BRACKET_CAPTURE;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `print-${where}-${project}.png`) });
  }
  if (page.context().browser()?.browserType().name() === "chromium") {
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    if (dir) writeFileSync(join(dir, `print-${where}-${project}.pdf`), pdf);
    const { count, boxes } = pdfPages(pdf);
    expect(count, `${where}: the PDF is ${count} pages`).toBe(5);
    // A4 landscape is 842 x 595 points.
    for (const b of boxes) {
      const [, , w, h] = b.split(" ").map(Number);
      expect(Math.round(w), `${where}: a page ${w} wide`).toBe(842);
      expect(Math.round(h), `${where}: a page ${h} tall`).toBe(595);
    }
  }
  await page.emulateMedia({ media: "screen" });
}

test("a knockout of 129 prints a sheet a quarter and one for the Finals", async ({ page, browser, baseURL }, testInfo) => {
  const project = testInfo.project.name;
  const mark = `zz-bracket-print-${project}`;
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const club = await makeClub(mark);
  try {
    const { event } = await makeEvent(club, "Club Knockout", {
      status: "live",
      stages: [{ type: "Bracket Stage", format: "Match Play", scoringBasis: "gross" }],
      players: 0,
      event: { shape: "knockout", bracketMode: "single", qualifyMode: "overall", qualifyOverall: N, leaderboardVisibility: "public" },
    });
    const players: DomainPlayer[] = [];
    for (let i = 0; i < N; i += 1) {
      const p = await prisma.player.create({
        data: {
          eventId: event.id,
          name: `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`,
          email: `${mark}-p${i}@example.invalid`,
          handicap: 2 + i * 0.2,
          seed: i + 1,
          status: "confirmed",
        },
      });
      players.push({ id: p.id, name: p.name, handicap: p.handicap, seed: p.seed });
    }
    // The preliminary tie and the first eight ties of Round 1, played.
    const winners: Record<string, string> = { "winners-0-1": players[128].id };
    let view = buildBracket("winners", players, winners);
    for (const m of view.rounds[1].matches.slice(0, 8)) winners[m.key] = m.a.playerId!;
    view = buildBracket("winners", players, winners);
    await prisma.bracketWinner.createMany({ data: Object.entries(winners).map(([key, winnerId]) => ({ eventId: event.id, key, winnerId, result: "2&1" })) });
    // The print dialog is not a page; the press reaches it and nothing more.
    await page.addInitScript(() => {
      window.print = () => {};
    });
    await signIn(page.context(), baseURL!, club, event.id);

    await test.step("from the secretary's drawing", async () => {
      await open(page, "/bracket?view=draw");
      await printAndRead(page, "secretary", project);
    });

    await test.step("from the public board, signed out", async () => {
      const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
      await ctx.addInitScript(() => {
        window.print = () => {};
      });
      const pub = await ctx.newPage();
      watchPageErrors(pub, errors, "public");
      await open(pub, `/live/${event.shareToken}`);
      await printAndRead(pub, "public", project);
      await ctx.close();
    });
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
