import { test, expect, type Page } from "@playwright/test";
import { join } from "node:path";
import { routesForTier } from "../src/lib/nav";
import { standaloneScreens } from "./routes";

test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

/**
 * NOTHING YOU CAN SEE IS UNDER SOMETHING ELSE.
 *
 * On 2026-09-18 the player's own screen put "Finish my card" at y=765 with the
 * tab bar fixed from y=747. The control was on the first screen and underneath
 * the navigation, so the only way to press it was to scroll a page that looked
 * finished.
 *
 * NOTHING COULD SEE IT, and the two specs that look hardest at geometry were
 * both asking a different question:
 *
 *   - `layout.spec` asks whether a page scrolls SIDEWAYS. A control behind a
 *     bar does not move the document at all;
 *   - `touch.spec` asks whether targets clear 44px. That one was 36px tall and
 *     315px wide, and being large is exactly no protection from being covered.
 *
 * A bounding box says where something IS. This asks what is painted ON it,
 * which is the only way the fault shows up — `elementFromPoint` at the centre
 * of each control.
 *
 * THE RULE TOOK THREE GOES, and the two wrong ones are worth keeping because
 * both looked like findings:
 *
 *   1. "covered at rest" flagged `/entry`'s "Hole by hole" toggle and a rules
 *      link. Both were simply in the last 65px of the first screen with the
 *      page still scrollable — one flick and they are clear;
 *   2. "covered with the page scrolled to the bottom" flagged three more, all
 *      of them now under the STICKY HEADER at the top of the page. Same error,
 *      other end: scrolling up reveals them.
 *
 * Either version would have shipped as a wall of failures about screens that
 * are fine, which is how a sweep becomes something somebody switches off. The
 * question is not where a control is now; it is whether ANY scroll position
 * shows it. So each control is centred in the viewport first and judged there.
 * What fails is reachable from nowhere.
 *
 * WHAT IS DELIBERATELY NOT A FAILURE:
 *
 *   - a control covered by its own label, which is how every styled checkbox
 *     and radio in this codebase is built;
 *   - anything invisible, transparent, or `pointer-events: none` — those are
 *     not controls somebody is trying to press.
 */

const PHONE = { width: 375, height: 812 };

interface Covered {
  label: string;
  by: string;
  at: string;
}

async function coveredControls(page: Page): Promise<Covered[]> {
  return page.evaluate(() => {
    const out: { label: string; by: string; at: string }[] = [];
    const controls = [...document.querySelectorAll('a, button, input, select, textarea, [role="button"]')];

    for (const el of controls) {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      if (cs.pointerEvents === "none") continue;
      if (Number(cs.opacity) < 0.1) continue;

      if (el.getBoundingClientRect().height < 8) continue;

      /**
       * THE CONTROL IS GIVEN ITS BEST CHANCE FIRST.
       *
       * "Covered right now" is not the question — a bar over something with
       * somewhere left to scroll is a scroll away, at either end of the page,
       * and flagging that makes this noise. The question is whether there is
       * ANY scroll position where the control is clear, so each one is put in
       * the middle of the viewport before it is judged. What fails here is
       * reachable from nowhere.
       *
       * Instant rather than animated: `playwright.config.ts` sets
       * `reducedMotion: "reduce"`, which is also what stopped the card chooser
       * flaking, so the box is settled by the time it is read.
       */
      el.scrollIntoView({ block: "center", inline: "nearest" });
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (r.top >= window.innerHeight || r.bottom <= 0) continue;

      const x = Math.round(Math.min(Math.max(r.x + r.width / 2, 1), window.innerWidth - 1));
      const y = Math.round(Math.min(Math.max(r.y + r.height / 2, 1), window.innerHeight - 1));
      const top = document.elementFromPoint(x, y);
      if (!top) continue;
      if (top === el || el.contains(top) || top.contains(el)) continue;

      // A styled control whose own label sits over it is the normal pattern.
      const label = top.closest("label");
      if (label) {
        const forId = label.getAttribute("for");
        if ((forId && forId === el.id) || label.contains(el)) continue;
      }

      const name = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ");
      const byName = (top.getAttribute("aria-label") || top.textContent || "").trim().replace(/\s+/g, " ");
      out.push({
        label: `${el.tagName.toLowerCase()} "${name.slice(0, 34)}"`,
        by: `${top.tagName.toLowerCase()} "${byName.slice(0, 26)}"`,
        at: `${Math.round(r.top)}-${Math.round(r.bottom)}`,
      });
    }
    return out;
  });
}

const ROUTES = [...routesForTier("on-course"), ...standaloneScreens()];

test.describe("nothing on screen is buried under something else", () => {
  test("has routes to sweep, and can see a control it covers on purpose", async ({ page }) => {
    /**
     * The control, in both directions. A sweep over no routes passes for ever,
     * and a detector that never fires passes just as quietly — so one is
     * deliberately buried and has to be found.
     */
    expect(ROUTES.length).toBeGreaterThan(8);

    await page.setViewportSize(PHONE);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    expect(await coveredControls(page), "the demo dashboard starts clean").toEqual([]);

    await page.evaluate(() => {
      /**
       * THE LID GOES WHERE CONTROLS ARE JUDGED, not where one happens to be.
       *
       * Two earlier versions of this control passed for the wrong reason. The
       * first covered the first control in the DOM, which is off screen, so
       * nothing was buried and the detector correctly found nothing. The
       * second pinned a lid over a control's current box — and the sweep
       * scrolls each control to the CENTRE before judging it, which slides the
       * control out from under a fixed lid.
       *
       * So the lid covers the middle band of the viewport, which is exactly
       * where every control ends up when it is measured. If the detector can
       * be fooled, this is where it shows.
       */
      const lid = document.createElement("div");
      lid.setAttribute("data-test-lid", "");
      Object.assign(lid.style, {
        position: "fixed",
        left: "0px",
        top: `${Math.round(window.innerHeight / 2) - 60}px`,
        width: "100%",
        height: "120px",
        background: "red",
        zIndex: "9999",
      });
      document.body.appendChild(lid);
    });

    const found = await coveredControls(page);
    expect(found.length, "the detector cannot see a control with a lid on it").toBeGreaterThan(0);
  });

  for (const route of ROUTES) {
    test(`${route} keeps its controls pressable`, async ({ page }) => {
      await page.setViewportSize(PHONE);
      const res = await page.goto(route);
      // A redirect is a legitimate answer on some of these; a 5xx is not, and
      // skipping quietly on one would hide it.
      expect(res?.status(), `${route} did not render`).toBeLessThan(500);
      await page.waitForLoadState("networkidle");

      const covered = await coveredControls(page);
      expect(
        covered,
        `${route}: ${covered.length} control(s) on screen with something painted over them — ${JSON.stringify(covered)}`,
      ).toEqual([]);
    });
  }
});
