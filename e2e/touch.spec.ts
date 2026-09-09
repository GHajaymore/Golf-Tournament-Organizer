import { test, expect, type Page } from "@playwright/test";
import { join } from "node:path";
import { routesForTier } from "../src/lib/nav";
import { standaloneScreens, entryUrl } from "./routes";

test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

/**
 * The console must stay dense on a desktop pointer, and the app must have
 * reachable targets on a touch one.
 *
 * These two assertions are the same rule read from both sides, and neither is
 * meaningful alone: raising every control to 44px would have quietly bloated
 * the organizer's console, which is a real cost to the person who spends
 * hours in it. The gate is `@media (pointer: coarse)` — the pointing device,
 * not the window width — so a narrow desktop window keeps the dense layout.
 *
 * The first version of that rule silently did not apply to `.btn` at all:
 * Next's CSS chunker does not preserve `@import`-first order, so
 * design-system.css lands after globals.css and won at equal specificity.
 * Nothing failed. That is why this is measured in a built app rather than
 * asserted about a stylesheet.
 */

test("controls are thumb-sized on a phone and dense on a desktop", async ({ page }) => {
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");

  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  const btn = await page
    .locator(".btn")
    .filter({ has: page.locator(":scope:visible") })
    .first()
    .boundingBox()
    .catch(() => null);

  const height = await page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>(".btn")].find(
      (b) => b.getBoundingClientRect().height > 0,
    );
    return el ? Math.round(el.getBoundingClientRect().height) : null;
  });

  expect(height, "no visible button found to measure").not.toBeNull();

  // Branch on the pointer the browser actually reports, not on the project's
  // name. Naming one project "phone" and matching that string meant a second
  // touch profile — the 320px one — silently took the desktop branch and
  // asserted the opposite of what it should have.
  if (coarse) {
    expect(height!, `touch button is ${height}px; iOS asks 44pt and Android 48dp`).toBeGreaterThanOrEqual(44);
  } else {
    expect(
      height!,
      `desktop button is ${height}px — the console's density must not follow the phone`,
    ).toBeLessThanOrEqual(36);
  }
  expect(btn === null || btn.width > 0).toBeTruthy();
});

/**
 * Every visible target on the page that is under the platform minimum.
 *
 * MEASURING THE RIGHT BOX is most of this. Two corrections, both found by
 * running the sweep and reading what it accused rather than trusting it:
 *
 * A native checkbox or radio is about 13px and always will be — but when it
 * sits inside a `<label>`, tapping anywhere in that label toggles it, so the
 * label is the target and the input is just the glyph. Measuring the input
 * reports a failure that no user can experience, and "fixing" it would mean
 * inflating checkboxes that are already fine.
 *
 * An `<a>` whose computed display is `inline` is a word in a sentence, not a
 * control. The previous version tested `closest("p")`, which only caught prose
 * inside a paragraph tag and flagged every inline link in a list or a table
 * cell. Display is the honest test: it is what actually distinguishes a link
 * you read from a link you aim at, and it does not depend on which element
 * somebody wrapped the sentence in.
 */
async function undersizedTargets(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("button, a, [role=button], select, input")]
      .map((el) => {
        // A labelled checkbox or radio is tapped by its label.
        const label = el.closest("label");
        const box = label && el.tagName === "INPUT" ? label : el;
        return { el, box };
      })
      .filter(({ el, box }) => {
        const cs = getComputedStyle(box);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        const r = box.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        // A link set inline is text in a sentence, not a target.
        if (el.tagName === "A" && getComputedStyle(el).display === "inline") return false;
        return r.height < 44 || r.width < 24;
      })
      .map(({ el, box }) => ({
        tag: el.tagName,
        cls: String(el.className ?? "").slice(0, 30),
        h: Math.round(box.getBoundingClientRect().height),
        text: (el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 24),
      })),
  );
}

/**
 * THE TOUCH FLOOR IS SWEPT, not spot-checked.
 *
 * This measured `/dashboard` and nothing else, which is the wrong route for
 * the question twice over: it is one screen out of twenty-three, and it is an
 * AT-DESK screen — the very one the density assertion above pins at ≤36px. So
 * the app's only touch-minimum check was aimed at the screen least likely to
 * want a 44px control, and every screen actually worked outdoors — Score
 * entry, the Tee sheet, the live board — had no touch assertion at all.
 *
 * The routes come from `routesForTier("on-course")`, which reads the tier off
 * the nav item, so a screen added to the sidebar is graded the day it is
 * added. See `nav.ts` for why the split is by WHERE a screen is used rather
 * than by who uses it.
 *
 * This does not narrow what is swept anywhere else: `layout.spec` still walks
 * the filesystem and measures every route at every viewport. The tier only
 * decides where the 44px floor applies on top of that, and `nav-tier.test.ts`
 * asserts that distinction so it cannot quietly become a filter.
 */
for (const route of routesForTier("on-course")) {
  test(`nothing tappable on ${route} is smaller than the platform minimum`, async ({ page }) => {
    const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    test.skip(!coarse, "a touch-size rule only applies to touch");

    const res = await page.goto(route);
    // A redirect is a legitimate answer — /me bounces an organizer who is not
    // in the field, and /leaderboard bounces in a blind event. What is not
    // legitimate is a 5xx, and skipping quietly on one would hide it.
    expect(res?.status(), `${route} did not render`).toBeLessThan(500);
    await page.waitForLoadState("networkidle");

    const small = await undersizedTargets(page);
    expect(small, `${route} has sub-44px targets: ${JSON.stringify(small)}`).toEqual([]);
  });
}

/**
 * THE COUNTER-EXAMPLE, and the reason the tier is not a licence.
 *
 * `/dashboard` is at-desk, and this still holds it to 44px on a coarse
 * pointer. That is deliberate: "at-desk" describes where a screen is USUALLY
 * worked, not a promise that nobody will ever open it on a phone — the console
 * has a shipped phone mode below 820px, and an organizer does check the
 * dashboard from the first tee.
 *
 * So the tier decides where the floor is enforced ADDITIONALLY, never where it
 * is waived. Delete this test and "at-desk" quietly becomes an exemption,
 * which is the reading that ends with an untappable console on a phone.
 */
test("even an at-desk screen stays tappable on a phone", async ({ page }) => {
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  test.skip(!coarse, "a touch-size rule only applies to touch");

  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");

  const small = await undersizedTargets(page);
  expect(small, `sub-44px targets: ${JSON.stringify(small)}`).toEqual([]);
});

/**
 * AND THE SCREENS THAT ARE IN NO SIDEBAR AT ALL.
 *
 * The sweep above reads `routesForTier("on-course")`, which reads the tier off
 * the NAV ITEM — so a screen that is not in the sidebar is graded by nothing.
 * `/match/new` is exactly that: it is reached from `/choose` and from the
 * event switcher, never from the nav, and by 2026-09-08 it had a member-search
 * dropdown, five round-type cards, a money picker, add and remove buttons and
 * a dozen `minHeight: 44` declarations that nothing had ever measured.
 *
 * It is also, by this file's own definition, the most on-course screen in the
 * app: "read or tapped outdoors, one-handed, on a phone" describes somebody
 * standing on the first tee setting up the round they are about to play.
 *
 * The floor applies to ALL of them rather than to a chosen few, which is the
 * same reasoning as the at-desk counter-example below: the tier decides where
 * the floor is enforced ADDITIONALLY, never where it is waived. `/privacy` and
 * `/styleguide` are not on-course screens and are held to it anyway, because
 * "nobody taps this outdoors" is a guess and a 44px control costs nothing.
 *
 * One list, shared with `layout.spec` — two copies of a filesystem walk is how
 * one of them quietly stops covering a route somebody added.
 */
for (const path of standaloneScreens()) {
  test(`nothing tappable on ${path} is smaller than the platform minimum`, async ({ page }) => {
    const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    test.skip(!coarse, "a touch-size rule only applies to touch");

    const res = await page.goto(entryUrl(path));
    expect(res?.status(), `${path} did not render`).toBeLessThan(500);
    await page.waitForLoadState("networkidle");

    // Prove we are ON the screen. These run before a tournament exists, so a
    // redirect means something different here from inside the console — but it
    // means the same thing for the assertion: whatever was measured was not
    // this screen, and measuring the landing page instead is how a sweep goes
    // green having checked nothing.
    expect(new URL(page.url()).pathname, `${path} redirected away`).toBe(path);

    const small = await undersizedTargets(page);
    expect(small, `${path} has sub-44px targets: ${JSON.stringify(small)}`).toEqual([]);
  });
}
