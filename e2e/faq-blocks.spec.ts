import { expect, test, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";

/**
 * THE THREE ANSWERS THAT CARRY A BLOCK OF THEIR OWN ARE LAID OUT, NOT RUN TOGETHER.
 *
 * On the questions page three answers are more than a paragraph: the worked
 * handicap sum, the list of formats, and the three prices. Their rules were left
 * out when the shared stylesheet was rewritten for the front door's redesign,
 * and each block went on being printed with nothing to lay it out:
 *
 *     Handicap index12.4Course rating / slope71.5 / 140Course handicap15Four-ball allowance90%Playing handicap14
 *
 * on a public page, for a fortnight, under "How are course handicaps
 * calculated?". Every walk opened /faq and none opened an answer and looked.
 * Found 2026-10-13 by opening it to read a figure that had just been corrected
 * — and the figure was wrong too: 14 where the Rules of Handicapping give 13.
 *
 *   the handicap sum   → five rows; each label on the same line as its figure,
 *                         to its left; the sum reads 12.4, then 14.86 played as
 *                         15, 90% of 14.86, and a playing handicap of 13
 *   the formats        → sixteen names, each in a box of its own, none touching
 *   the prices         → three cards, side by side on a laptop and stacked on a
 *                         phone; in each the name, the price and the terms sit
 *                         one under the other
 *   and none of the three is wider than its answer or the screen
 *
 * `landing-answers-are-dressed.test.ts` holds every class these pages write to a
 * rule in the sheet. This is the half that cannot be read off a stylesheet: that
 * the rule lays the thing out.
 *
 * WHAT IT CANNOT SEE: whether the blocks are handsome. It measures that they are
 * tables, pills and cards rather than a sentence.
 */

test.use({ storageState: { cookies: [], origins: [] } });

type Box = { x: number; y: number; w: number; h: number; text: string };

/** Open one question's answer and hand back the block inside it. */
async function openAnswer(page: Page, group: string, question: string, block: string) {
  const g = page.locator(`details.fq-group#${group}`);
  await expect(g, `the questions page has no group "${group}"`).toHaveCount(1);
  if (!(await g.evaluate((el) => (el as HTMLDetailsElement).open))) await g.locator("> summary").click();
  const q = g.locator(`details.q#q-${question}`);
  await expect(q, `the group "${group}" has no question "${question}"`).toHaveCount(1);
  if (!(await q.evaluate((el) => (el as HTMLDetailsElement).open))) await q.locator("> summary").click();
  const el = q.locator(`.ans .${block}`);
  await expect(el, `the answer to "${question}" has no .${block}`).toBeVisible();
  await el.scrollIntoViewIfNeeded();
  return { answer: q.locator(".ans"), el };
}

const boxes = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height, text: (el.textContent ?? "").trim() } as Box;
    }),
  );

test("the questions page lays out its handicap sum, its formats and its prices", async ({ page }, testInfo) => {
  const errors: string[] = [];
  watchPageErrors(page, errors, "visitor");
  await page.goto(`/faq?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const viewport = page.viewportSize()!;
  const narrow = viewport.width <= 560;

  /** Inside the answer and inside the screen. */
  const fits = async (answer: ReturnType<Page["locator"]>, el: ReturnType<Page["locator"]>, what: string) => {
    const a = (await answer.boundingBox())!;
    const b = (await el.boundingBox())!;
    expect(b.x, `${what} starts left of its answer`).toBeGreaterThanOrEqual(a.x - 1);
    expect(b.x + b.width, `${what} runs past its answer`).toBeLessThanOrEqual(a.x + a.width + 1);
    expect(b.x + b.width, `${what} runs off the screen`).toBeLessThanOrEqual(viewport.width + 1);
  };

  // ── the handicap sum ───────────────────────────────────────────────────────
  {
    const { answer, el } = await openAnswer(page, "scoring", "handicaps", "hc");
    await fits(answer, el, "the handicap sum");
    const cells = await boxes(page, "details.q#q-handicaps .hc > span");
    expect(cells, "the sum is not five labels and five figures").toHaveLength(10);
    for (let i = 0; i < cells.length; i += 2) {
      const [label, figure] = [cells[i], cells[i + 1]];
      expect(Math.abs(label.y - figure.y), `"${label.text}" and "${figure.text}" are not on one line`).toBeLessThan(2);
      expect(label.x + label.w, `"${label.text}" overlaps its figure`).toBeLessThanOrEqual(figure.x + 1);
      if (i >= 2) expect(label.y, `"${label.text}" is not below the row before it`).toBeGreaterThan(cells[i - 2].y + 8);
      // A column: every label starts at the same left edge.
      expect(Math.abs(label.x - cells[0].x), `"${label.text}" is not in the label column`).toBeLessThan(2);
    }
    // And it is the Rule's sum (6.2a): the allowance of the figure before rounding.
    expect(cells.map((c) => c.text)).toEqual([
      "Handicap index", "12.4",
      "Course rating / slope", "71.5 / 140",
      "Course handicap", "14.86, played as 15",
      "Four-ball allowance", "90% of 14.86",
      "Playing handicap", "13",
    ]);
    await expect(answer).toContainText("before it is rounded");
  }

  // ── the formats ────────────────────────────────────────────────────────────
  {
    const { answer, el } = await openAnswer(page, "scoring", "formats", "fmts");
    await fits(answer, el, "the list of formats");
    const pills = await boxes(page, "details.q#q-formats .fmts > span");
    expect(pills, "the answer says sixteen formats").toHaveLength(16);
    for (const [i, a] of pills.entries()) {
      expect(a.w, `"${a.text}" has no box of its own`).toBeGreaterThan(20);
      for (const b of pills.slice(i + 1)) {
        const apart = a.x + a.w <= b.x - 3 || b.x + b.w <= a.x - 3 || a.y + a.h <= b.y - 3 || b.y + b.h <= a.y - 3;
        expect(apart, `"${a.text}" touches "${b.text}"`).toBe(true);
      }
    }
    const border = await page.locator("details.q#q-formats .fmts > span").first().evaluate((s) => getComputedStyle(s).borderTopWidth);
    expect(border, "a format's name has no outline").not.toBe("0px");
  }

  // ── the prices ─────────────────────────────────────────────────────────────
  {
    const { answer, el } = await openAnswer(page, "plans", "cost", "tierlist");
    await fits(answer, el, "the three prices");
    const cards = await boxes(page, "details.q#q-cost .tierlist > div");
    expect(cards, "the answer shows three plans").toHaveLength(3);
    if (narrow) {
      for (let i = 1; i < 3; i += 1) expect(cards[i].y, "on a phone the plans stack").toBeGreaterThanOrEqual(cards[i - 1].y + cards[i - 1].h);
    } else {
      for (let i = 1; i < 3; i += 1) {
        expect(Math.abs(cards[i].y - cards[0].y), "on a laptop the plans sit in a row").toBeLessThan(2);
        expect(cards[i].x, "two plans overlap").toBeGreaterThanOrEqual(cards[i - 1].x + cards[i - 1].w);
      }
    }
    for (let i = 0; i < 3; i += 1) {
      const card = page.locator("details.q#q-cost .tierlist > div").nth(i);
      const [name, price, terms] = await Promise.all(["b", "span", "small"].map((t) => card.locator(t).boundingBox()));
      expect(price!.y, "a plan's price is not under its name").toBeGreaterThanOrEqual(name!.y + name!.height - 1);
      expect(terms!.y, "a plan's terms are not under its price").toBeGreaterThanOrEqual(price!.y + price!.height - 1);
    }
  }

  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(sideways, "the questions page scrolls sideways with its answers open").toBeLessThanOrEqual(0);
  testInfo.annotations.push({ type: "width", description: String(viewport.width) });
  expect(errors, errors.join("\n")).toEqual([]);
});
