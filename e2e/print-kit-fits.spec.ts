import { test, expect, type Page } from "./coverage";
import { seedFits, teardownFits } from "./print-kit-fits-fixture.mjs";

/**
 * EVERY CARD IS THE NORMAL SCORECARD, MEASURED AT PRINT SIZE (panel ruling of 30
 * Oct 2026, 3.5; Ajay: "any card is the card size").
 *
 * For every round of the fits fixture (`print-kit-fits-fixture.mjs` — every shape
 * a card is asked to hold, at its hardest), on US Letter and on A4, with print
 * media emulated, each `[data-card]` is measured in the browser:
 *
 *   1. its trim is 241.3 × 95.25 mm (a fold-out 241.3 × 190.5), within 0.5 px;
 *   2. every element in it sits inside the safe box (the trim less 4 mm), and none
 *      is clipped (scroll size beyond client size), and no line is shorter than
 *      its face's letters (ascent + descent: at 1.3 em Oswald's descenders were cut,
 *      and only Firefox, which counts them as overflow, said so — 31 Oct);
 *   3. no text under 7 pt; a sign's code at 40 pt or more; every QR 30 mm or more;
 *   4. two cards to a sheet (a fold-out one), none crossing its sheet's edge;
 *   5. a fold-out ONLY where the ruling allows one (X1 the cup mixed day, X2 a group
 *      of five as a group card) — any other would be a quiet shrink-around.
 *
 * The CONTROLS run first and must be REPORTED by the same measuring function: a
 * 200-character unbreakable name forced into a card, and a card styled at 6 pt.
 *
 * Chromium here, and WebKit in the round (`E2E_ENGINE=webkit`, `E2E_PLAIN_HTTP=1`):
 * Safari lays type out differently. WHAT IT CANNOT SEE: a real printer's scaling —
 * which is why every sheet carries the 50 mm line to measure.
 */
test.describe.configure({ mode: "serial" });

type Ev = { eventId: string; rounds: Record<string, string>; cookie: { session: string; event: string } };
type Fits = { orgId: string; events: Record<string, Ev> };
let f: Fits;

test.beforeAll(async () => {
  f = (await seedFits()) as unknown as Fits;
});
test.afterAll(async () => {
  await teardownFits();
});

const MM = 96 / 25.4;

async function as(page: Page, baseURL: string, key: string) {
  const c = f.events[key].cookie;
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: "ng_session", value: c.session, url: baseURL },
    { name: "ng_active_event", value: c.event, url: baseURL },
  ]);
}

/** Everything wrong with the cards on the page, one line each. The function the controls prove. */
async function measure(page: Page): Promise<{ problems: string[]; cards: Array<{ key: string; format: string }>; sheets: number }> {
  return page.evaluate((MM) => {
    const problems: string[] = [];
    const cards: Array<{ key: string; format: string }> = [];
    const PT = 96 / 72;
    // The face's content area (ascent + descent), as the browser measures it: what Firefox counts as a line's overflow.
    const ctx = document.createElement("canvas").getContext("2d")!;
    const sheets = [...document.querySelectorAll<HTMLElement>("#pk-pages .pk-sheet")];
    for (const sheet of sheets) {
      const sr = sheet.getBoundingClientRect();
      const inSheet = [...sheet.querySelectorAll<HTMLElement>("[data-card]")];
      const fold = inSheet.some((c) => c.dataset.card === "fold-out");
      if (inSheet.length > (fold ? 1 : 2)) problems.push(`a sheet holds ${inSheet.length} cards`);
      for (const card of inSheet) {
        const key = card.dataset.key ?? "?";
        cards.push({ key, format: card.dataset.card ?? "" });
        const r = card.getBoundingClientRect();
        const wantH = (card.dataset.card === "fold-out" ? 190.5 : 95.25) * MM;
        if (Math.abs(r.width - 241.3 * MM) > 0.5 || Math.abs(r.height - wantH) > 0.5) problems.push(`${key}: trim ${(r.width / MM).toFixed(2)} × ${(r.height / MM).toFixed(2)} mm`);
        if (r.left < sr.left - 0.5 || r.right > sr.right + 0.5 || r.top < sr.top - 0.5 || r.bottom > sr.bottom + 0.5) problems.push(`${key}: crosses its sheet's edge`);
        const safe = { l: r.left + 4 * MM - 0.5, t: r.top + 4 * MM - 0.5, r: r.right - 4 * MM + 0.5, b: r.bottom - 4 * MM + 0.5 };
        for (const el of card.querySelectorAll<HTMLElement | SVGElement>("*")) {
          if (el.tagName === "STYLE" || el.tagName === "path" || el.tagName === "rect") continue;
          const er = el.getBoundingClientRect();
          if (er.width === 0 && er.height === 0) continue;
          const what = `${key}: <${el.tagName.toLowerCase()} class="${(el.getAttribute("class") ?? "").slice(0, 30)}"> "${(el.textContent ?? "").trim().slice(0, 30)}"`;
          if (er.left < safe.l || er.top < safe.t || er.right > safe.r || er.bottom > safe.b) problems.push(`${what} outside the safe box`);
          const h = el as HTMLElement;
          if (h.clientWidth > 0 && (h.scrollWidth > h.clientWidth + 1 || h.scrollHeight > h.clientHeight + 1)) problems.push(`${what} clipped ${h.scrollWidth}×${h.scrollHeight} in ${h.clientWidth}×${h.clientHeight}`);
          const style = getComputedStyle(el);
          const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim());
          if (ownText && Number.isFinite(parseFloat(style.lineHeight))) {
            ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const m = ctx.measureText("Hg");
            const area = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
            if (parseFloat(style.lineHeight) + 0.5 < area) problems.push(`${what}: a line of ${parseFloat(style.lineHeight).toFixed(1)} px cuts its letters (${area.toFixed(1)} px)`);
          }
          if (ownText && parseFloat(style.fontSize) < 7 * PT - 0.01) problems.push(`${what} at ${(parseFloat(style.fontSize) / PT).toFixed(1)} pt`);
          if (el.classList.contains("pk-code") && parseFloat(style.fontSize) < 40 * PT - 0.01) problems.push(`${what}: a code under 40 pt`);
          if (el.classList.contains("pk-qr") && Math.min(er.width, er.height) < 30 * MM - 0.5) problems.push(`${key}: a QR of ${(er.width / MM).toFixed(1)} mm`);
        }
      }
    }
    return { problems, cards, sheets: sheets.length };
  }, MM);
}

async function open(page: Page, round: string, extra = "") {
  // On paper the page is only its sheets: the heading is looked for on screen.
  await page.emulateMedia({ media: "screen" });
  await page.goto(`/print?round=${round}&docs=cards,cup,slips,signs,spare,start${extra}&bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("heading", { level: 1, name: "Print kit" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test("CONTROL: the measure reports a name that overflows and type under 7 pt", async ({ page, baseURL }) => {
  await as(page, baseURL!, "individual");
  await open(page, f.events.individual.rounds.medal);
  await page.emulateMedia({ media: "print" });
  expect((await measure(page)).problems, "the clean page is not clean").toEqual([]);
  // A 200-character unbreakable name forced into the first card's first name cell.
  await page.evaluate(() => {
    const n = document.querySelector<HTMLElement>("#pk-pages [data-card] .pk-name")!;
    n.textContent = "W".repeat(200);
  });
  const long = (await measure(page)).problems;
  expect(long.some((p) => /clipped|outside the safe box/.test(p)), `the forced name was not reported: ${long.join(" | ")}`).toBe(true);
  // A card at 6 pt.
  await open(page, f.events.individual.rounds.medal);
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#pk-pages [data-card] .pk-fig")!.style.fontSize = "6pt";
  });
  const small = (await measure(page)).problems;
  expect(small.some((p) => / at 6\.0 pt$/.test(p)), `6 pt was not reported: ${small.join(" | ")}`).toBe(true);
  // A name set at the 1.3 em that cut Oswald's descenders, in every browser.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#pk-pages [data-card] .pk-name")!.style.lineHeight = "1.3";
  });
  const short = (await measure(page)).problems;
  expect(short.some((p) => /cuts its letters/.test(p)), `a line shorter than its letters was not reported: ${short.join(" | ")}`).toBe(true);
});

/** Which rounds, which layouts, and where the ruling allows a fold-out (X1–X3). */
const CASES: Array<{ event: string; round: string; extra?: string; foldouts: (keys: string[]) => string[] }> = [
  { event: "individual", round: "medal", foldouts: () => [] },
  // X2: as group cards, the group of five folds out — and only it.
  { event: "individual", round: "medal", extra: "&cards=group", foldouts: (k) => k.filter((x) => x === "cards:group:Group 4") },
  { event: "individual", round: "medal", extra: "&signs=group", foldouts: () => [] },
  { event: "individual", round: "stableford", foldouts: () => [] },
  { event: "individual", round: "stableford", extra: "&cards=group", foldouts: (k) => k.filter((x) => x === "cards:group:Group 4") },
  { event: "fourball", round: "fourball", foldouts: () => [] },
  // X3: the side of four long names cannot hold them on two lines; the side of short ones can.
  { event: "scramble", round: "scramble", foldouts: (k) => k.filter((x) => x.startsWith("cards:side:Wilhelmina")) },
  { event: "foursomes", round: "foursomes", foldouts: () => [] },
  { event: "singles", round: "singles", foldouts: () => [] },
  { event: "cup18", round: "fourball18", foldouts: () => [] },
  // X1: the mixed day's every cup card folds out; its signs do not.
  { event: "cupmixed", round: "fourball", foldouts: (k) => k.filter((x) => x.startsWith("cup:")) },
];

for (const paper of ["letter", "a4"] as const) {
  test(`every card on ${paper === "a4" ? "A4" : "US Letter"} is the normal scorecard, or a fold-out only where the ruling allows`, async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    const seen = new Set<string>();
    for (const c of CASES) {
      await as(page, baseURL!, c.event);
      await open(page, f.events[c.event].rounds[c.round], `${c.extra ?? ""}&paper=${paper}`);
      await page.emulateMedia({ media: "print" });
      const m = await measure(page);
      const where = `${String(c.event)}/${c.round}${c.extra ?? ""}`;
      expect(m.cards.length, `${where}: nothing was measured`).toBeGreaterThan(0);
      expect(m.problems, where).toEqual([]);
      const folded = m.cards.filter((x) => x.format === "fold-out").map((x) => x.key).sort();
      expect(folded, `${where}: a fold-out the ruling does not allow, or a missing one`).toEqual(c.foldouts(m.cards.map((x) => x.key)).sort());
      for (const x of m.cards) seen.add(x.key.split(":")[0]);
      await page.emulateMedia({ media: "screen" });
    }
    // Every kind of card was measured, the fold-out among them.
    expect([...seen].sort()).toEqual(["cards", "cup", "signs", "slips", "spare"]);
  });
}

test("the sheet count on the button is the sheets laid out", async ({ page, baseURL, browserName }) => {
  test.skip(browserName !== "chromium", "page.pdf is Chromium's");
  await as(page, baseURL!, "individual");
  await open(page, f.events.individual.rounds.medal);
  const m = await measure(page);
  await expect(page.getByRole("button", { name: new RegExp(`^Print ${m.sheets} sheets$`) })).toBeVisible();
  // And the PDF Chromium would print has that many pages.
  await page.emulateMedia({ media: "print" });
  const pdf = (await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString("latin1");
  expect([...pdf.matchAll(/\/Type\s*\/Page[^s]/g)].length).toBe(m.sheets);
});
