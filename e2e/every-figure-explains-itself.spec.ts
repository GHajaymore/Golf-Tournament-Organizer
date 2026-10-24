import { readFileSync } from "node:fs";
import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import {
  seedExplain,
  teardownExplain,
  holdResults,
  EXPLAIN_TOKEN,
  FIELD,
  HOLES,
  MEMBER_INDEX,
  MEMBER_STROKES,
  PAR,
  RATING,
  SI,
} from "./explain-fixture.mjs";

/**
 * EVERY FIGURE EXPLAINS ITSELF, AS THE PEOPLE WHO READ THEM WOULD (2026-10-24).
 *
 * The panel's first item before launch: a figure is pressed, and one sentence
 * of working opens with the Rule it follows. On the fixture's own net medal
 * (`explain-fixture.mjs`), in a browser:
 *
 *   1. A MEMBER, on their own card, mid-round: taps "1 shot on this hole", the
 *      Net in the strip, and — on the full card — the box of a hole with two
 *      dots. Each sentence is read for its numbers, and those numbers are held
 *      to the figure on the screen AND to the Rule worked here, in whole
 *      numbers, from the stored index, the tee's rating and the stroke index —
 *      a route the app does not take.
 *   2. A VISITOR, on the public board, signed out: taps a place a countback
 *      decided, a place it could not, a net figure, and a DQ. The countback's
 *      totals are worked here from the stored cards.
 *   3. THE CONTROL — the results held from everybody but the committee: the
 *      board is gone, so there is no figure and no "why" for anybody.
 *
 * And it weighs the card: what a phone downloads for it, against the budget the
 * weight spec holds the shared fixture's card to (`weight-budget.json`).
 *
 * WHAT IT CANNOT SEE: a Stableford card, a nine-hole card, a plus handicap and
 * tees of a higher par in a browser — those are swept on the rendered card in
 * `every-figure-explains-itself.test.tsx` and worked from the Rule in
 * `figure-working.test.ts` — and the report and printed sheets, which are not
 * this slice.
 */
let seeded: Awaited<ReturnType<typeof seedExplain>>;
test.beforeAll(async () => {
  seeded = await seedExplain();
});
test.afterAll(async () => {
  await teardownExplain();
});

// The Rule, worked here in whole numbers. Course handicap (Rule 6.1a):
// Index × Slope ÷ 113 + (Rating − Par), over 1130 to stay exact; the playing
// handicap is 95% of that unrounded figure, rounded once, a half up (6.2a,
// Appendix C).
const over1130 = Math.round(MEMBER_INDEX * 10) * RATING.slopeRating + (RATING.courseRating * 10 - RATING.par * 10) * 113;
const playingByRule = Math.floor((2 * over1130 * 95 + 113000) / (2 * 113000));
/** Strokes received on each hole, handed out one at a time from stroke index 1 (Appendix E). */
const strokesByRule = (() => {
  const out = SI.map(() => 0);
  for (let k = 0; k < playingByRule; k += 1) out[SI.indexOf((k % HOLES) + 1)] += 1;
  return out;
})();

/** The sentence a pressed figure opened, as the person reads it. */
async function openedBy(page: Page, summary: ReturnType<Page["locator"]>, shot?: string) {
  await summary.click();
  const says = summary.locator("xpath=..").locator(".why-says");
  await expect(says).toBeVisible();
  await expect(says).toBeInViewport();
  if (shot) await page.screenshot({ path: shot });
  const text = (await says.innerText()).replace(/\s+/g, " ").trim();
  // Closed again, as a person would, so it covers nothing the next press needs.
  await page.keyboard.press("Escape");
  await expect(says).toBeHidden();
  return text;
}

test("a member taps the figures on their own card, and a visitor taps the board's — each says how it was worked out", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const device = testInfo.project.use;
  const asMember = await browser.newContext({ ...device, baseURL });
  const asVisitor = await browser.newContext({ ...device, baseURL });
  await asMember.addCookies([{ name: "ng_session", value: seeded.member, url: baseURL! }]);
  try {
    const card = await asMember.newPage();
    const board = await asVisitor.newPage();
    watchPageErrors(card, errors, "member");
    watchPageErrors(board, errors, "visitor");

    await test.step("the member's playing handicap and strokes are the Rule's", async () => {
      // 24.6 off 72.0 / 113 is a course handicap of 24.6; 95% is 23.37: 23.
      expect(playingByRule).toBe(23);
      expect(strokesByRule.reduce((a, b) => a + b, 0)).toBe(23);
    });

    await test.step("hole by hole: the stroke on the hole being played says why", async () => {
      expect((await card.goto(`/me/card?bust=${Date.now()}`))?.status(), "the member is signed in").toBe(200);
      await expect(card.getByRole("heading", { level: 1 })).toBeVisible();
      // The card opens on the 10th, the first hole still to play.
      const hole = 9;
      const shots = strokesByRule[hole];
      const mark = card.locator('summary[aria-label$="on this hole — how it was worked out"]');
      await expect(mark).toHaveCount(1);
      await expect(mark).toContainText(`${shots === 1 ? "1 shot" : `${shots} shots`} on this hole`);
      const says = await openedBy(card, mark, testInfo.outputPath("card-stroke-why.png"));
      expect(says).toContain(`your playing handicap is ${playingByRule} and this hole is stroke index ${SI[hole]}`);
      expect(says).toMatch(shots === 1 ? /^You get a stroke here/ : new RegExp(`^You get ${shots} strokes here`));
      // The spread, as the sentence states it, gives this hole the same strokes.
      const laps = Math.floor(playingByRule / HOLES);
      const rest = playingByRule % HOLES;
      expect(says).toContain(`its ${playingByRule} strokes are one on every hole and one more on stroke index 1 to ${rest}`);
      expect(laps + (SI[hole] <= rest ? 1 : 0)).toBe(shots);
      expect(says).toContain("(Rules of Handicapping, Appendix E)");
    });

    await test.step("the Net in the strip is the gross less the strokes received, and says how the playing handicap was reached", async () => {
      const net = card.locator('summary[aria-label^="Net "]');
      const shown = Number((await net.innerText()).trim());
      const says = await openedBy(card, net, testInfo.outputPath("card-net-why.png"));
      const m = /^Gross (\d+) − the (\d+) strokes you receive on the (\d+) holes played = net (\d+)\./.exec(says);
      expect(m, says).not.toBeNull();
      const [gross, received, played, sayNet] = m!.slice(1).map(Number);
      // The sentence's arithmetic, the figure on the screen, and the Rule.
      expect(gross - received).toBe(sayNet);
      expect(sayNet).toBe(shown);
      expect(gross).toBe(MEMBER_STROKES.reduce((a, b) => a + b, 0));
      expect(received).toBe(strokesByRule.slice(0, MEMBER_STROKES.length).reduce((a, b) => a + b, 0));
      expect(played).toBe(MEMBER_STROKES.length);
      // "95% of your course handicap of 24.6: 23.37, rounded once to 23."
      const h = /Your playing handicap of (\d+) is 95% of your course handicap of ([\d.]+): ([\d.]+), rounded once to (\d+)\./.exec(says);
      expect(h, says).not.toBeNull();
      expect(Number(h![1])).toBe(playingByRule);
      expect(Math.abs(Number(h![2]) - over1130 / 1130)).toBeLessThan(0.01);
      expect(Math.floor(Number(h![3]) + 0.5)).toBe(Number(h![4]));
      expect(says).toContain("(Rules of Handicapping, Rule 6.2a and Appendix C)");
      // It closes as a popover does: Escape, or a tap anywhere outside it.
      await card.keyboard.press("Escape");
      await expect(net.locator("xpath=..").locator(".why-says")).toBeHidden();
      await net.click();
      await expect(net.locator("xpath=..").locator(".why-says")).toBeVisible();
      await card.getByRole("heading", { level: 1 }).click();
      await expect(net.locator("xpath=..").locator(".why-says")).toBeHidden();
    });

    await test.step("the full card: a box with two dots says why it has two", async () => {
      await card.locator("label.seg-opt", { hasText: "Full card" }).click();
      const two = strokesByRule.findIndex((s, i) => s === 2 && i < MEMBER_STROKES.length);
      expect(two, "the fixture has a hole with two strokes on the front nine").toBeGreaterThanOrEqual(0);
      // Every box's dots, all eighteen, are the Rule's — not only the ones the
      // steps below happen to press. (A mutation pricing the card a stroke high
      // moved one dot, on the 15th, and stayed green until this was added.)
      for (let h = 0; h < HOLES; h += 1) {
        const cell = card.getByRole("textbox", { name: `Hole ${h + 1}, par ${PAR}`, exact: true }).locator("xpath=..");
        await expect(cell.locator("[data-shots]"), `hole ${h + 1}`).toHaveText("•".repeat(strokesByRule[h]));
      }
      const box = card.getByRole("textbox", { name: `Hole ${two + 1}, par ${PAR}`, exact: true });
      // The two dots in that box, as drawn.
      await expect(box.locator("xpath=..").locator("[data-shots]")).toHaveText("••");
      await box.focus();
      const line = card.locator("[data-working-line]");
      await expect(line).toContainText(`Hole ${two + 1}: You get 2 strokes here: your playing handicap is ${playingByRule} and this hole is stroke index ${SI[two]}`);
      await expect(line).toBeInViewport();
      expect(await box.getAttribute("aria-describedby")).toBe(await line.getAttribute("id"));
    });

    await test.step("a visitor on the public board taps a place the countback decided", async () => {
      expect((await board.goto(`/live/${EXPLAIN_TOKEN}?bust=${Date.now()}`))?.status()).toBe(200);
      const ailsa = board.locator('summary[aria-label^="Ailsa Fernie, place "]');
      await expect(ailsa).toHaveText("2");
      const says = await openedBy(board, ailsa, testInfo.outputPath("board-countback-why.png"));
      // The countback, worked here from the stored cards: the last nine.
      const lastNine = (s: number[]) => s.slice(9).reduce((a, b) => a + b, 0);
      const [a, b] = [FIELD[0].strokes, FIELD[1].strokes];
      expect(lastNine(a)).toBeLessThan(lastNine(b));
      expect(says).toContain(`Level with Brodie Halkett on E; ahead on the countback over the last 9 holes: ${lastNine(a)} to ${lastNine(b)}.`);
      expect(says).toContain("(Committee Procedures, Section 5A)");
      // And the place on the screen follows it: Brodie is behind, one place
      // down, and his own place says the same countback from his side.
      const brodie = board.locator('summary[aria-label^="Brodie Halkett, place "]');
      await expect(brodie).toHaveText("3");
      expect(await openedBy(board, brodie)).toContain(
        `Level with Ailsa Fernie on E; behind on the countback over the last 9 holes: ${lastNine(b)} to ${lastNine(a)}.`,
      );
    });

    await test.step("a place nothing separates is shared, and says so", async () => {
      const calum = board.locator('summary[aria-label^="Calum Strachan, place "]');
      await expect(calum).toHaveText("T4");
      await expect(board.locator('summary[aria-label^="Dougal Pirnie, place "]')).toHaveText("T4");
      const says = await openedBy(board, calum);
      expect(says).toContain("Shares 4th with Dougal Pirnie: level on +2, and level on the last 9, the last 6, the last 3 and the last hole too, so nothing separates them.");
    });

    await test.step("a net figure on the board is net less par, and the member's is worked from their strokes", async () => {
      const mine = board.locator('summary[aria-label^="Morag Example\'s score "]');
      const shown = (await mine.innerText()).trim();
      const says = await openedBy(board, mine);
      const gross = MEMBER_STROKES.reduce((x, y) => x + y, 0);
      const received = strokesByRule.slice(0, MEMBER_STROKES.length).reduce((x, y) => x + y, 0);
      const par = PAR * MEMBER_STROKES.length;
      expect(Number(shown)).toBe(gross - received - par);
      expect(says).toContain(`${shown}: ${gross} gross, less ${received} strokes received, is net ${gross - received}, against a par of ${par} for the 9 holes played.`);
    });

    await test.step("a DQ says what it means", async () => {
      const dq = board.locator('summary[aria-label^="Euan Lornie: "]');
      await expect(dq).toContainText("DQ");
      const says = await openedBy(board, dq);
      expect(says).toContain("Disqualified by the committee, so there is no score for the competition and no place.");
      expect(says).toContain("(Rules of Golf, Rule 1.3c)");
    });

    await test.step("the figures are reached from the keyboard too", async () => {
      await board.goto(`/live/${EXPLAIN_TOKEN}?bust=${Date.now()}`);
      const ailsa = board.locator('summary[aria-label^="Ailsa Fernie, place "]');
      await ailsa.focus();
      await board.keyboard.press("Enter");
      await expect(ailsa.locator("xpath=..").locator(".why-says")).toBeVisible();
    });

    await test.step("the control: results held from everybody but the committee — no figure, so no why", async () => {
      // Before: the member's own Board tab explains its figures, as the public one does.
      expect((await card.goto(`/me/board?bust=${Date.now()}`))?.status()).toBe(200);
      await expect(card.locator('summary[aria-label^="Ailsa Fernie, place "]')).toHaveText("2");
      await holdResults(seeded.eventId);
      const res = await board.goto(`/live/${EXPLAIN_TOKEN}?bust=${Date.now()}`);
      expect(res?.status()).toBe(404);
      await expect(board.locator(".why-says")).toHaveCount(0);
      expect(await board.content()).not.toContain("on the countback over");
      expect((await card.goto(`/me/board?bust=${Date.now()}`))?.status()).toBe(200);
      await expect(card.locator("main")).toContainText(/published standings/);
      await expect(card.locator("summary.why-figure")).toHaveCount(0);
      expect(await card.content()).not.toContain("on the countback over");
    });

    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await asMember.close();
    await asVisitor.close();
  }
});

test("the card is no heavier for explaining itself", async ({ browser, baseURL, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "the bytes on the wire are read from Chromium's own network log");
  test.skip(testInfo.project.name !== "phone", "weighed once, as a phone");
  const context = await browser.newContext({ ...testInfo.project.use, baseURL });
  await context.addCookies([{ name: "ng_session", value: seeded.member, url: baseURL! }]);
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    const kind = new Map<string, string>();
    const size = new Map<string, number>();
    cdp.on("Network.responseReceived", (e) => kind.set(e.requestId, e.type));
    cdp.on("Network.loadingFinished", (e) => size.set(e.requestId, e.encodedDataLength));
    await page.goto("/me/card", { waitUntil: "load" });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    const w = { document: 0, script: 0, style: 0 };
    for (const [id, bytes] of size) {
      const t = kind.get(id);
      if (t === "Document") w.document += bytes;
      else if (t === "Script") w.script += bytes;
      else if (t === "Stylesheet") w.style += bytes;
    }
    const budget = JSON.parse(readFileSync("e2e/weight-budget.json", "utf8")) as Record<string, Record<string, Record<string, number>>>;
    const line = budget[process.platform === "win32" ? "win32" : "linux"]["a player's card"];
    console.log(`[weight] /me/card on zz-explain: document ${w.document} script ${w.script} style ${w.style} — budget script ${line.script}, style ${line.style}`);
    // The scripts and the style sheet are the build's, whatever the fixture;
    // the document is this fixture's own card, so it is not held to the line.
    expect(w.script).toBeLessThanOrEqual(line.script * 1.1);
    expect(w.style).toBeLessThanOrEqual(line.style * 1.1);
  } finally {
    await context.close();
  }
});
