import { expect, test } from "./coverage";
import { landingSettled } from "./landing-settled";

/**
 * THE WEEK NEVER HOLDS THE PAGE STILL (backlog B35; "Landing story section - redesign spec", 2026-11-01).
 *
 * Ajay, 30 Oct: "I did like the clickstop for showing multiple screens, however it's confusing and my
 * friends just stopped there without scrolling down." On a phone the old story pinned the page for about
 * five screens: a thumb scrolled and nothing moved. It is now a stepper in the page's own flow. These
 * are the spec's tests 1, 3 and 4, in the shape a visitor meets them:
 *
 *   - a visitor who only scrolls reaches the prices and the early list, and EVERY flick moves the page
 *     (the section's top moves exactly as far as the page does — nothing in it holds still);
 *   - the week costs at most one and a half screens of scrolling;
 *   - nothing inside it is sticky or fixed;
 *   - › moves to "2 of 7" and changes the screen; ‹ › are 48px and nothing covers them.
 *
 * CONTROL: the flick check is only believed because it measures the section's own top against the
 * scroll: under the old pin the top stopped moving while the page scrolled, which this would report.
 */
test.use({ storageState: { cookies: [], origins: [] }, contextOptions: { reducedMotion: "reduce" } });

test("a visitor who only scrolls goes past the week to the prices and the early list", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await landingSettled(page);
  const vh = page.viewportSize()!.height;
  const round = await page.evaluate(() => document.querySelector("#round")!.getBoundingClientRect().height);
  const stepper = await page.evaluate(() => document.querySelector("#story")!.getBoundingClientRect().height);
  expect(stepper, `the week's stepper is ${Math.round(stepper)}px tall on a ${vh}px screen`).toBeLessThanOrEqual(vh * 1.5);

  const sticky = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#round *")).filter((el) => ["sticky", "fixed"].includes(getComputedStyle(el).position)).map((el) => el.className),
  );
  expect(sticky, "something in the week sticks while the page scrolls").toEqual([]);

  const flick = Math.round(vh * 0.85);
  let flicks = 0;
  const stuck: string[] = [];
  for (;;) {
    const before = await page.evaluate(() => ({ y: window.scrollY, top: document.querySelector("#round")!.getBoundingClientRect().top, max: document.documentElement.scrollHeight - window.innerHeight, pricing: document.querySelector("#pricing")!.getBoundingClientRect().top, start: document.querySelector("#start")!.getBoundingClientRect().top }));
    if (before.start < vh * 0.8 || before.y >= before.max - 2) break;
    await page.mouse.wheel(0, flick);
    await page.waitForTimeout(250);
    flicks += 1;
    const after = await page.evaluate(() => ({ y: window.scrollY, top: document.querySelector("#round")!.getBoundingClientRect().top }));
    const moved = after.y - before.y;
    if (moved < flick * 0.8 && after.y < before.max - 2) stuck.push(`flick ${flicks}: the page moved ${moved}px`);
    if (Math.abs(before.top - after.top - moved) > 2) stuck.push(`flick ${flicks}: the page moved ${moved}px but the week moved ${before.top - after.top}px`);
    expect(flicks, "never reached the early list").toBeLessThan(60);
  }
  expect(stuck, stuck.join("\n")).toEqual([]);
  const at = await page.evaluate(() => ({ pricing: document.querySelector("#pricing")!.getBoundingClientRect().top, start: document.querySelector("#start")!.getBoundingClientRect().top }));
  expect(at.pricing, "the prices were scrolled past on the way").toBeLessThan(0);
  expect(at.start, "the early list is on the screen").toBeLessThan(vh);
  test.info().annotations.push({ type: "flicks", description: `${flicks} flicks of ${flick}px to the early list; the week section is ${Math.round(round)}px` });
});

test("the week steps forward with ›, says where it is, and its buttons can be pressed", async ({ page }) => {
  await page.goto("/");
  await landingSettled(page);
  await page.locator("#story").scrollIntoViewIfNeeded();
  const slide = (i: number) => page.locator(`#week-${i}`);
  await expect(slide(0)).toContainText("1 of 7");
  for (const id of ["#week-prev", "#week-next"]) {
    const box = await page.locator(id).boundingBox();
    expect(box!.width, `${id} is ${box!.width}px wide`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${id} is ${box!.height}px tall`).toBeGreaterThanOrEqual(44);
    const onTop = await page.evaluate((sel) => {
      const el = document.querySelector(sel)!;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === el || el.contains(hit));
    }, id);
    expect(onTop, `${id} is covered by something`).toBe(true);
  }
  await expect(page.locator("#week-prev")).toBeDisabled();
  await page.locator("#week-next").click();
  // The row has moved one slide: the second slide is the one in the frame, and the first is out of reach.
  await expect.poll(async () => page.evaluate(() => {
    const row = document.querySelector("#week-row")!;
    return Math.round(row.scrollLeft / row.clientWidth);
  })).toBe(1);
  await expect(slide(1)).toContainText("2 of 7");
  expect(await slide(0).evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  expect(await slide(1).evaluate((el) => (el as HTMLElement).inert)).toBe(false);
});
