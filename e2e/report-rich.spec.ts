import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { MARK } from "./fixture.mjs";
import { seedRich, teardownRich } from "./report-rich-fixture.mjs";

/**
 * THE RICH REPORT'S PICTURES, READ OFF THE PAGE (2026-10-23).
 *
 * A graphic is never its own reader: each is drawn from the same list as the
 * table beside it (`domain/report-graphics.ts`). This opens each fixture's
 * PUBLIC report as a visitor does, reads the picture's own words and the
 * table's rows out of the page, and requires the same names, in the same
 * order, with the same figures. Then the phone rules: nothing scrolls
 * sideways, and every figure in a picture is drawn at 16px or more — the SVG
 * ladder measured as it is scaled onto the screen. Then print: the tables
 * that sit out of sight on a screen are on the paper. Then the share card.
 *
 * What it cannot see: that each figure is the BOARD's — that is
 * `the-rich-report.audit.test.ts`, against the database; and the amounts, which
 * the public copy never carries.
 */

const RUN = `${MARK}-rich`;
type Seeded = Awaited<ReturnType<typeof seedRich>>;
let seeded: Seeded;

test.beforeAll(async () => {
  seeded = await seedRich(RUN);
});
test.afterAll(async () => {
  await teardownRich(RUN);
});

async function open(page: Page, token: string) {
  const res = await page.goto(`/live/${token}/report?bust=${Date.now()}`);
  expect(res?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
}

/** The table inside a figure, row by row, as text. */
const tableRows = (page: Page, kind: string) =>
  page.locator(`[data-graphic=${kind}] table tbody tr`).evaluateAll((rows) =>
    rows.map((r) => [...r.querySelectorAll("td")].map((td) => (td.textContent ?? "").replace(/\s+/g, " ").trim())),
  );

test.describe("each picture says what its table says", () => {
  test("the points ladder: the bars are the table's rows, in its order, with its figures", async ({ page }) => {
    const errors: string[] = [];
    watchPageErrors(page, errors);
    await open(page, seeded.events.stableford.shareToken);
    const bars = await page.locator("[data-graphic=points] .fr-bars li").evaluateAll((lis) =>
      lis.map((li) => [
        li.querySelector(".fr-bar-pl")?.textContent?.trim() ?? "",
        li.querySelector(".fr-bar-nm")?.textContent?.trim() ?? "",
        li.querySelector(".fr-bar-fig")?.textContent?.trim() ?? "",
      ]),
    );
    const rows = await tableRows(page, "points");
    expect(bars.length).toBeGreaterThan(2);
    expect(bars).toEqual(rows);
    // And the bars' lengths run with their figures: a longer bar is never a smaller figure.
    const widths = await page.locator("[data-graphic=points] .fr-bar-track i").evaluateAll((is) => is.map((i) => i.getBoundingClientRect().width));
    for (let i = 1; i < widths.length; i += 1) {
      if (Number(bars[i][2]) < Number(bars[i - 1][2])) expect(widths[i]).toBeLessThan(widths[i - 1]);
    }
    // The leaderboard is the same order again.
    const board = await page
      .locator("section", { has: page.getByRole("heading", { level: 2, name: "The leaderboard", exact: true }) })
      .locator("tbody tr")
      .evaluateAll((trs) => trs.map((tr) => tr.querySelectorAll("td")[1]?.textContent?.trim() ?? ""));
    expect(board.slice(0, rows.length)).toEqual(rows.map((r) => r[1]));
    expect(errors).toEqual([]);
  });

  test("the hole strip: each cell is the table's hole, in hole order, with its figure", async ({ page }) => {
    await open(page, seeded.events.stableford.shareToken);
    const cells = await page.locator("[data-graphic=holes] .fr-holes .fr-hole").evaluateAll((divs) =>
      divs.map((d) => [d.querySelector(".fr-hole-n")?.textContent?.trim() ?? "", d.querySelector("b")?.textContent?.trim() ?? ""]),
    );
    const rows = await tableRows(page, "holes");
    expect(cells).toHaveLength(18);
    expect(cells).toEqual(rows.map((r) => [r[0], r[3]]));
  });

  test("the ladder: the places printed in the drawing are the table's, and the names at both ends", async ({ page }) => {
    await open(page, seeded.events.championship.shareToken);
    const rows = await tableRows(page, "ladder");
    const drawn = await page.locator("[data-graphic=ladder] svg").evaluate((svg) => ({
      names: [...svg.querySelectorAll(".fr-svg-name")].map((t) => t.textContent?.trim() ?? ""),
      places: [...svg.querySelectorAll(".fr-svg-place")].map((t) => t.textContent?.trim() ?? ""),
    }));
    // Every place in the table, and nothing else, is printed in a mark.
    expect([...drawn.places].sort()).toEqual(rows.flatMap((r) => r.slice(1)).filter((p) => p !== "–").sort());
    // Each name twice — once at each end — shortened the same way.
    const short = (n: string) => n.replace(/^(\S+).*\s(\S)\S*$/, "$1 $2.");
    for (const r of rows) expect(drawn.names.filter((n) => n === short(r[0])), r[0]).toHaveLength(2);
  });

  test("the winning card: each cell is the table's hole, score and whose ball", async ({ page }) => {
    await open(page, seeded.events.fourball.shareToken);
    const cells = await page.locator("[data-graphic=side] .fr-holes .fr-hole").evaluateAll((divs) =>
      divs.map((d) => [d.querySelector(".fr-hole-n")?.textContent?.trim() ?? "", d.querySelector("b")?.textContent?.trim() ?? ""]),
    );
    const rows = await tableRows(page, "side");
    expect(cells).toEqual(rows.map((r) => [r[0], r[2]]));
  });

  test("the champion's path and the league's dots", async ({ page }) => {
    await open(page, seeded.events.knockout.shareToken);
    await expect(page.locator("[data-graphic=path] .fr-path li")).toHaveCount(3);
    await expect(page.locator("[data-graphic=path] figcaption")).toContainText("at the 19th");
    await open(page, seeded.events.league.shareToken);
    const dots = await page.locator("[data-graphic=weeks] tbody tr").evaluateAll((trs) =>
      trs.map((tr) => [tr.querySelectorAll(".fr-dot-on").length, Number(tr.querySelectorAll("td")[3]?.textContent ?? "0")]),
    );
    // Played is the number of filled dots, on every row.
    for (const [on, played] of dots) expect(on).toBe(played);
  });
});

test.describe("on a phone, and on paper", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("nothing scrolls sideways, and every figure in a picture is 16px or more", async ({ page }) => {
    for (const key of ["stableford", "championship", "fourball", "league", "knockout", "medal", "casual"] as const) {
      await open(page, seeded.events[key].shareToken);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, key).toBeLessThanOrEqual(0);
      const small = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll(".fr-hole b, .fr-bar-fig, .fr-lf, .fr-weeks .fr-figs")) {
          const px = parseFloat(getComputedStyle(el).fontSize);
          if (px < 16) out.push(`${el.className} ${px}`);
        }
        // SVG text is scaled with its drawing: measure it as drawn.
        for (const svg of document.querySelectorAll<SVGSVGElement>("svg.fr-ladder")) {
          const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
          for (const t of svg.querySelectorAll(".fr-svg-place, .fr-svg-name")) {
            const px = parseFloat(getComputedStyle(t).fontSize) * scale;
            if (px < 15.9) out.push(`svg ${t.textContent} ${px.toFixed(1)}`);
          }
        }
        return out;
      });
      expect(small, key).toEqual([]);
    }
  });

  test("printed, the tables behind the pictures are on the paper", async ({ page }) => {
    await open(page, seeded.events.stableford.shareToken);
    await expect(page.locator("[data-graphic=holes] table")).toHaveClass(/fr-sr/);
    expect(await page.locator("[data-graphic=holes] table").evaluate((t) => t.getBoundingClientRect().width)).toBeLessThan(2);
    await page.emulateMedia({ media: "print" });
    expect(await page.locator("[data-graphic=holes] table").evaluate((t) => t.getBoundingClientRect().width)).toBeGreaterThan(100);
  });
});

test("the report's link unfurls as its own card", async ({ request }) => {
  const res = await request.get(`/live/${seeded.events.medal.shareToken}/report/opengraph-image`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("image/png");
  const page = await request.get(`/live/${seeded.events.medal.shareToken}/report`);
  const html = await page.text();
  expect(html).toContain("after a play-off");
  expect(html).toMatch(/<title>[^<]*Final report/);
  expect(html).toMatch(/og:image[^>]*\/report\/opengraph-image/);
});
