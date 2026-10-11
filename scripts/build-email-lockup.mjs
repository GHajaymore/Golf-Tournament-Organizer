/**
 * Re-photograph the TourneyHQ lockup that every email carries.
 *
 * Gmail drops SVG, so `public/email/tourneyhq-lockup.png` is a picture of the
 * real lockup — and a picture goes stale the day the mark changes. It did on
 * 2026-10-10, when the ball moved to the India-flag green and the emails kept
 * the old one. This takes the picture again from a page that draws the lockup,
 * so the two cannot drift by hand.
 *
 * KNOWN, AND NOT FIXED HERE: this photographs the lockup as a DARK page draws
 * it — a near-white flagstick and the lighter wordmark — and an email is a
 * light page, so the flagstick is faint on the email's paper. That was true of
 * the picture this replaces too (#765). The cure is a page that draws the
 * lockup on the light ground with no club behind it, which does not exist
 * yet; it is in docs/sweeps-2026-10-10.md under emails.
 *
 * It needs a BUILT server showing the code you are about to commit:
 *
 *     NEXT_DIST_DIR=.next-ci npx next build
 *     NEXT_DIST_DIR=.next-ci npx next start --port 3102     # in another shell
 *     node scripts/build-email-lockup.mjs                   # LOCKUP_BASE_URL to point elsewhere
 *
 * No sign-in and no database: it uses the "page not found" screen, which is
 * public and carries the lockup. The background is left transparent.
 */
import { statSync } from "node:fs";
import sharp from "sharp";

const BASE = process.env.LOCKUP_BASE_URL ?? "http://127.0.0.1:3102";
const OUT = "public/email/tourneyhq-lockup.png";
/** The box `email-layout.ts` prints it in (LOCKUP_W x LOCKUP_H); the file is twice that. */
const BOX = { width: 182, height: 44 };

async function main() {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    // First at 1x, to learn how big the page draws it; then at the scale that
    // makes the picture twice the email's box.
    const probe = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const find = async (context) => {
      const page = await context.newPage();
      await page.goto(BASE + "/no-such-page-for-the-lockup", { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      // The nearest box round the wordmark that also holds the mark's drawing.
      const lockup = page.locator(".brand-mark").first().locator("xpath=ancestor::*[.//*[local-name()='svg']][1]");
      const box = await lockup.boundingBox();
      if (!box) throw new Error(`no lockup on ${BASE}/no-such-page-for-the-lockup`);
      return { page, lockup, box };
    };
    const first = await find(probe);
    const scale = Math.min((BOX.width * 2) / first.box.width, (BOX.height * 2) / first.box.height);
    await probe.close();

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: scale });
    const { page, lockup } = await find(context);
    // Nothing behind it: the email's own paper shows through.
    await page.evaluate(() => {
      for (const el of document.querySelectorAll("html, body, body *")) {
        if (el instanceof HTMLElement && !el.closest("svg") && !el.classList.contains("brand-mark") && !el.closest(".brand-mark")) {
          const chip = el.textContent?.trim() === "HQ" && el.children.length === 0;
          if (!chip) el.style.setProperty("background", "transparent", "important");
        }
      }
    });
    const shot = await lockup.screenshot({ omitBackground: true });
    const meta = await sharp(shot).metadata();
    // Centred on a transparent canvas of exactly twice the email's box.
    await sharp({ create: { width: BOX.width * 2, height: BOX.height * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp(shot).resize({ width: Math.min(meta.width, BOX.width * 2), height: Math.min(meta.height, BOX.height * 2), fit: "inside" }).toBuffer(), gravity: "west" }])
      .png()
      .toFile(OUT);
    console.log(`wrote ${OUT}: drawn ${Math.round(first.box.width)}x${Math.round(first.box.height)}, photographed at ${scale.toFixed(2)}x, ${Math.round(statSync(OUT).size / 1024)} KB`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
