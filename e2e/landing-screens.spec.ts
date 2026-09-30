import { expect, test } from "@playwright/test";

/**
 * EVERY SCREENSHOT ON THE FRONT DOOR IS SHARP, WHOLE AND STILL.
 *
 * The landing's pictures are unedited captures of the app, and three kinds of
 * fault made them look worse than the app itself — each found by Ajay's eye
 * before any test (2026-09-29), which is what this file is here to end:
 *
 *  - SOFT: a capture exported at 600px drawn 302px wide on a 2x laptop has too
 *    few pixels, and the browser stretches it. Every image must carry at least
 *    two device pixels per CSS pixel (retina laptops), and at least the
 *    device's own ratio on a phone.
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

test("every screenshot on the front door is sharp, whole and still", async ({ page }) => {
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

  const faults = await page.evaluate(() => {
    const dpr = Math.max(2, window.devicePixelRatio);
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
      const density = img.naturalWidth / box.width;
      if (density < dpr - 0.05) out.push(`${name}: soft — ${density.toFixed(2)} px per CSS px, needs ${dpr}`);
      const natural = img.naturalHeight / img.naturalWidth;
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
});
