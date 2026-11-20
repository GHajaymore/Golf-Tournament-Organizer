import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn } from "./rounds-fixture";

/**
 * "LOOK UP A COURSE" ON TOURNAMENT DETAILS, WALKED AS THE SECRETARY (B84, 2026-11-20).
 *
 * #1136 made the lookup panel load only when it is opened (`searchCourseDirectory` and
 * `importCourseFromDirectory` are what it presses). Paste-a-card had two browser specs; the lookup had none,
 * so a panel that never loaded would have shipped green. As the secretary, on /event:
 *
 *   Look up a course, type a few letters  -> the club's catalogue answers, as you type, with the town and par
 *   Add to library on a course with a card -> said to be added "with its card, with 1 rated tee set"; the
 *                                             library lists it with its par, and the rows hold the card
 *                                             hole for hole and the tee's rating and slope
 *   the same search again                  -> that course now reads "In your library", not "Add" again
 *   Add to library on a course the catalogue
 *   holds with no usable card              -> said to be added "but without a card", with the reason; the
 *                                             library lists it as "No card yet"; no placeholder card stored
 *   Add to library on a name the library
 *   already holds                          -> refused in words beside the list; no second row
 *   a search of fewer than three letters   -> no list, nothing asked
 *
 * NOTHING GOES OUT. Every course searched for is a row in the stored catalogue (`CourseCatalog`, seeded here),
 * which the server reads first, so the live OpenGolfAPI / GolfCourseAPI lookups are never reached.
 *
 * WHAT IT CANNOT SEE, AND WHY: "nothing matching that" (the catalogue empty, so the server then asks the live
 * directory) and "the directory did not answer" both leave the building, and the allowance is shared by every
 * club; no test spends it (`e2e/course-cards-and-venues.spec.ts`, same rule). The wording of both is pinned by
 * unit tests and `golfcourseapi-on-demand.test.ts`.
 *
 * Refusals in this panel are plain paragraphs, not `role="alert"` (CourseSearch.tsx) — the spec reads them by
 * their words, and the finding is reported.
 */

const WALKED = ["desktop", "phone"];
/** A word no real course carries, one per project so two projects running side by side never share a hit. */
const WORD: Record<string, string> = { desktop: "Wexcombe", phone: "Thornquist" };
const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5];
const YARDS = [380, 510, 165, 420, 395, 405, 150, 410, 525, 400, 385, 175, 430, 540, 395, 160, 415, 505];
const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];
const NO_CARD_REASON = "The directory has no usable card for this course (invented reason).";

test.describe.configure({ timeout: 180_000 });
test.use({ actionTimeout: 15_000 });
test.afterAll(async () => {
  await prisma.$disconnect();
});

async function catalogue(id: string, name: string, card: boolean) {
  await prisma.courseCatalog.create({
    data: {
      id,
      name,
      city: "Invented Bay",
      state: "OH",
      country: "US",
      par: card ? PARS.reduce((a, b) => a + b, 0) : 0,
      pars: card ? JSON.stringify(PARS) : "",
      yards: card ? JSON.stringify(YARDS) : "",
      strokeIndex: card ? JSON.stringify(SI) : "",
      tees: JSON.stringify([{ name: "White", gender: "any", courseRating: 71.6, slopeRating: 128, par: 72, yards: 6900 }]),
      cardProblem: card ? "" : NO_CARD_REASON,
    },
  });
}

async function openLookup(page: Page) {
  await page.goto(`/event?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("button", { name: "Look up a course" }).click();
  return page.getByRole("combobox", { name: "Search for a course by name or town" });
}

test("Look up a course: found as you type, added with its card and tees, and every refusal said beside the list", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = `zz-cls-${testInfo.project.name}`;
  const word = WORD[testInfo.project.name];
  const withCard = `${mark} ${word} Heath`;
  const withoutCard = `${mark} ${word} Moor`;
  const held = `${mark} ${word} Dunes`;
  const club = await makeClub(mark);
  const ids = [`${mark}-heath`, `${mark}-moor`, `${mark}-dunes`];
  try {
    await prisma.courseCatalog.deleteMany({ where: { id: { startsWith: mark } } });
    await catalogue(ids[0], withCard, true);
    await catalogue(ids[1], withoutCard, false);
    await catalogue(ids[2], held, true);
    // The club already holds a course under the third name (typed by hand, so no directory id on it).
    await prisma.course.create({
      data: {
        organizationId: club.orgId, name: held, city: "Invented Bay", source: "manual",
        pars: JSON.stringify(PARS), yards: JSON.stringify(YARDS), strokeIndex: JSON.stringify(SI),
      },
    });
    const { event } = await makeEvent(club, "Spring Medal", { status: "live", stages: [{}] });
    await signIn(context, baseURL!, club, event.id);

    const search = await openLookup(page);
    const hit = (name: string) => page.locator("#course-search-results").getByRole("option").filter({ hasText: name });

    await test.step("typing finds the catalogue's courses with their town and par", async () => {
      await search.fill(word);
      await expect(hit(withCard), "typing did not bring the course up").toBeVisible({ timeout: 20_000 });
      await expect(hit(withCard)).toContainText("Invented Bay");
      await expect(hit(withCard)).toContainText("par 72");
      await expect(hit(withoutCard)).toBeVisible();
    });

    await test.step("cutting the box back under three letters clears the list; nothing is asked", async () => {
      // The list going away IS the condition: the box clears it once the typing settles.
      await search.fill(word.slice(0, 2));
      await expect(page.locator("#course-search-results")).toHaveCount(0);
      await expect(page.getByText(/Nothing matching that/)).toHaveCount(0);
      await search.fill(word);
      await expect(hit(withCard)).toBeVisible({ timeout: 20_000 });
    });

    await test.step("Add to library on a course with a card: its card and tees arrive", async () => {
      await hit(withCard).getByRole("button", { name: "Add to library" }).click();
      await expect(
        page.getByText(`${withCard} added, with its card, with 1 rated tee set.`),
        "the import was not confirmed in words",
      ).toBeVisible({ timeout: 20_000 });
      const stored = await prisma.course.findFirst({
        where: { organizationId: club.orgId, name: withCard },
        include: { tees: true },
      });
      expect(stored, "no course was stored for the club").not.toBeNull();
      expect(JSON.parse(stored!.pars)).toEqual(PARS);
      expect(JSON.parse(stored!.strokeIndex)).toEqual(SI);
      expect(stored!.source).toBe("imported");
      expect(stored!.tees.map((t) => [t.name, t.courseRating, t.slopeRating, t.par])).toEqual([["White", 71.6, 128, 72]]);
      // And on the screen after a fresh load: the club's list holds it, with its par.
      await page.goto(`/event?bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      const row = page.getByRole("row").filter({ hasText: withCard });
      await expect(row, "the course is not in the library list").toBeVisible();
      await expect(row).toContainText("72");
    });

    await test.step("the same search again reads In your library, not Add", async () => {
      const again = await openLookup(page);
      await again.fill(word);
      await expect(hit(withCard)).toBeVisible({ timeout: 20_000 });
      await expect(hit(withCard)).toContainText("In your library");
      await expect(hit(withCard).getByRole("button", { name: "Add to library" })).toHaveCount(0);
    });

    await test.step("a course with no usable card: added, said to need one, and no placeholder stored", async () => {
      await hit(withoutCard).getByRole("button", { name: "Add to library" }).click();
      const said = page.getByText(new RegExp(`${withoutCard} added, with 1 rated tee set, but without a card\\.`));
      await expect(said, "the missing card was not said where it was pressed").toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(NO_CARD_REASON)).toBeVisible();
      const stored = await prisma.course.findFirst({ where: { organizationId: club.orgId, name: withoutCard } });
      expect(stored, "the course should still be added").not.toBeNull();
      expect(stored!.pars, "a placeholder card was stored for a course with none").toBe("");
      await page.goto(`/event?bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(page.getByRole("row").filter({ hasText: withoutCard })).toContainText("No card yet");
    });

    await test.step("a name the library already holds: refused in words beside the list; no second row", async () => {
      const third = await openLookup(page);
      await third.fill(word);
      await expect(hit(held)).toBeVisible({ timeout: 20_000 });
      await hit(held).getByRole("button", { name: "Add to library" }).click();
      await expect(
        page.getByText(`${held} is already in your course library.`),
        "a second course under one name was not refused in words",
      ).toBeVisible({ timeout: 20_000 });
      expect(await prisma.course.count({ where: { organizationId: club.orgId, name: held } })).toBe(1);
    });

    expect(errors, `screen errors:\n${errors.join("\n")}`).toEqual([]);
  } finally {
    await prisma.courseCatalog.deleteMany({ where: { id: { startsWith: mark } } }).catch(() => {});
    await dropClub(mark).catch(() => {});
  }
});
