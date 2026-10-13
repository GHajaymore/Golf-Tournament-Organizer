import { test, expect, type Locator, type Page } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * A CLUB TYPES ITS OWN COURSE: THE CARD, THE TEES AND THEIR RATINGS.
 *
 * Every net score in the app is read against a course card, and a wrong one is
 * invisible: a bad stroke index sends handicap strokes to the wrong holes for
 * the life of the course. The card editor is where a club puts that card in by
 * hand, and no browser test had ever opened it — `saveClubCourse`, `saveTee`,
 * `deleteTee`, `setHomeCourse`, `verifyCourseCard`, `unverifyCourseCard` and
 * `deleteClubCourse` were performed by nothing (round 1 on the frozen app,
 * 2026-10-13). The card's rules are held by unit tests; whether the screen a
 * secretary uses reaches them, and says what they say, was not.
 *
 * As the secretary, on Tournament details:
 *
 *   no name                             → nothing to press (the control)
 *   the par row pasted alone            → refused in words; the boxes stay empty
 *   the whole card pasted               → said to be read; the boxes hold it
 *   one stroke index typed twice        → refused in words, nothing stored
 *   put right, and added                → stored hole for hole; listed with its
 *                                          par, and marked as not yet checked
 *   "Add a course" opened again         → an empty form: no card from last time
 *                                          in the paste box, and nothing saying
 *                                          one was read
 *   the card checked, and unchecked     → who checked it is kept, and shown
 *   tees: a rating typed "71,4"         → stored 71.4 with its slope, and a 14.0
 *                                          index is shown what it plays off
 *   a slope of 200                      → refused in words, nothing changed
 *   the tees removed — asked first      → gone
 *   made the club's home course         → stored; and put back
 *   used for this tournament            → stored; and taken off again
 *   a card with a score on it, changed  → ASKED, with how many cards and which
 *                                          tournament, and nothing changed yet
 *   …cancelled                          → nothing changed; what was typed is kept
 *   …"keep those results as they were"  → the course takes the new card, and the
 *                                          round already played keeps the old one
 *   the course removed — asked first    → gone, and its tees with it
 *
 * The fixture could not reach the last three: its own tournament carries its
 * card itself, so no stored course of the club's had a score on it, and the
 * first draft of this spec printed "NOT WALKED" there. It makes its own.
 *
 * WHAT IT CANNOT SEE: what RE-SCORING does to the results of a round already
 * played — `course-card-is-history.audit.test.ts` holds that against real
 * rows. Nor the directory's courses: looking one up spends a paid allowance,
 * and is not performed by any test.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string };
const MARK = "zz-course";
const NAME = `${MARK} Linksfield Old`;
const PLAYED = `${MARK} Ardwell Played`;
const PLAYED_EVENT = `${MARK} Medal Already Played`;
const PARS = [4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];
const SI = [6, 10, 12, 16, 14, 2, 18, 4, 8, 3, 9, 17, 7, 1, 13, 11, 15, 5];
const YARDS = [385, 512, 401, 362, 168, 534, 155, 410, 377, 394, 421, 181, 356, 508, 388, 432, 172, 541];
const CARD = [`Hole ${PARS.map((_, i) => i + 1).join(" ")}`, `Par ${PARS.join(" ")}`, `S.I. ${SI.join(" ")}`, `Yards ${YARDS.join(" ")}`].join("\n");
const prisma = new PrismaClient();
test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

let clubId = "";
let playedCourseId = "";
let playedEventId = "";
let was: { home: string | null; venues: string[] } | null = null;
const sweep = async () => {
  await prisma.event.deleteMany({ where: { organizationId: clubId, name: { startsWith: MARK } } });
  await prisma.course.deleteMany({ where: { organizationId: clubId, name: { startsWith: MARK } } });
};
test.beforeAll(async () => {
  const home = await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { organizationId: true } });
  clubId = home.organizationId!;
  const club = await prisma.organization.findUniqueOrThrow({ where: { id: clubId }, select: { defaultCourseId: true } });
  const venues = await prisma.eventCourse.findMany({ where: { eventId: data.eventId }, select: { courseId: true } });
  was = { home: club.defaultCourseId, venues: venues.map((v) => v.courseId).sort() };
  await sweep();

  // A course of the club's with a round ALREADY SCORED ON IT, which the fixture has none of: its own
  // tournament carries its card itself. One finished medal, one player, one card of eighteen holes.
  const course = await prisma.course.create({
    data: { organizationId: clubId, name: PLAYED, city: "Ardwell", pars: JSON.stringify(PARS), yards: JSON.stringify(YARDS), strokeIndex: JSON.stringify(SI) },
  });
  playedCourseId = course.id;
  const event = await prisma.event.create({
    data: {
      organizationId: clubId,
      name: PLAYED_EVENT,
      status: "completed",
      completedAt: new Date(),
      shape: "single",
      format: "stroke",
      dates: "",
      course: PLAYED,
      city: "Ardwell",
      address: "",
      regDeadline: "",
      courseId: course.id,
      shareToken: `${MARK}-played-token`,
    },
  });
  playedEventId = event.id;
  const stage = await prisma.stage.create({ data: { eventId: event.id, position: 0, description: "Round 1", type: "Stroke Play Round", format: "Stroke Play", holes: 18 } });
  const player = await prisma.player.create({ data: { eventId: event.id, name: "Ines Farquharson", email: `${MARK}-played@example.invalid`, handicap: 9, seed: 1, status: "confirmed" } });
  await prisma.scorecard.create({ data: { eventId: event.id, stageId: stage.id, playerId: player.id, strokes: JSON.stringify(PARS.map((p) => p + 1)), status: "certified" } });
});
/** The fixture's club and tournament are every later spec's: the home course and the venues go back as they were. */
test.afterAll(async () => {
  if (clubId) await sweep();
  if (was) await prisma.organization.update({ where: { id: clubId }, data: { defaultCourseId: was.home } });
  await prisma.$disconnect();
});

const stored = () => prisma.course.findFirst({ where: { organizationId: clubId, name: NAME }, include: { tees: true } });
const venues = async () => (await prisma.eventCourse.findMany({ where: { eventId: data.eventId }, select: { courseId: true } })).map((v) => v.courseId).sort();

async function open(page: Page): Promise<Locator> {
  await page.goto(`/event?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const card = page.locator(".card", { has: page.locator(".card-title", { hasText: /^Courses$/ }) }).first();
  await expect(card, "Tournament details has no list of courses").toBeVisible();
  return card;
}
/** A box in the card editor or the tee editor, by the words above it. */
const box = (within: Locator, label: string | RegExp) => within.locator(".field", { has: within.page().locator("label", { hasText: label }) }).locator("input, textarea, select").first();
/** The eighteen boxes of one row of the card: "Par", "S.I." or the distances. */
const row = (card: Locator, name: string | RegExp) => card.locator("tr", { has: card.page().locator("td:first-child", { hasText: name }) }).locator("input");
const values = (boxes: Locator) => boxes.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
/**
 * Every box on show that a screen reader could not name. The accessibility audit opens each screen
 * and reads it as it arrives — with this editor shut. Its fifty-four boxes had no names at all
 * ("edit text, edit text, edit text"), and five of the tee form's labels were not tied to their boxes.
 */
const unnamed = (within: Locator) =>
  within.locator("input, select, textarea").evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null && (el as HTMLInputElement).type !== "hidden")
      .filter((el) => !((el as HTMLInputElement).labels?.length || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.closest("[role=radiogroup][aria-labelledby]")))
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} in "${(el.closest("tr, .field")?.textContent ?? "").trim().slice(0, 24)}"`),
  );

test("a club's own course is typed in, checked, given rated tees, used and removed — and a card with scores on it is asked about before it changes", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  let courses = await open(page);

  // ── no name: nothing to press ─────────────────────────────────────────────
  await courses.getByRole("button", { name: "Add a course" }).click();
  const add = courses.getByRole("button", { name: "Add course" });
  await expect(add, "CONTROL: a course with no name can be added").toBeDisabled();
  await box(courses, "Course name").fill(NAME);
  await box(courses, "City").fill("Linksfield");

  // ── the par row alone ─────────────────────────────────────────────────────
  const paste = box(courses, /^Paste the card/);
  await paste.fill(`Par ${PARS.join(" ")}`);
  await expect(courses.getByText("Two rows at least — the par row and the stroke index row."), "half a card is not refused in words").toBeVisible();
  expect((await values(row(courses, /^Par$/))).join(""), "half a card was put into the boxes").toBe("");

  // ── the whole card ────────────────────────────────────────────────────────
  await paste.fill(CARD);
  await expect(courses.getByText(/^\s*Read 18 pars and 18 stroke indexes and 18 lengths in yards\./), "a whole card is not said to have been read").toBeVisible();
  expect(await values(row(courses, /^Par$/)), "the pars in the boxes are not the pars pasted").toEqual(PARS.map(String));
  expect(await values(row(courses, /^S\.I\.$/)), "the stroke indexes in the boxes are not the ones pasted").toEqual(SI.map(String));
  expect(await values(row(courses, /^Yards$/)), "the lengths in the boxes are not the ones pasted").toEqual(YARDS.map(String));
  expect(await unnamed(courses), "boxes in the open card editor have no name a screen reader can say").toEqual([]);
  await expect(page.getByRole("textbox", { name: "Stroke index, hole 7" }), "a box of the card cannot be found by what it is").toHaveValue(String(SI[6]));

  // ── one stroke index twice ────────────────────────────────────────────────
  await row(courses, /^S\.I\.$/).nth(1).fill(String(SI[0]));
  await add.click();
  const refusal = courses.getByText("Stroke indexes must use each number 1–18 exactly once.");
  await expect(refusal, "a stroke index used twice is not refused in words").toBeVisible({ timeout: 20_000 });
  // Said where the press was. It was printed above the whole form, a screen and more from the button
  // just pressed, so pressing Add course on a wrong card looked like pressing nothing.
  await expect(refusal, "the refusal is printed where the person who pressed Add course cannot see it").toBeInViewport();
  expect(await stored(), "a card with a stroke index used twice was stored").toBeNull();

  // ── put right, and added ──────────────────────────────────────────────────
  await row(courses, /^S\.I\.$/).nth(1).fill(String(SI[1]));
  await add.click();
  await expect.poll(async () => (await stored())?.id ?? "", { timeout: 20_000, message: "the course was not stored" }).not.toBe("");
  let course = (await stored())!;
  expect(JSON.parse(course.pars), "the pars stored are not the pars typed").toEqual(PARS);
  expect(JSON.parse(course.strokeIndex), "the stroke indexes stored are not the ones typed").toEqual(SI);
  expect(JSON.parse(course.yards), "the lengths stored are not the ones typed").toEqual(YARDS);
  expect(course.verifiedAt, "a card nobody has checked is stored as checked").toBeNull();
  await expect(courses.getByText(`${NAME} saved to the`), "the screen does not say the course was saved").toBeVisible({ timeout: 20_000 });
  const listed = () => courses.locator("tbody tr").filter({ hasText: NAME }).first();
  await expect(listed(), "the new course is not in the list").toBeVisible();
  await expect(listed().locator("td").nth(2), "the list does not show the card's par").toHaveText(String(PARS.reduce((s, p) => s + p, 0)));
  await expect(listed().getByRole("note"), "a card nobody has checked is not marked").toContainText("Unverified");

  // ── a second course starts from an empty form ─────────────────────────────
  await courses.getByRole("button", { name: "Add a course" }).click();
  expect(await box(courses, /^Paste the card/).inputValue(), "the paste box still holds the last course's card").toBe("");
  await expect(courses.getByText(/Read 18 pars/), "an empty form says a card was read").toHaveCount(0);
  expect((await values(row(courses, /^Par$/))).join(""), "the boxes hold a card nobody typed").toBe("");
  await courses.getByRole("button", { name: "Cancel" }).click();

  // ── checked, and unchecked ────────────────────────────────────────────────
  await listed().getByRole("button", { name: "Verify card" }).click();
  await expect.poll(async () => !!(await stored())?.verifiedAt, { timeout: 20_000, message: "checking the card was not stored" }).toBe(true);
  course = (await stored())!;
  expect(course.verifiedBy, "who checked the card is not kept").not.toBe("");
  await expect(listed().getByRole("img", { name: `Card checked by ${course.verifiedBy}` }), "the list does not say who checked the card").toBeVisible({ timeout: 20_000 });
  await listed().getByRole("button", { name: "Unverify" }).click();
  await expect.poll(async () => !!(await stored())?.verifiedAt, { timeout: 20_000, message: "unchecking the card was not stored" }).toBe(false);

  // ── tees: a rating typed the way half of Europe types it ──────────────────
  // THIS course's tees: the row under its own. The first draft took "the tees that say No tees yet",
  // which was two courses, and rated the fixture's.
  const teesOf = () => listed().locator("xpath=following-sibling::tr[1]").locator("details").first();
  const tees = teesOf();
  await expect(tees, "a course with no tees is not said to have none").toContainText("No tees yet");
  await expect(tees, "a course with no tees does not open its tees to be added").toBeVisible();
  await tees.getByRole("button", { name: "Add tees" }).click();
  await box(tees, /^Name$/).fill("Blue");
  await box(tees, /^Rated for$/).selectOption("men");
  await box(tees, /^Course Rating$/).fill("71,4");
  await box(tees, /^Slope$/).fill("128");
  await expect(tees, "the tees are not said to change what a 14.0 index plays off").toContainText(/A 14\.0 index plays off 15 from these tees/);
  expect(await unnamed(tees), "boxes in the open tee form have no name a screen reader can say").toEqual([]);
  await tees.getByRole("button", { name: "Save tees" }).click();
  await expect.poll(async () => (await stored())?.tees.map((t) => [t.name, t.gender, t.courseRating, t.slopeRating, t.par]), { timeout: 20_000, message: "the tees were not stored" }).toEqual([["Blue", "men", 71.4, 128, 72]]);
  const teeTable = teesOf();
  await expect(teeTable.locator("summary"), "the course's line does not say what tees it has").toContainText("1 set — Blue", { timeout: 20_000 });
  // CONTROL: and nobody else's course was given them.
  expect(await prisma.tee.count({ where: { course: { organizationId: clubId }, courseId: { not: course.id }, name: "Blue", courseRating: 71.4 } }), "the tees were put on another course").toBe(0);
  const teeRow = teeTable.locator("tbody tr", { hasText: "Blue" });
  // Still open, on what was just saved. The panel used to fold shut the moment a course had tees.
  await expect(teeRow, "the tees just saved are folded out of sight").toBeVisible({ timeout: 20_000 });
  await expect(teeRow, "the tees are not listed with their rating, slope and what a 14.0 plays off").toContainText(/Blue\s*men\s*71\.4\s*128\s*72\s*15/);

  // ── a slope nobody's course has ───────────────────────────────────────────
  await teeRow.getByTitle("Edit these tees").click();
  await box(teeTable, /^Slope$/).fill("200");
  await teeTable.getByRole("button", { name: "Save tees" }).click();
  await expect(teeTable.getByText(/Slope Rating is between 55 and 155/), "a slope of 200 is not refused in words").toBeVisible({ timeout: 20_000 });
  expect((await stored())!.tees[0].slopeRating, "a slope of 200 was stored").toBe(128);
  await teeTable.getByRole("button", { name: "Cancel" }).click();

  // ── the tees removed: asked first ─────────────────────────────────────────
  await teeRow.getByTitle("Remove these tees").click();
  expect((await stored())!.tees.length, "one press removed a set of tees without asking").toBe(1);
  await teeTable.getByRole("button", { name: "Remove them" }).click();
  await expect.poll(async () => (await stored())?.tees.length, { timeout: 20_000, message: "the tees were not removed" }).toBe(0);

  // ── made the club's home course, and put back ─────────────────────────────
  // Chosen from the list the box opens, with nothing typed: typing looks a course up in the paid
  // directory when the club has none by that name, and no test spends that.
  courses = await open(page);
  const home = courses.getByRole("combobox", { name: /home course$/ });
  const clubHome = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: clubId }, select: { defaultCourseId: true } })).defaultCourseId;
  await home.click();
  await page.getByRole("option", { name: new RegExp(NAME) }).click();
  await expect.poll(clubHome, { timeout: 20_000, message: "the home course was not stored" }).toBe(course.id);
  await expect(home, "the box does not show the course that was chosen").toHaveValue(NAME);
  await home.click();
  const previous = was!.home ? (await prisma.course.findUniqueOrThrow({ where: { id: was!.home } })).name : "None — choose per tournament";
  await page.getByRole("option", { name: previous }).first().click();
  await expect.poll(clubHome, { timeout: 20_000, message: "the home course was not put back" }).toBe(was!.home);

  // ── used for this tournament, and taken off again ─────────────────────────
  await courses.getByRole("checkbox", { name: `Use ${NAME}` }).check();
  await expect.poll(venues, { timeout: 20_000, message: "the course was not added to the tournament's venues" }).toEqual([...was!.venues, course.id].sort());
  await courses.getByRole("checkbox", { name: `Use ${NAME}` }).uncheck();
  await expect.poll(venues, { timeout: 20_000, message: "the course was not taken off the tournament's venues" }).toEqual(was!.venues);

  // ── a card with scores on it is asked about before it changes ─────────────
  // The fixture's own tournament holds its card itself, so no stored course of the club's has a
  // score on it; this spec made one that has (`PLAYED`, in `beforeAll`). The first and second holes
  // swap pars, 4-5 for 5-4, so the card is still a real one and only the scoring half has changed.
  const playedRow = courses.locator("tbody tr").filter({ hasText: PLAYED }).first();
  await playedRow.getByRole("button", { name: "Edit" }).click();
  expect(await box(courses, "Course name").inputValue(), "the editor did not open on the course that was asked for").toBe(PLAYED);
  const parBoxes = row(courses, /^Par$/);
  await parBoxes.nth(0).fill("5");
  await parBoxes.nth(1).fill("4");
  const swapped = [5, 4, ...PARS.slice(2)];
  const playedCourse = () => prisma.course.findUniqueOrThrow({ where: { id: playedCourseId } });
  const playedEvent = () => prisma.event.findUniqueOrThrow({ where: { id: playedEventId }, select: { courseId: true, customPars: true, customStrokeIndex: true } });

  await courses.getByRole("button", { name: "Save course" }).click();
  await expect(courses.getByText("1 card has already been scored on this course."), "changing a card with a score on it is not asked about").toBeVisible({ timeout: 20_000 });
  await expect(courses, "the question does not name the tournament it would re-score").toContainText(`changing them re-scores ${PLAYED_EVENT}`);
  expect(JSON.parse((await playedCourse()).pars), "a card with a score on it was changed before anybody answered").toEqual(PARS);

  // Cancelled: nothing is changed, and the boxes still hold what was typed.
  await courses.getByRole("button", { name: "Cancel" }).first().click();
  await expect(courses.getByText("1 card has already been scored on this course.")).toHaveCount(0);
  expect(JSON.parse((await playedCourse()).pars), "cancelling the question changed the card").toEqual(PARS);
  expect((await values(parBoxes)).slice(0, 2), "cancelling the question threw away what was typed").toEqual(["5", "4"]);

  // Kept as they were: the course takes the new card, and the round already played keeps the old one.
  await courses.getByRole("button", { name: "Save course" }).click();
  await courses.getByRole("button", { name: "Keep those results as they were" }).click();
  await expect.poll(async () => JSON.parse((await playedCourse()).pars), { timeout: 20_000, message: "the corrected card was not stored" }).toEqual(swapped);
  const kept = await playedEvent();
  expect(JSON.parse(kept.customPars), "the round already played did not keep the card it was scored on").toEqual(PARS);
  expect(JSON.parse(kept.customStrokeIndex), "the round already played did not keep its stroke index").toEqual(SI);
  expect(kept.courseId, "the round already played still follows the corrected card").toBeNull();
  await expect(courses.getByText(`${PLAYED} updated. The rounds already played keep the card they were scored on.`), "the screen does not say what was kept").toBeVisible({ timeout: 20_000 });

  // ── removed: asked first ──────────────────────────────────────────────────
  courses = await open(page);
  await listed().getByRole("button", { name: "Remove", exact: true }).click();
  expect(await stored(), "one press removed a course without asking").not.toBeNull();
  await listed().getByRole("button", { name: "Remove the course" }).click();
  await expect.poll(stored, { timeout: 20_000, message: "the course was not removed" }).toBeNull();
  await expect(listed(), "a removed course is still listed").toHaveCount(0);

  expect(errors, "a screen threw").toEqual([]);
});
