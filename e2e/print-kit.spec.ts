import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import jsQR from "jsqr";
import { watchPageErrors } from "./page-errors";
import { seedPrint, teardownPrint, LONG_NAME } from "./print-kit-fixture.mjs";
import { paperRefusals, staleSentence } from "../src/lib/domain/print-kit";
import { formatDayAt } from "../src/lib/domain/locale";

/**
 * THE PRINT KIT, AS THE SECRETARY USES IT ON THE MORNING (2026-10-23; the normal
 * card of the ruling of 30 Oct 2026).
 *
 * Walked as the person who prints: open the kit for a Stableford off a shotgun
 * and for a team cup, look at the sheets, switch the paper, print, change a
 * group, reprint only what changed, reissue a round code. And the printer's
 * answers checked off the PDF the browser would hand it, not off the screen:
 *
 *   sheets                     every card the normal scorecard two to a sheet;
 *                              the PDF's page count is the sheets on the Print
 *                              button, at A4 and at US Letter
 *   a 59-character name        on its card (as its initial and surname), its
 *                              sign and the starting sheet, inside every box
 *   every QR                   read back by a decoder, to exactly /play#CODE
 *   never on paper             no email, phone number, amount or sale word in
 *                              any text on any card (with a control)
 *   the stamp                  the press records the cards, each foot says when
 *                              on the CLUB's clock — run with E2E_TZ to put the
 *                              club and the browser somewhere the server is not
 *   reprint what changed       a moved group names its cards and its buggies'
 *                              signs; "Reprint these" prints just those
 *
 * The strict measure of every card at print size is `print-kit-fits.spec.ts`.
 * Its own fixture (`print-kit-fixture.mjs`, mark `zz-print`), so it neither
 * needs nor touches the shared one. The club is British, so its golf cars are
 * buggies — the country words on paper. Desktop only: printing is desk work.
 *
 * WHAT IT CANNOT SEE: a real printer's margins, and a phone camera reading the
 * QR off paper in sunlight — the decoder reads the drawing, not the print.
 */

test.describe.configure({ mode: "serial" });
test.skip(({ browserName }) => browserName !== "chromium", "page.pdf is Chromium's");

const prisma = new PrismaClient();
let f: Awaited<ReturnType<typeof seedPrint>>;

test.beforeAll(async () => {
  f = await seedPrint();
});
test.afterAll(async () => {
  await teardownPrint();
  await prisma.$disconnect();
});

async function as(page: Page, baseURL: string, which: "cup" | "sf") {
  const c = f.cookies[which];
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: "ng_session", value: c.session, url: baseURL },
    { name: "ng_active_event", value: c.event, url: baseURL },
  ]);
  // The printer is not this test's to open: count the presses instead.
  await page.addInitScript(() => {
    (window as unknown as { __printed: number }).__printed = 0;
    window.print = () => {
      (window as unknown as { __printed: number }).__printed += 1;
    };
  });
}

async function open(page: Page, path: string) {
  await page.emulateMedia({ media: "screen" });
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("heading", { level: 1, name: "Print kit" })).toBeVisible();
}

/** The cards and pages that would be printed: keys, which document, and the sheets they make. */
async function visible(page: Page) {
  return page.evaluate(() => ({
    cards: [...document.querySelectorAll<HTMLElement>("#pk-pages [data-card], #pk-pages .pk-startpage")].map((p) => ({ key: p.dataset.key ?? "", doc: p.dataset.doc ?? "", format: p.dataset.card ?? "page" })),
    sheets: document.querySelectorAll("#pk-pages .pk-sheet").length,
  }));
}

/** Every card's safe box and the starting sheet's page, measured for anything running off it. */
async function overflows(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const b of document.querySelectorAll<HTMLElement>("#pk-pages .pk-safe, #pk-pages .pk-startpage")) {
      if (b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1) out.push(`${b.closest<HTMLElement>("[data-key]")?.dataset.key}: ${b.scrollWidth}x${b.scrollHeight} in ${b.clientWidth}x${b.clientHeight}`);
    }
    return out;
  });
}

/** Every piece of text on the printed sheets, one string per text node, round codes left out. */
async function printedTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.getElementById("pk-pages")!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      if (el.closest("style, [data-code]")) continue;
      if (!el.closest(".pk-sheet")) continue;
      if (n.textContent?.trim()) out.push(n.textContent);
    }
    return out;
  });
}

/** Each QR drawn on a sheet, rasterised and read back by a decoder. */
async function decodeQrs(page: Page): Promise<Array<{ drawn: string; read: string | null }>> {
  const images = await page.evaluate(async () => {
    const out: Array<{ drawn: string; w: number; h: number; data: number[] }> = [];
    for (const svg of document.querySelectorAll<SVGSVGElement>("#pk-pages svg.pk-qr")) {
      const size = 400;
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, size, size);
      out.push({ drawn: svg.dataset.link ?? "", w: size, h: size, data: [...ctx.getImageData(0, 0, size, size).data] });
    }
    return out;
  });
  return images.map((i) => ({ drawn: i.drawn, read: jsQR(Uint8ClampedArray.from(i.data), i.w, i.h)?.data ?? null }));
}

/** The PDF Chromium would print, as its page sizes in points. */
async function pdfPages(page: Page): Promise<Array<{ w: number; h: number }>> {
  await page.emulateMedia({ media: "print" });
  const pdf = (await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString("latin1");
  await page.emulateMedia({ media: "screen" });
  return [...pdf.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => ({ w: Math.round(Number(m[1])), h: Math.round(Number(m[2])) }));
}

/** The Stableford is in threes: one buggy of two and one of one per group. */
const buggiesPerGroup = 2;

test("the Stableford's paper: the normal card two to a sheet, readable, nothing it must not carry, every QR to /play", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  await as(page, baseURL!, "sf");
  await open(page, `/print?round=${f.sf.stageId}`);

  // The checklist: a card per player, a sign per buggy, two spares, one starting sheet.
  const n = f.sf.players.length;
  const signs = f.sf.groups * buggiesPerGroup;
  await expect(page.getByText(`one per player · ${n} cards on ${Math.ceil(n / 2)} sheets`)).toBeVisible();
  await expect(page.getByText(`one per buggy · ${signs} cards on ${Math.ceil(signs / 2)} sheets`)).toBeVisible();
  // The document is named in the club's words: a British club's golf cars are buggies.
  await expect(page.locator("fieldset.card")).toContainText("Buggy signs — one per buggy");
  const { cards, sheets } = await visible(page);
  expect(cards.filter((p) => p.doc === "cards")).toHaveLength(n);
  expect(cards.filter((p) => p.doc === "signs")).toHaveLength(signs);
  expect(cards.filter((p) => p.doc === "spare")).toHaveLength(2);
  expect(cards.filter((p) => p.doc === "start")).toHaveLength(1);
  expect(cards.filter((p) => p.format === "fold-out"), "a group of three is never a fold-out").toEqual([]);
  // The Print button says the sheets.
  await expect(page.getByRole("button", { name: new RegExp(`^Print ${sheets} sheets$`) })).toBeVisible();

  // The long name: its initial and surname on its card, in full on its sign and the starting sheet.
  const longCard = page.locator(`#pk-pages [data-card][data-doc="cards"]`).filter({ hasText: "W. Fotheringay-Pemberton-Ashcombe" });
  await expect(longCard).toHaveCount(1);
  await expect(page.locator(`#pk-pages [data-card][data-doc="signs"]`).filter({ hasText: "W. Fotheringay-Pemberton-Ashcombe" })).toHaveCount(buggiesPerGroup);
  await expect(page.locator(`#pk-pages .pk-startpage`)).toContainText(LONG_NAME);
  expect(await overflows(page)).toEqual([]);

  // A shotgun: every card says the hole it starts on, large.
  await expect(longCard.locator(".pk-start")).toContainText(/Starts: Hole \d+/);
  // A Stableford card has its points column, for the Committee.
  await expect(longCard.locator("th", { hasText: /^Pts$/ })).toHaveCount(1);
  // The member whose index nobody has claimed is "to be confirmed", never a nought.
  await expect(page.locator(`#pk-pages [data-card][data-doc="cards"]`).filter({ hasText: "Unity Unclaimed" })).toContainText("To be confirmed");

  // Never on paper, read off every text on every sheet.
  const texts = await printedTexts(page);
  expect(texts.length, "CONTROL: the sweep read no text").toBeGreaterThan(200);
  expect(paperRefusals(texts)).toEqual([]);
  // CONTROL: the same collection sees an address put on a card.
  await page.evaluate(() => {
    const s = document.createElement("span");
    s.textContent = "ann@example.invalid";
    document.querySelector("#pk-pages [data-card] .pk-safe")!.appendChild(s);
  });
  expect(paperRefusals(await printedTexts(page)).length).toBe(1);
  await page.evaluate(() => document.querySelector("#pk-pages [data-card] .pk-safe span:last-child")?.remove());

  // The TourneyHQ line goes to /play, never the front door, and only in the foot.
  const brand = page.locator("#pk-pages .pk-brand");
  expect(await brand.count()).toBe(cards.length);
  await expect(brand.first()).toHaveText(/Scored live with TourneyHQ · .+\/play$/);

  // Every QR reads back to exactly the round's /play#CODE.
  const origin = new URL(baseURL!).origin;
  const code = `${f.sf.code.slice(0, 4)}-${f.sf.code.slice(4)}`;
  const qrs = await decodeQrs(page);
  expect(qrs.length, "one per buggy sign and the two spares").toBe(signs + 2);
  for (const q of qrs) {
    expect(q.read, "a QR did not decode").toBe(`${origin}/play#${code}`);
    expect(q.drawn).toBe(q.read);
  }

  // The PDF: the sheets on the button, cards on their side and the starting sheet upright — at A4…
  const a4 = await pdfPages(page);
  expect(a4).toHaveLength(sheets);
  expect(a4.filter((p) => p.w === 842 && p.h === 595)).toHaveLength(sheets - 1);
  expect(a4.filter((p) => p.w === 595 && p.h === 842)).toHaveLength(1);
  // …and at US Letter.
  await page.getByRole("radio", { name: "US Letter" }).check();
  expect(await overflows(page), "something runs off a Letter card").toEqual([]);
  const letter = await pdfPages(page);
  expect(letter).toHaveLength(sheets);
  expect(letter.filter((p) => p.w === 792 && p.h === 612)).toHaveLength(sheets - 1);
  expect(letter.filter((p) => p.w === 612 && p.h === 792)).toHaveLength(1);
  await page.getByRole("radio", { name: "A4" }).check();

  expect(errors, "a screen threw").toEqual([]);
});

test("printing stamps the cards; a moved group and a reissued code ask for just those again", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  await as(page, baseURL!, "sf");
  await open(page, `/print?round=${f.sf.stageId}`);
  const ticked = (await visible(page)).cards.length;

  // The press records what went to the printer, and each foot says when — on the club's clock.
  const before = new Date();
  await page.getByRole("button", { name: /^Print \d+ sheets$/ }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  const after = new Date();
  const zone = f.zone;
  const days = new Set([formatDayAt(before, "en-US", zone), formatDayAt(after, "en-US", zone)]);
  const stamp = (await page.locator("#pk-pages .pk-stamp").first().innerText()).trim();
  expect(stamp).toMatch(/^Printed \d{1,2}:\d{2}( [AP]M)?, .+ · v1 · groups as of /);
  expect([...days].some((d) => stamp.includes(`, ${d} ·`)), `"${stamp}" is not today at the club (${[...days].join(" or ")}, ${zone})`).toBe(true);

  await open(page, `/print?round=${f.sf.stageId}`);
  await expect(page.getByText("Not printed yet")).toHaveCount(0);
  // The warning, not the screen's own explanation of it (which uses the same words).
  await expect(page.getByRole("status").filter({ hasText: "out of date" })).toHaveCount(0);

  // Two players change groups.
  const stage = await prisma.stage.findUniqueOrThrow({ where: { id: f.sf.stageId } });
  const sheet = JSON.parse(stage.teeSheet);
  const [a, b] = [sheet.groups[0].playerIds[1], sheet.groups[1].playerIds[1]];
  sheet.groups[0].playerIds[1] = b;
  sheet.groups[1].playerIds[1] = a;
  await prisma.stage.update({ where: { id: f.sf.stageId }, data: { teeSheet: JSON.stringify(sheet) } });

  await open(page, `/print?round=${f.sf.stageId}`);
  // Their two cards, both groups' buggy signs (every sign names its whole group), and the starting sheet.
  const banner = page.getByRole("status").filter({ hasText: "out of date" });
  await expect(banner).toContainText(staleSentence(2 + 2 * buggiesPerGroup + 1));
  await expect(banner).toContainText("Group 1 — Buggy 1A sign");
  await expect(banner).toContainText("Group 2 — Buggy 2B sign");
  // The Tee sheet says so too.
  await page.goto(`/foursomes?round=${f.sf.stageId}&bust=${Date.now()}`);
  await expect(page.getByRole("status").filter({ hasText: staleSentence(2 + 2 * buggiesPerGroup + 1) })).toBeVisible();
  await page.getByRole("link", { name: /Reprint them in the Print kit/ }).click();
  await page.waitForLoadState("networkidle").catch(() => {});

  // "Reprint these" lays out those and nothing else: 2 cards on 1 sheet, 4 signs on 2, the starting sheet.
  await page.getByRole("button", { name: "Reprint these" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  const reprinted = await visible(page);
  expect(reprinted.cards).toHaveLength(2 + 2 * buggiesPerGroup + 1);
  expect(reprinted.sheets).toBe(1 + 2 + 1);
  expect((await pdfPages(page)).length).toBe(reprinted.sheets);
  await expect(page.locator(`#pk-pages [data-card][data-key="signs:Group 1:A"] .pk-stamp`)).toContainText("v2");

  await open(page, `/print?round=${f.sf.stageId}`);
  await expect(page.getByRole("status").filter({ hasText: "out of date" })).toHaveCount(0);
  expect((await visible(page)).cards.length).toBe(ticked);

  // A reissued code: every sheet carrying it is flagged — each buggy's sign and both spares.
  await prisma.stage.update({ where: { id: f.sf.stageId }, data: { accessCode: "ZZPW2346" } });
  try {
    await open(page, `/print?round=${f.sf.stageId}`);
    await expect(page.getByRole("status").filter({ hasText: "out of date" })).toContainText(staleSentence(f.sf.groups * buggiesPerGroup + 2));
    await expect(page.getByRole("status").filter({ hasText: "out of date" })).toContainText("spare sign");
  } finally {
    await prisma.stage.update({ where: { id: f.sf.stageId }, data: { accessCode: f.sf.code } });
  }
  expect(errors, "a screen threw").toEqual([]);
});

test("the team cup: one fold-out card per match with both nines on it, and a sign per buggy carrying both codes", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  await as(page, baseURL!, "cup");

  // From the Team cup screen's own door.
  await page.goto(`/cup?bust=${Date.now()}`);
  await page.getByRole("link", { name: "Print…" }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("heading", { level: 1, name: "Print kit" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("round")).toBe(f.cup.fourball);

  const { cards } = await visible(page);
  const cupCards = cards.filter((p) => p.doc === "cup");
  expect(cupCards).toHaveLength(5);
  // X1: both formats on one card is the one cup card that folds out — and says why.
  expect(cupCards.every((p) => p.format === "fold-out")).toBe(true);
  await expect(page.getByRole("note")).toContainText("because both formats of the day are on one card");
  expect(cards.filter((p) => p.doc === "signs")).toHaveLength(10);
  const first = page.locator(`#pk-pages [data-card][data-doc="cup"]`).first();
  await expect(first).toContainText("holes 10–18");
  await expect(first).toContainText("holes 1–9");
  await expect(first).toContainText("better ball");
  expect(await overflows(page)).toEqual([]);

  // Both codes on every sign, each QR read back to its own round.
  const origin = new URL(baseURL!).origin;
  const want = new Set(f.cup.codes.map((c) => `${origin}/play#${c.slice(0, 4)}-${c.slice(4)}`));
  const qrs = await decodeQrs(page);
  expect(qrs.length).toBe(10 * 2 + 2);
  for (const q of qrs) {
    expect(want.has(q.read ?? ""), `${q.read} is not one of the cup's rounds`).toBe(true);
    expect(q.drawn).toBe(q.read);
  }
  expect(paperRefusals(await printedTexts(page))).toEqual([]);
  expect((await pdfPages(page)).length).toBe((await visible(page)).sheets);

  // The singles session says its card is printed with the four-balls.
  await open(page, `/print?round=${f.cup.singles}`);
  await expect(page.getByText(/Printed with Four-balls — back nine/).first()).toBeVisible();
  expect(errors, "a screen threw").toEqual([]);
});
