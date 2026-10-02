import { expect, test, type Page } from "@playwright/test";

/**
 * EVERY WORD ON THE FRONT DOOR IS READABLE AGAINST WHAT IS ACTUALLY BEHIND IT.
 *
 * `legible.spec` grades the app by walking up to the first opaque background
 * colour, which is right for the app and wrong here: the front door puts words
 * on radial gradients, on dark stages and next to screenshots, where the colour
 * a stylesheet declares is not the colour the eye gets. Measured that way the
 * showcase's light notes would "fail" against a white the reader never sees.
 *
 * So this asks the screen. The page is photographed twice — once as it is, once
 * with every letter made transparent — and each piece of text is graded against
 * the PIXELS behind it: its own colour, composited through every faded ancestor,
 * over each pixel of its box, taking the 10th-percentile ratio so a thin rule or
 * one antialiased edge cannot pass or fail it alone. The floor is WCAG's: 4.5,
 * or 3 for type 24px and up (18.66px bold).
 *
 * The same two photographs catch the other fault, and it is the one that started
 * this (2026-09-30): at 1280px and wider the hero's laptop screen ran 50px down
 * over "Every picture on this page is an unedited screen of the app" and nothing
 * noticed, because no test asked what was painted ON a sentence. Text partly
 * under a picture now grades against the picture; text wholly under something
 * is not painted at all, and is reported as covered.
 *
 * Its first run found, besides: the three format boards' titles painted
 * near-white on white (1.02:1 — the app's own figcaption rule leaking in), and
 * at 2.9–3.7:1 the format filter's counts, the plan names on the comparison's
 * orange head, and the "2 months free" badge.
 */
/**
 * At one device pixel per CSS pixel: contrast does not depend on density, and
 * at a phone's 2.75x the full-length page passes what Chromium will composite
 * in one capture, so the footer came back blank and read as "covered".
 */
test.use({ storageState: { cookies: [], origins: [] }, deviceScaleFactor: 1 });

interface Unreadable {
  text: string;
  ratio: number;
  floor: number;
  size: number;
  at: string;
  where: string;
}

/** Rise every section, load every lazy picture, and stand at the top. */
async function settle(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status(), `${path} did not render`).toBeLessThan(400);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    document.querySelectorAll(".reveal").forEach((e) => e.classList.add("seen"));
    document.querySelectorAll<HTMLImageElement>("img[loading=lazy]").forEach((i) => (i.loading = "eager"));
  });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => undefined))));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

async function unreadableText(page: Page): Promise<Unreadable[]> {
  /**
   * Photographed in TALL VIEWPORT SLICES, scrolled down the page. Chromium
   * composites at most 16,384px in one capture, and a phone-width front door is
   * taller than that: a single full-page photograph came back blank past that
   * line — with or without a clip — and the whole footer read as "covered".
   * The window is made 3,000px tall so every text box fits in a slice, and the
   * sticky bars are set in place, so they stay where they sit in the page
   * instead of riding down over whatever each slice starts on.
   */
  const { width } = page.viewportSize()!;
  await page.setViewportSize({ width, height: 3000 });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const cs = getComputedStyle(el);
      if ((cs.position === "sticky" || cs.position === "fixed") && cs.top !== "auto") el.style.position = "relative";
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(200);

  // What to grade, in page coordinates, read before anything is hidden.
  await page.evaluate(() => {
    type Item = { text: string; color: string; opacity: number; size: number; weight: number; x: number; y: number; w: number; h: number; where: string };
    const items: Item[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = (node.textContent ?? "").trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      // Not for the eye: screen-reader text, the marquee's second copy.
      if (el.closest(".sr, [aria-hidden='true'], script, style, noscript, template")) continue;
      // Inside a closed <details>: Chromium reports a box for it anyway.
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      // WCAG 1.4.3: an inactive control has no contrast requirement.
      if (el.closest("[disabled], [aria-disabled='true'], :disabled")) continue;

      const range = document.createRange();
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
      // Clipped by a scroller (the comparison on a phone, the showcase rail):
      // grade only the part in view; the rest is reached by scrolling it.
      for (let a = el.parentElement; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
        const c = a.getBoundingClientRect();
        x0 = Math.max(x0, c.left); y0 = Math.max(y0, c.top); x1 = Math.min(x1, c.right); y1 = Math.min(y1, c.bottom);
      }
      // Mostly scrolled out of its rail: a sliver of centred text can be all
      // margin, which would read as "not painted". It is graded where it shows.
      if (x1 - x0 < 0.6 * r.width || y1 - y0 < 0.6 * r.height) continue;

      let opacity = 1;
      for (let a: Element | null = el; a; a = a.parentElement) opacity *= Number(getComputedStyle(a).opacity);
      const cs = getComputedStyle(el);
      const where: string[] = [];
      for (let n: Element | null = el; n && where.length < 3; n = n.parentElement) {
        where.push(n.tagName.toLowerCase() + (typeof n.className === "string" && n.className ? `.${n.className.split(" ")[0]}` : ""));
      }
      items.push({
        text: text.slice(0, 40), color: cs.color, opacity, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight),
        x: x0 + scrollX, y: y0 + scrollY, w: x1 - x0, h: y1 - y0, where: where.join(" < "),
      });
    }
    (window as unknown as { __items: Item[] }).__items = items;
  });

  const hide =
    "*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; }";
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const out: Unreadable[] = [];
  for (let want = 0; ; want += 2000) {
    const top = await page.evaluate((y) => { window.scrollTo(0, y); return window.scrollY; }, want);
    await page.waitForTimeout(60);
    const painted = (await page.screenshot({ scale: "css" })).toString("base64");
    const style = await page.addStyleTag({ content: hide });
    await page.waitForTimeout(60);
    const bare = (await page.screenshot({ scale: "css" })).toString("base64");
    await style.evaluate((s) => (s as Element).remove());
    out.push(...(await gradeSlice(page, painted, bare, top, 3000)));
    if (top + 3000 >= height) break;
  }
  // Nothing skipped in silence: a box too tall for any slice is a finding too.
  const missed = await page.evaluate(() =>
    (window as unknown as { __items: { text: string; done?: boolean; y: number; size: number; where: string }[] }).__items.filter((i) => !i.done),
  );
  for (const m of missed) out.push({ text: m.text, ratio: 0, floor: 0, size: m.size, at: `y${Math.round(m.y)}`, where: `NOT PHOTOGRAPHED; ${m.where}` });
  return out;
}

/** Grade the text that lies wholly inside one slice, and mark it graded. */
function gradeSlice(page: Page, painted: string, bare: string, top: number, sliceHeight: number): Promise<Unreadable[]> {
  return page.evaluate(
    async ({ painted, bare, top, sliceHeight }) => {
      type Item = { text: string; color: string; opacity: number; size: number; weight: number; x: number; y: number; w: number; h: number; where: string; done?: boolean };
      const items = (window as unknown as { __items: Item[] }).__items;
      const pixels = async (b64: string) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        const cx = cv.getContext("2d", { willReadFrequently: true })!;
        cx.drawImage(bmp, 0, 0);
        return { data: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
      };
      const [on, off] = [await pixels(painted), await pixels(bare)];
      // CSS-scale photographs: one image pixel per CSS pixel.
      const k = on.w / document.documentElement.clientWidth;

      // The browser decodes the colour (it may be `color(srgb …)` from color-mix).
      const cv = new OffscreenCanvas(1, 1);
      const c1 = cv.getContext("2d", { willReadFrequently: true })!;
      const rgba = (c: string) => { c1.clearRect(0, 0, 1, 1); c1.fillStyle = c; c1.fillRect(0, 0, 1, 1); const d = c1.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
      const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

      const out: { text: string; ratio: number; floor: number; size: number; at: string; where: string }[] = [];
      for (const it of items) {
        if (it.done || it.y < top || it.y + it.h > top + sliceHeight) continue;
        it.done = true;
        const [fr, fg, fb, fa] = rgba(it.color);
        const a = fa * it.opacity;
        if (a < 0.05) continue; // deliberately invisible
        const floor = it.size >= 24 || (it.size >= 18.66 && it.weight >= 700) ? 3 : 4.5;
        const x0 = Math.max(0, Math.round(it.x * k)), y0 = Math.max(0, Math.round((it.y - top) * k));
        const x1 = Math.min(on.w - 1, Math.round((it.x + it.w) * k)), y1 = Math.min(on.h - 1, Math.round((it.y + it.h - top) * k));
        const ratios: number[] = [];
        let changed = 0;
        const step = Math.max(1, Math.round(k / 2));
        for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
          const i = (y * on.w + x) * 4;
          const [br, bg, bb] = [off.data[i], off.data[i + 1], off.data[i + 2]];
          if (Math.abs(on.data[i] - br) + Math.abs(on.data[i + 1] - bg) + Math.abs(on.data[i + 2] - bb) > 24) changed++;
          const L1 = lum(fr * a + br * (1 - a), fg * a + bg * (1 - a), fb * a + bb * (1 - a));
          const L2 = lum(br, bg, bb);
          ratios.push((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05));
        }
        if (!ratios.length) continue;
        const at = `${Math.round(it.x)},${Math.round(it.y)}`;
        if (changed / ratios.length < 0.01) {
          out.push({ text: it.text, ratio: 0, floor, size: Math.round(it.size), at, where: `COVERED — not painted; ${it.where}` });
          continue;
        }
        ratios.sort((p, q) => p - q);
        const p10 = ratios[Math.floor(ratios.length * 0.1)];
        if (p10 < floor) out.push({ text: it.text, ratio: Math.round(p10 * 100) / 100, floor, size: Math.round(it.size), at, where: it.where });
      }
      return out;
    },
    { painted, bare, top, sliceHeight },
  );
}

/**
 * The instrument, proved both ways before its zeros count: grey on white must
 * be caught, a sentence under an opaque card must be reported as covered, and
 * a legible line in `color()` syntax must not be flagged.
 */
test("the measurement sees faint text and covered text, and passes good text", async ({ page }) => {
  await settle(page, "/faq");
  await page.evaluate(() => {
    const host = document.querySelector("main") ?? document.body;
    const add = (html: string) => { const d = document.createElement("div"); d.innerHTML = html; host.prepend(d); };
    add('<p style="color:#cfcfcf;background:#fff;font-size:14px;padding:6px">zz-faint grey on white</p>');
    add('<div style="position:relative;padding:6px;background:#fff"><p style="color:#111;font-size:14px">zz-covered sentence</p><div style="position:absolute;inset:0;background:#357"></div></div>');
    add('<p style="color:color(srgb 0.07 0.07 0.09);background:color(srgb 1 1 1);font-size:14px;padding:6px">zz-legible in color syntax</p>');
  });
  const found = await unreadableText(page);
  expect(found.filter((f) => f.text.startsWith("zz-faint")).length, "cannot see grey on white").toBe(1);
  expect(found.filter((f) => f.text.startsWith("zz-covered") && f.where.startsWith("COVERED")).length, "cannot see covered text").toBe(1);
  expect(found.filter((f) => f.text.startsWith("zz-legible")), "misreads color() syntax").toEqual([]);
});

for (const path of ["/", "/faq", "/privacy", "/terms"]) {
  test(`every word on ${path} is readable against what is behind it`, async ({ page }) => {
    await settle(page, path);
    const bad = await unreadableText(page);
    expect(bad, bad.map((b) => `${b.ratio} < ${b.floor} "${b.text}" ${b.size}px at ${b.at} — ${b.where}`).join("\n")).toEqual([]);
  });
}
