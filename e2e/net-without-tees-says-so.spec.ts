import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, CARD_PARS } from "./rounds-fixture";

/**
 * NET SCORES WITHOUT TEES SAY SO, AS THE SECRETARY MEETS IT (foundation item J27).
 *
 * A net medal on a course with no tees. Until now the launch dialog said it and the setup
 * rail did not. Now, as the person who set this up would see it:
 *
 *   - WITH a rated tee: Tournament details reads done, the dialog has no tee warning (control);
 *   - with the tees GONE: the dashboard's checklist row for Tournament details reads
 *     "Add tees with a rating, or net scores use each player's handicap index." marked Optional,
 *     the rail on Tournament details reads "Ready to launch … the rest optional" with that step
 *     marked Optional, and the launch dialog's "Still open" says no tees are set up;
 *   - and it is a warning, never a refusal: the same press launches.
 *
 * Marked zz-, one club per screen size, deleted afterwards. WHAT IT CANNOT SEE: a tee with a Slope
 * and no Course Rating, and a gross-only medal (both held by `j27-rail-says-unrated-tees.test.ts`
 * and `launch-warns-about-unrated-tees.test.ts`).
 */

const WALKED = ["desktop", "phone"];
const TODO = "Add tees with their Course Rating and Slope, or players get strokes off their raw Handicap Index.";

test.describe.configure({ timeout: 150_000 });
test.afterAll(async () => {
  await prisma.$disconnect();
});

test("a net medal on a course with no tees: the rail and Launch both say scores use the handicap index, and Launch still goes", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const mark = `zz-j27-${testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase()}`;
  const errors: string[] = [];
  watchPageErrors(page, errors);
  await dropClub(mark);
  const club = await makeClub(mark);
  try {
    const { event, stages } = await makeEvent(club, "Spring Medal", {
      status: "ready",
      configUnlocked: true,
      stages: [{ playedOn: "2099-06-12", scoringBasis: "net" }],
      players: 4,
      // Money answered and a tee sheet saved, so the only warnings left are the flights and the tees:
      // the launch dialog shows three in full, and the tees one must be among them (`launchRows`).
      event: { dates: "Jun 12", moneyMode: "none", customYards: JSON.stringify(new Array(18).fill(380)) },
    });
    await prisma.stage.updateMany({ where: { eventId: event.id }, data: { teeSheet: JSON.stringify({ groups: [] }) } });
    // The course carries its card (so nothing is held for want of one) and one RATED tee.
    const course = await prisma.course.create({
      data: {
        organizationId: club.orgId,
        name: `${mark} Hollins Moss`,
        pars: JSON.stringify(CARD_PARS),
        strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
        yards: JSON.stringify(new Array(18).fill(380)),
      },
    });
    const tee = await prisma.tee.create({ data: { courseId: course.id, name: "Blue", gender: "any", courseRating: 71.5, slopeRating: 125, par: 72 } });
    await prisma.eventCourse.create({ data: { eventId: event.id, courseId: course.id } });
    for (const s of stages) await prisma.stage.update({ where: { id: s.id }, data: { courseId: course.id } });
    await signIn(context, baseURL!, club, event.id);

    const openDialog = async () => {
      await page.goto(`/dashboard?bust=${Date.now()}`);
      const launch = page.getByRole("button", { name: "Launch tournament" }).first();
      await expect(launch, "Launch tournament is not offered").toBeVisible({ timeout: 30_000 });
      await expect(launch, "a net medal with tees was refused").toBeEnabled();
      return launch;
    };

    // CONTROL: rated tees, nothing said.
    let launch = await openDialog();
    await expect(page.getByText(TODO), "the to-do showed with rated tees").toHaveCount(0);
    await launch.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Launch tournament" })).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(/No tees are set up/), "the dialog warned with rated tees").toHaveCount(0);
    await page.keyboard.press("Escape");

    // The tees go.
    await prisma.tee.delete({ where: { id: tee.id } });

    // On Tournament details the ready-to-launch card says it, in words, with a way to the Courses card.
    // (The checklist that also carries these words is hidden in this very state.)
    await page.goto(`/event?bust=${Date.now()}`);
    await expect(page.getByText(/Ready to launch — \d+ of \d+ done, the rest optional/), "the rail does not say it can launch").toBeVisible({ timeout: 15_000 });
    const card = page.locator(".card").filter({ hasText: /Ready to launch/ }).first();
    await expect(card, "the card does not say players get strokes off their Handicap Index").toContainText(TODO);
    await expect(card.locator('a[href="/event#courses"]').first()).toHaveAttribute("href", "/event#courses");

    // From another setup screen the strip marks Tournament details Optional (here it would read "Now").
    await page.goto(`/registration?bust=${Date.now()}`);
    const step = page.getByRole("link").filter({ hasText: "Tournament details" }).filter({ hasText: "Optional" });
    await expect(step.first(), "the rail does not mark Tournament details Optional").toBeVisible({ timeout: 15_000 });

    launch = await openDialog();
    await launch.click();
    const open = page.getByRole("dialog").getByRole("region", { name: "Still open" });
    await expect(open).toContainText("No tees are set up for the course", { timeout: 15_000 });
    await expect(open.getByRole("link", { name: /Add the Course Rating and Slope on Tournament details/ })).toHaveAttribute("href", "/event");

    // A warning, never a refusal: the same press launches.
    await page.getByRole("dialog").getByRole("button", { name: "Launch tournament" }).click();
    await expect
      .poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status, { timeout: 20_000, message: "no tees refused the launch" })
      .toBe("live");
    expect(errors).toEqual([]);
  } finally {
    await dropClub(mark).catch(() => {});
  }
});
