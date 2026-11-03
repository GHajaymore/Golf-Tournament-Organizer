import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";
import { prisma, dayIn, addDays } from "./rounds-fixture";

/**
 * THE SETUP QUESTIONNAIRE, DONE AS A NEW ORGANIZER WOULD DO IT (2 Nov).
 *
 * A one-person outfit in Florida with no tournament yet, two courses saved (one
 * with a rated set of tees, one with none), walks "Set up with a few questions"
 * from the create card three times:
 *
 *   medal       every default kept; the card checked against the club's; the
 *               course with no tees refused beside the press first
 *   scramble    "In teams of four"; the course picked later
 *   outing      "Two or three days"; two rounds on consecutive days
 *
 * and each lands on the dashboard with a DRAFT whose rounds, days (the CLUB's —
 * Florida's — next Saturday, counted here from the calendar, not by the app's
 * helper), course, tees and checked card are read back from the database.
 */

const WALKED = ["desktop", "phone"];
const ZONE = "America/New_York";
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];

test.describe.configure({ timeout: 180_000 });
test.use({ actionTimeout: 15_000 });
test.afterAll(async () => {
  await prisma.$disconnect();
});

/** The Saturday after the club's today (a Saturday today means the next one), by the calendar. */
function saturdayAfter(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return addDays(iso, weekday === 6 ? 7 : 6 - weekday);
}

async function makeOrganizer(mark: string) {
  await drop(mark);
  const org = await prisma.organization.create({
    data: { name: `${mark} Sunshine Outings`, kind: "personal", country: "US", timeZone: ZONE, themeAppearance: "auto" },
  });
  const user = await prisma.user.create({
    data: { email: `${mark}-organizer@example.invalid`, name: "Casey Organizer", password: "x:unusable", emailVerifiedAt: new Date() },
  });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "owner" } });
  const rated = await prisma.course.create({
    data: {
      organizationId: org.id,
      name: `${mark} Palmetto Links`,
      pars: JSON.stringify(PARS),
      strokeIndex: JSON.stringify(SI),
      yards: JSON.stringify(PARS.map((p) => p * 100 + 20)),
      tees: { create: [{ name: "White", courseRating: 70.4, slopeRating: 126, par: 72 }] },
    },
    include: { tees: true },
  });
  const bare = await prisma.course.create({
    data: { organizationId: org.id, name: `${mark} Cypress Fields`, pars: JSON.stringify(PARS), strokeIndex: JSON.stringify(SI), yards: "[]" },
  });
  return { orgId: org.id, userId: user.id, session: sign(signedInNow(user.id)), rated, bare };
}

async function drop(mark: string) {
  await prisma.organization.deleteMany({ where: { name: { startsWith: mark } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: mark } } });
}

/** Press the answer, pressing Next until its question is on screen (a phone shows one at a time). */
async function answer(page: Page, label: string) {
  const choice = page.getByRole("button", { name: new RegExp(`^${label}`) });
  for (let i = 0; i < 8 && !(await choice.isVisible()); i += 1) await page.getByRole("button", { name: "Next" }).click();
  await choice.click();
  await expect(choice).toHaveAttribute("aria-pressed", "true");
}

/** On to the review: through every remaining question on a phone, one press on a desktop. */
async function toReview(page: Page) {
  const next = page.getByRole("button", { name: "Next" });
  for (let i = 0; i < 8 && (await next.isVisible()); i += 1) await next.click();
  await page.getByRole("button", { name: "See your tournament" }).click();
  await expect(page.getByRole("heading", { name: "Here is your tournament — change anything" })).toBeVisible();
}

async function start(page: Page) {
  await page.goto(`/choose?stay=1&bust=${Date.now()}`);
  await page.getByRole("link", { name: "Set up with a few questions" }).click();
  await expect(page.getByRole("heading", { name: "Set up with a few questions" })).toBeVisible();
}

async function create(page: Page, name: string) {
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("heading", { name: "Ready to make the draft" })).toBeVisible();
  await page.getByRole("button", { name: "Create the draft" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.getByText(name).first()).toBeVisible();
}

const draft = (orgId: string, name: string) =>
  prisma.event.findFirst({
    where: { organizationId: orgId, name },
    include: { stages: { orderBy: { position: "asc" } } },
  });

test("a new organizer sets up a medal, a scramble and a two-day outing from a few questions", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "organizer");
  const mark = `zz-setupq-${testInfo.project.name}`;
  const o = await makeOrganizer(mark);
  const saturday = saturdayAfter(dayIn(ZONE));
  try {
    await context.addCookies([{ name: "ng_session", value: o.session, url: baseURL! }]);

    await test.step("medal: every default kept, the card checked, a course with no tees refused", async () => {
      await start(page);
      await toReview(page);
      const name = `${mark} Medal`;
      await page.getByLabel("Tournament name").fill(name);
      await expect(page.getByText("95% for Stroke Play")).toBeVisible();
      await page.getByRole("button", { name: "Check the scorecard" }).click();

      await page.getByLabel("Course", { exact: true }).selectOption({ label: `${mark} Cypress Fields` });
      const refused = page.getByRole("alert").filter({ hasText: "has no tees yet" });
      await expect(refused, "a course with no tees was not refused in words").toBeVisible();
      await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0);

      await page.getByLabel("Course", { exact: true }).selectOption({ label: `${mark} Palmetto Links` });
      await page.getByLabel("Tees the field plays from").selectOption({ label: "White" });
      await expect(page.getByText("course rating 70.4 · slope 126")).toBeVisible();
      await expect(page.getByRole("row", { name: /^Par/ })).toContainText("72");
      await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0);
      await page.getByLabel("This matches the club’s card").check();
      await create(page, name);

      const e = await draft(o.orgId, name);
      expect(e?.status).toBe("draft");
      expect(e?.shape).toBe("single");
      expect(e?.format).toBe("stroke");
      expect([e?.startOn, e?.endOn]).toEqual([saturday, saturday]);
      expect(e?.courseId).toBe(o.rated.id);
      expect(e?.defaultTeeId).toBe(o.rated.tees[0].id);
      expect(e?.stages.map((s) => [s.type, s.format, s.scoringBasis, s.holes, s.playedOn, s.handicapAllowance])).toEqual([
        ["Stroke Play Round", "Stroke Play", "net", 18, saturday, 0],
      ]);
      const course = await prisma.course.findUnique({ where: { id: o.rated.id } });
      expect(course?.verifiedAt, "ticking the card did not record it as checked").not.toBeNull();
    });

    await test.step("scramble: teams of four, the course picked later", async () => {
      await start(page);
      await answer(page, "In teams of four");
      await toReview(page);
      const name = `${mark} Scramble`;
      await page.getByLabel("Tournament name").fill(name);
      await expect(page.getByText("25% for Scramble")).toBeVisible();
      await page.getByRole("button", { name: "Check the scorecard" }).click();
      await create(page, name);

      const e = await draft(o.orgId, name);
      expect(e?.status).toBe("draft");
      expect(e?.leaderboardVisibility).toBe("public");
      expect(e?.scoreEntryBy).toBe("players");
      expect(e?.stages.map((s) => [s.type, s.format, s.scoringBasis, s.playedOn])).toEqual([
        ["Stroke Play Round", "Scramble", "net", saturday],
      ]);
    });

    await test.step("two-day outing: two rounds on consecutive days, Change keeps the answers", async () => {
      await start(page);
      await answer(page, "Two or three days");
      await toReview(page);
      // Going back to a question keeps every answer.
      await page.getByRole("button", { name: "Change" }).first().click();
      await expect(page.getByRole("button", { name: /^Two or three days/ })).toHaveAttribute("aria-pressed", "true");
      await toReview(page);
      const name = `${mark} Two-Day`;
      await page.getByLabel("Tournament name").fill(name);
      await page.getByRole("button", { name: "Check the scorecard" }).click();
      await create(page, name);

      const e = await draft(o.orgId, name);
      expect(e?.shape).toBe("series");
      expect([e?.startOn, e?.endOn]).toEqual([saturday, addDays(saturday, 1)]);
      expect(e?.stages.map((s) => [s.type, s.format, s.playedOn, s.description])).toEqual([
        ["Stroke Play Round", "Stroke Play", saturday, "Day 1 of 2"],
        ["Stroke Play Round", "Stroke Play", addDays(saturday, 1), "Day 2 of 2"],
      ]);
    });

    await test.step("fix the card: the course's own card screen opens on it; one index and one rating changed there", async () => {
      await start(page);
      await toReview(page);
      const name = `${mark} Fixed Card`;
      await page.getByLabel("Tournament name").fill(name);
      await page.getByRole("button", { name: "Check the scorecard" }).click();
      await page.getByLabel("Course", { exact: true }).selectOption({ label: `${mark} Palmetto Links` });
      await page.getByRole("button", { name: "Fix the card" }).click();
      await page.getByRole("button", { name: "Create the draft and open the card" }).click();
      await page.waitForURL(/\/event\?course=/, { timeout: 30_000 });

      // The course library's own editor, open on this course — never a second card editor.
      const courses = page.locator("#courses");
      // Holes 1 and 2 swap indexes (7 ↔ 3), so the card is still a whole 1–18 and `cardRefusal` lets it through.
      await courses.getByLabel("Stroke index, hole 1", { exact: true }).fill("3");
      await courses.getByLabel("Stroke index, hole 2", { exact: true }).fill("7");
      await courses.getByRole("button", { name: "Save course" }).click();
      await expect
        .poll(async () => JSON.parse((await prisma.course.findUniqueOrThrow({ where: { id: o.rated.id } })).strokeIndex).slice(0, 2), {
          timeout: 20_000,
          message: "the index changed on the card screen was not stored",
        })
        .toEqual([3, 7]);

      await courses.getByTitle("Edit these tees").first().click();
      await courses.getByLabel("Course Rating", { exact: true }).fill("71.2");
      await courses.getByRole("button", { name: "Save tees" }).click();
      await expect
        .poll(async () => (await prisma.tee.findUniqueOrThrow({ where: { id: o.rated.tees[0].id } })).courseRating, {
          timeout: 20_000,
          message: "the rating changed on the card screen was not stored",
        })
        .toBe(71.2);

      const e = await draft(o.orgId, name);
      expect(e?.status).toBe("draft");
      expect(e?.courseId, "the draft was not made on the course whose card was fixed").toBe(o.rated.id);
    });

    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await drop(mark);
  }
});
