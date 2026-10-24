import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import jsQR from "jsqr";
import { watchPageErrors } from "./page-errors";
import { seedPrint, teardownPrint, LONG_NAME } from "./print-kit-fixture.mjs";
import { paperRefusals, staleSentence } from "../src/lib/domain/print-kit";
import { formatDayAt } from "../src/lib/domain/locale";

/**
 * THE PRINT KIT, AS THE SECRETARY USES IT ON THE MORNING (2026-10-23).
 *
 * Walked as the person who prints: open the kit for a Stableford off a shotgun
 * and for a team cup, look at the pages, switch the paper, print, change a
 * group, reprint only what changed, reissue a round code. And the printer's
 * answers checked off the PDF the browser would hand it, not off the screen:
 *
 *   one page per sheet         the PDF's page count is the number of sheets
 *                              ticked, at A4 and at US Letter, each the right
 *                              way up — and nothing on a page runs off it
 *   a 59-character name        fits its cell on the card, the sign and the sheet
 *   every QR                   read back by a decoder, to exactly /play#CODE
 *   never on paper             no email, phone number, amount or sale word in
 *                              any text on any page (with a control)
 *   the stamp                  the press records the sheets, each footer says
 *                              when on the CLUB's clock — run with E2E_TZ to put
 *                              the club and the browser somewhere the server is not
 *   reprint what changed       a moved group names its sheets, "Reprint these"
 *                              prints just those; a reissued code flags the signs
 *
 * Its own fixture (`print-kit-fixture.mjs`, mark `zz-print`), so it neither
 * needs nor touches the shared one. Desktop only: printing is desk work, and
 * the pages are paper-sized whatever the screen.
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
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("heading", { level: 1, name: "Print kit" })).toBeVisible();
}

/** The sheets on screen that would be printed: keys and which way up. */
async function visiblePages(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("#pk-pages .pk-page")]
      .filter((p) => getComputedStyle(p).display !== "none")
      .map((p) => ({ key: p.dataset.key ?? "", doc: p.dataset.doc ?? "", landscape: p.classList.contains("pk-landscape") })),
  );
}

/** Every page's body, and every name cell, measured for anything running off it. */
async function overflows(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const p of document.querySelectorAll<HTMLElement>("#pk-pages .pk-page")) {
      if (getComputedStyle(p).display === "none") continue;
      const b = p.querySelector<HTMLElement>(".pk-body")!;
      if (b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1) out.push(`${p.dataset.key}: page ${b.scrollWidth}x${b.scrollHeight} in ${b.clientWidth}x${b.clientHeight}`);
      for (const cell of p.querySelectorAll<HTMLElement>("td, .pk-pname, .pk-big")) {
        if (cell.scrollWidth > cell.clientWidth + 1) out.push(`${p.dataset.key}: "${(cell.textContent ?? "").slice(0, 40)}" ${cell.scrollWidth}>${cell.clientWidth}`);
      }
    }
    return out;
  });
}

/** Every piece of text on the printed pages, one string per text node, round codes left out. */
async function printedTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.getElementById("pk-pages")!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      if (el.closest("style, [data-code]")) continue;
      const page = el.closest<HTMLElement>(".pk-page");
      if (!page || getComputedStyle(page).display === "none") continue;
      if (n.textContent?.trim()) out.push(n.textContent);
    }
    return out;
  });
}

/** Each QR drawn on a visible page, rasterised and read back by a decoder. */
async function decodeQrs(page: Page): Promise<Array<{ drawn: string; read: string | null }>> {
  const images = await page.evaluate(async () => {
    const out: Array<{ drawn: string; w: number; h: number; data: number[] }> = [];
    for (const svg of document.querySelectorAll<SVGSVGElement>("#pk-pages svg.pk-qr")) {
      const p = svg.closest<HTMLElement>(".pk-page");
      if (!p || getComputedStyle(p).display === "none") continue;
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

test("the Stableford's paper: one sheet each, readable, nothing it must not carry, every QR to /play", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  await as(page, baseURL!, "sf");
  await open(page, `/print?round=${f.sf.stageId}`);

  // The checklist: a card per player, a sign per group, the spare, two starting sheets.
  const n = f.sf.players.length;
  await expect(page.getByText(`one per player · ${n} sheets`)).toBeVisible();
  await expect(page.getByText(`one per group · ${f.sf.groups} sheets`)).toBeVisible();
  const pages = await visiblePages(page);
  expect(pages.filter((p) => p.doc === "cards")).toHaveLength(n);
  expect(pages.filter((p) => p.doc === "signs")).toHaveLength(f.sf.groups);
  expect(pages.filter((p) => p.doc === "spare")).toHaveLength(1);
  expect(pages.filter((p) => p.doc === "start")).toHaveLength(2);
  expect(pages.filter((p) => p.doc === "group-cards"), "the old group card is not ticked unless asked for").toHaveLength(0);

  // The long name is on its card, its sign and the starting sheet, inside every box.
  const longCard = page.locator(`#pk-pages .pk-page[data-doc="cards"]`).filter({ hasText: LONG_NAME });
  await expect(longCard).toHaveCount(1);
  await expect(page.locator(`#pk-pages .pk-page[data-doc="signs"]`).filter({ hasText: LONG_NAME })).toHaveCount(1);
  expect(await overflows(page)).toEqual([]);

  // A shotgun: every card and sign says the hole it starts on, large.
  await expect(longCard.locator(".startBig")).toContainText(/Start: hole \d+/);
  // A Stableford card has its points row, for the Committee.
  await expect(longCard).toContainText("Points — for Committee use");
  // The member whose index nobody has claimed is "to be confirmed", never a nought.
  await expect(page.locator(`#pk-pages .pk-page[data-doc="cards"]`).filter({ hasText: "Unity Unclaimed" })).toContainText("Handicap to be confirmed by the Committee");

  // Never on paper, read off every text on every page.
  const texts = await printedTexts(page);
  expect(texts.length, "CONTROL: the sweep read no text").toBeGreaterThan(200);
  expect(paperRefusals(texts)).toEqual([]);
  // CONTROL: the same collection sees an address put on a page.
  await page.evaluate(() => {
    const s = document.createElement("span");
    s.textContent = "ann@example.invalid";
    document.querySelector("#pk-pages .pk-page .pk-body")!.appendChild(s);
  });
  expect(paperRefusals(await printedTexts(page)).length).toBe(1);
  await page.evaluate(() => document.querySelector("#pk-pages .pk-page .pk-body span:last-child")?.remove());

  // The TourneyHQ line goes to /play, never the front door, and only in the footer.
  const brand = page.locator("#pk-pages .pk-page .pk-brand");
  expect(await brand.count()).toBe(await page.locator("#pk-pages .pk-page").count());
  await expect(brand.first()).toHaveText(/Scored live with TourneyHQ · .+\/play$/);

  // Every QR reads back to exactly the round's /play#CODE.
  const origin = new URL(baseURL!).origin;
  const code = `${f.sf.code.slice(0, 4)}-${f.sf.code.slice(4)}`;
  const qrs = await decodeQrs(page);
  expect(qrs.length, "one per cart sign and the spare").toBe(f.sf.groups + 1);
  for (const q of qrs) {
    expect(q.read, "a QR did not decode").toBe(`${origin}/play#${code}`);
    expect(q.drawn).toBe(q.read);
  }

  // The PDF: one page per sheet, cards on their side, the rest upright — at A4…
  const a4 = await pdfPages(page);
  expect(a4).toHaveLength(pages.length);
  expect(a4.filter((p) => p.w === 842 && p.h === 595)).toHaveLength(n);
  expect(a4.filter((p) => p.w === 595 && p.h === 842)).toHaveLength(pages.length - n);
  // …and at US Letter.
  await page.getByRole("radio", { name: "US Letter" }).check();
  expect(await overflows(page), "something runs off a Letter page").toEqual([]);
  const letter = await pdfPages(page);
  expect(letter).toHaveLength(pages.length);
  expect(letter.filter((p) => p.w === 792 && p.h === 612)).toHaveLength(n);
  expect(letter.filter((p) => p.w === 612 && p.h === 792)).toHaveLength(pages.length - n);
  await page.getByRole("radio", { name: "A4" }).check();

  expect(errors, "a screen threw").toEqual([]);
});

test("printing stamps the sheets; a moved group and a reissued code ask for just those sheets again", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  await as(page, baseURL!, "sf");
  await open(page, `/print?round=${f.sf.stageId}`);
  const ticked = (await visiblePages(page)).length;

  // The press records what went to the printer, and each footer says when — on the club's clock.
  const before = new Date();
  await page.getByRole("button", { name: /^Print the ticked sheets/ }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  const after = new Date();
  const zone = f.zone;
  const days = new Set([formatDayAt(before, "en-US", zone), formatDayAt(after, "en-US", zone)]);
  const stamp = (await page.locator("#pk-pages .pk-page .pk-stamp").first().innerText()).trim();
  expect(stamp).toMatch(/^Printed \d{1,2}:\d{2}( [AP]M)?, .+ · version 1 · groups as of /);
  expect([...days].some((d) => stamp.includes(`, ${d} ·`)), `"${stamp}" is not today at the club (${[...days].join(" or ")}, ${zone})`).toBe(true);

  await open(page, `/print?round=${f.sf.stageId}`);
  await expect(page.getByText("Not printed yet")).toHaveCount(1); // only the unticked group cards
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
  // Their two cards, the two groups' cart signs, and both copies of the starting sheet.
  const banner = page.getByRole("status").filter({ hasText: "out of date" });
  await expect(banner).toContainText(staleSentence(6));
  await expect(banner).toContainText("Group 1 — cart sign");
  await expect(banner).toContainText("Group 2 — cart sign");
  // The Tee sheet says so too.
  await page.goto(`/foursomes?round=${f.sf.stageId}&bust=${Date.now()}`);
  await expect(page.getByRole("status").filter({ hasText: staleSentence(6) })).toBeVisible();
  await page.getByRole("link", { name: /Reprint them in the Print kit/ }).click();
  await page.waitForLoadState("networkidle").catch(() => {});

  // "Reprint these" prints those six and nothing else.
  await page.getByRole("button", { name: "Reprint these" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  const reprinted = await visiblePages(page);
  expect(reprinted).toHaveLength(6);
  expect((await pdfPages(page)).length).toBe(6);
  await expect(page.locator(`#pk-pages .pk-page[data-key="signs:Group 1"] .pk-stamp`)).toContainText("version 2");

  await open(page, `/print?round=${f.sf.stageId}`);
  await expect(page.getByRole("status").filter({ hasText: "out of date" })).toHaveCount(0);
  expect((await visiblePages(page)).length).toBe(ticked);

  // A reissued code: the old sign's code is refused by the app, and every sheet carrying it is flagged.
  await prisma.stage.update({ where: { id: f.sf.stageId }, data: { accessCode: "ZZPW2346" } });
  try {
    await open(page, `/print?round=${f.sf.stageId}`);
    await expect(page.getByRole("status").filter({ hasText: "out of date" })).toContainText(staleSentence(f.sf.groups + 1));
    await expect(page.getByRole("status").filter({ hasText: "out of date" })).toContainText("spare sign");
  } finally {
    await prisma.stage.update({ where: { id: f.sf.stageId }, data: { accessCode: f.sf.code } });
  }
  expect(errors, "a screen threw").toEqual([]);
});

test("the team cup: one card per match with both nines on it, and a sign per match carrying both codes", async ({ page, baseURL }) => {
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

  const pages = await visiblePages(page);
  const cards = pages.filter((p) => p.doc === "cup");
  expect(cards).toHaveLength(5);
  expect(cards.every((p) => p.landscape)).toBe(true);
  expect(pages.filter((p) => p.doc === "signs")).toHaveLength(5);
  const first = page.locator(`#pk-pages .pk-page[data-doc="cup"]`).first();
  await expect(first).toContainText("holes 10–18");
  await expect(first).toContainText("holes 1–9");
  await expect(first).toContainText("better ball");
  expect(await overflows(page)).toEqual([]);

  // Both codes on every sign, each QR read back to its own round.
  const origin = new URL(baseURL!).origin;
  const want = new Set(f.cup.codes.map((c) => `${origin}/play#${c.slice(0, 4)}-${c.slice(4)}`));
  const qrs = await decodeQrs(page);
  expect(qrs.length).toBe(10 + 1);
  for (const q of qrs) {
    expect(want.has(q.read ?? ""), `${q.read} is not one of the cup's rounds`).toBe(true);
    expect(q.drawn).toBe(q.read);
  }
  expect(paperRefusals(await printedTexts(page))).toEqual([]);
  expect((await pdfPages(page)).length).toBe(pages.length);

  // The singles session says its card is printed with the four-balls.
  await open(page, `/print?round=${f.cup.singles}`);
  await expect(page.getByText(/Printed with Four-balls — back nine/).first()).toBeVisible();
  expect(errors, "a screen threw").toEqual([]);
});
