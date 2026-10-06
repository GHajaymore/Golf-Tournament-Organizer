import { test, expect } from "@playwright/test";
import { join } from "node:path";

/**
 * EVENT SETUP, SAID SHORT — step B of the organizer cleanup (Ajay, 2026-10-05).
 *
 * The shared fixture's tournament is launched and has four rounds, which is
 * the screen an organizer comes back to mid-season: setup finished, a setting
 * to check or change.
 */
test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

test("a launched tournament's setup reads short, and every explanation is one tap away", async ({ page }) => {
  await page.goto(`/event?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
  const main = page.locator("main");

  // The checklist is one line once launched, its rows a tap away.
  const checklist = main.getByText(/^Setup checklist · \d+ of \d+ done$/);
  await expect(checklist).toBeVisible();
  await checklist.click();
  await expect(main.getByText("Tournament details", { exact: true }).first()).toBeVisible();

  // An option is its name; its explanation opens from its own ⓘ — and lands
  // inside the screen, on a phone as on a desktop.
  await expect(main.getByText(/A blind event/)).toHaveCount(0);
  const info = main.getByRole("button", { name: "More about Organizers only" });
  await info.scrollIntoViewIfNeeded();
  // EVERY FRAME from the tap, not one read after it is visible: a single read
  // passed or failed by when it landed (CI saw 324 against 321 twice). Each
  // frame must sit where the rule puts it — centred under its icon, slid just
  // inside an 8px margin when that would run off — so a first frame drawn
  // unplaced fails, and so does a panel that comes to rest overshot.
  const frames = await info.evaluate(async (btn: HTMLElement) => {
    btn.click();
    const out: { left: number; right: number; expected: number }[] = [];
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const p = btn.parentElement?.querySelector<HTMLElement>(".field-info-panel");
      if (!p) continue;
      const r = p.getBoundingClientRect();
      const a = btn.parentElement!.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const centred = a.left + a.width / 2 - r.width / 2;
      out.push({ left: r.left, right: r.right, expected: Math.max(8, Math.min(centred, vw - 8 - r.width)) });
    }
    return out;
  });
  const panel = main.getByRole("note").filter({ hasText: /A blind event/ });
  await expect(panel).toBeVisible();
  const width = page.viewportSize()!.width;
  expect(frames.length, "the explanation never opened").toBeGreaterThan(0);
  for (const f of frames) {
    expect(f.left, "the explanation starts off the left edge").toBeGreaterThanOrEqual(0);
    expect(f.right, "the explanation runs off the right edge").toBeLessThanOrEqual(width + 1);
    expect(Math.abs(f.left - f.expected), `the explanation sits at ${f.left}, not ${f.expected}`).toBeLessThanOrEqual(1);
  }

  // Four rounds: there is a next week, so weekly sign-up is still asked.
  await expect(main.getByText("Weekly sign-up", { exact: true })).toBeVisible();
});
