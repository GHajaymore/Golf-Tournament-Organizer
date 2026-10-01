import { expect, test } from "@playwright/test";

/**
 * EVERY SCREENSHOT ON THE FRONT DOOR IS SHARP, WHOLE AND STILL.
 *
 * The landing's pictures are unedited captures of the app, and three kinds of
 * fault made them look worse than the app itself — each found by Ajay's eye
 * before any test (2026-09-29), which is what this file is here to end:
 *
 *  - SOFT: a capture exported at 600px drawn 302px wide on a 2x laptop has too
 *    few pixels, and the browser stretches it. Every image must give the
 *    screen at least its own pixel ratio, and — since the pre-sharpened
 *    srcset copies of 2026-09-30 let a 1x screen take a smaller file — offer
 *    a copy with at least two device pixels per CSS pixel for retina laptops.
 *  - CUT or STRETCHED: an image shown at a different shape from the capture is
 *    either cropped by its box or distorted. Shown and natural aspect must agree.
 *  - BLURRED BY MOTION: a screenshot turned in 3D, or floated by an animation,
 *    is resampled by the browser every frame and its text goes soft. No image
 *    may sit under a rotating/3D transform or a running animation.
 *
 * Measured signed out (the front door is what a visitor sees) and with motion
 * ALLOWED, because the project default of reduced motion would hide exactly the
 * animation this is looking for. Every lazy image is scrolled into view first.
 */
test.use({ storageState: { cookies: [], origins: [] }, contextOptions: { reducedMotion: "no-preference" } });

async function sharpWholeStill(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".thq h1")).toHaveCount(1);

  // Rise every section and walk the page so lazy images load.
  await page.evaluate(() => document.querySelectorAll(".reveal").forEach((e) => e.classList.add("seen")));
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 400) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(60);
  }
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);

  const faults = await page.evaluate(async () => {
    const dpr = window.devicePixelRatio;
    /**
     * The FILE's pixels. With a srcset, an <img>'s naturalWidth is not the file's
     * width: the browser divides it by the density it picked, so a 1170px copy
     * chosen for a 330px slot reports 330 — and a guard reading it measures its
     * own `sizes`, not the picture (the first run of the srcset read "1.18x" for
     * a 3.5x image). A bare Image of the chosen file reports what is really there.
     */
    const fileSize = (src: string) =>
      new Promise<[number, number]>((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve([probe.naturalWidth, probe.naturalHeight]);
        probe.onerror = () => resolve([0, 0]);
        probe.src = src;
      });
    const out: string[] = [];
    const moving = (el: Element) => el.getAnimations().some((a) => a.playState === "running");
    const turned = (t: string) => {
      if (!t || t === "none") return false;
      if (t.startsWith("matrix3d")) return true; // perspective / rotateX|Y
      const m = t.match(/^matrix\(([^)]+)\)$/);
      if (!m) return false;
      const [a, b, c, d] = m[1].split(",").map(Number);
      return Math.abs(b) > 1e-3 || Math.abs(c) > 1e-3 || Math.abs(a - 1) > 1e-3 || Math.abs(d - 1) > 1e-3;
    };
    for (const img of Array.from(document.querySelectorAll<HTMLImageElement>(".thq img"))) {
      const box = img.getBoundingClientRect();
      if (box.width < 80 || !img.naturalWidth) continue; // hidden tabs, icons, not yet loaded
      const name = (img.currentSrc || img.src).split("/").pop();
      const [fileW, fileH] = await fileSize(img.currentSrc || img.src);
      const density = fileW / box.width;
      if (density < dpr - 0.05) out.push(`${name}: soft — ${density.toFixed(2)} px per CSS px, needs ${dpr}`);
      // What a retina laptop would be given (2026-09-30): a srcset lets a 1x screen take a
      // smaller copy, so the largest copy on offer must still carry 2x at this width.
      const [srcW] = await fileSize(img.src);
      const offered = Math.max(srcW, ...(img.srcset || "").split(",").map((c) => parseInt(c.trim().split(/\s+/)[1] || "0", 10)).filter((n) => n > 0));
      if (offered / box.width < 1.95) out.push(`${name}: no 2x copy — largest ${offered}px for ${Math.round(box.width)} CSS px`);
      const natural = fileH / fileW;
      const shown = box.height / box.width;
      if (Math.abs(natural - shown) / natural > 0.02) out.push(`${name}: cut or stretched — shown ${shown.toFixed(3)}, capture ${natural.toFixed(3)}`);
      for (let el: Element | null = img; el && el !== document.body; el = el.parentElement) {
        const cs = getComputedStyle(el);
        const label = `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`;
        if (turned(cs.transform) || (cs.rotate !== "none" && cs.rotate !== "0deg") || cs.perspective !== "none") out.push(`${name}: turned by ${label} (${cs.transform})`);
        if (moving(el)) out.push(`${name}: animated by ${label}`);
      }
    }
    return Array.from(new Set(out));
  });

  expect(faults, faults.join("\n")).toEqual([]);
}

test("every screenshot on the front door is sharp, whole and still", async ({ page }) => {
  await sharpWholeStill(page);
});

/**
 * And on a tablet, measured separately: an iPad sits between the phone and
 * desktop layouts, so a section can stack to one column and stretch a
 * phone-width capture past its natural size — the prizes card did, to 1.72x
 * on an iPad at 2x, while the three projects above all passed (2026-09-30).
 */
test.describe("on an iPad", () => {
  test.use({ viewport: { width: 810, height: 1080 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  test("every screenshot on the front door is sharp, whole and still", async ({ page }) => {
    await sharpWholeStill(page);
  });
});

/**
 * THE LIGHT-VS-DARK SLIDER SHOWS ITS SCREEN (2026-09-30). When it went to one
 * screen its tab row was removed, but the rule that reveals the frame still
 * waited on that tab, so the section showed two buttons over empty space — for
 * a day, unnoticed, because every check above skips images that are hidden.
 * Both appearances must be on screen, loaded, with the drag handle over them.
 */
test("the light-vs-dark slider shows the real screen, both appearances", async ({ page }) => {
  await page.goto("/");
  await page.locator("#yours").scrollIntoViewIfNeeded();
  const frame = page.locator('.cmp-f[data-f="ap-card"]');
  await expect(frame).toBeVisible();
  await frame.locator("img").last().scrollIntoViewIfNeeded();
  const shown = await frame.evaluate(async (f) => {
    const imgs = [...f.querySelectorAll("img")];
    await Promise.all(imgs.map((i) => i.decode().catch(() => undefined)));
    return imgs.map((i) => ({ src: (i.currentSrc || i.src).split("/").pop(), w: Math.round(i.getBoundingClientRect().width), loaded: i.complete && i.naturalWidth > 0 }));
  });
  expect(shown.map((i) => i.src).join(" "), "not one light and one dark capture").toMatch(/light.*dark/);
  for (const i of shown) expect(i.loaded && i.w > 150, `${i.src} not shown (${i.w}px)`).toBe(true);
  await expect(frame.locator(".cmp-range")).toBeVisible();
});
