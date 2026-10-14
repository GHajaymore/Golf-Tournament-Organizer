import { createHmac, randomBytes } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { seed, teardown } from "../scripts/seed-club.mjs";

/**
 * THE ORGANIZER DECIDES THE TEES — TOURNAMENT, THEN FLIGHT, THEN ONE PLAYER —
 * AND WHAT EVERYBODY PLAYS OFF FOLLOWS.
 *
 * Ajay, 2026-10-13: "for any tournament, it should be the organizer who should
 * decide who is playing from what tees based on the flights or some other
 * criteria"; a seniors' championship sets them for the tournament, a club
 * championship of men, seniors and ladies sets or overrides them by flight, and
 * the organizer can change one player. "Use the common sense of defaulting the
 * tees based on gender."
 *
 * Until that day an ENTRANT could put themselves on any tees: the public entry
 * form asked for a "Preferred tee" and what was typed became the set they were
 * scored off, ahead of their flight's. No test had ever asked who put a player
 * on a set — only whether a set, once there, was honoured.
 *
 * A mixed open is made at the seeded club's own course (Blue and White, par 71,
 * and the Red ladies' set, par 72) with three entrants who have no tees of
 * their own, and run as its secretary:
 *
 *   Registration           → beside each player, what they play if left alone
 *                             and whose decision that is: the woman "Red
 *                             (ladies’)", the others "White (tournament’s)"
 *   the round's handicaps  → each player's playing handicap is the Rule's off
 *                             THOSE tees, and the woman's says it includes a
 *                             stroke for tees of a higher par (Rule 6.2b)
 *   a flight is put on the → both of its players read "Blue (flight’s)" and
 *   Blues, on Flights         play off the Blues; the third is untouched
 *   one player is moved    → she plays off the Reds again, by the organizer's
 *   back, on Registration     own choice; her flight-mate does not move
 *   "Everyone plays the    → the per-player Tees column is gone, and all three
 *   tournament's tees"        play off the Whites with no stroke for the pars
 *   the public entry form  → does not ask which tees
 *
 * Every figure is worked here from the tees' ratings in whole numbers, sharing
 * nothing with the app: the allowance of the course handicap BEFORE it is
 * rounded (6.2a), rounded once, then the difference in pars (6.2b).
 *
 * WHAT IT CANNOT SEE: a card being scored off these handicaps (the boards are
 * held to the same figures by `boards-by-the-rules.spec.ts`, and the readers to
 * each other by `every-reader-gives-the-strokes-for-the-pars.audit.test.ts`),
 * and that an entry made through each of the three doors lands with no tees
 * (`the-organizer-decides-the-tees.audit.test.ts`, which also turns a player
 * away from the action).
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
const WALKED = ["desktop", "phone"];
const MARK = "zz-tees";

type Club = Awaited<ReturnType<typeof seed>>;
let club: Club;
test.beforeAll(async ({}, testInfo) => {
  if (!WALKED.includes(testInfo.project.name)) return;
  club = await seed();
});
test.afterAll(async ({}, testInfo) => {
  if (WALKED.includes(testInfo.project.name)) {
    await prisma.event.deleteMany({ where: { name: { startsWith: MARK } } });
    await teardown();
  }
  await prisma.$disconnect();
});

// ── The Rules, in whole numbers, sharing nothing with the app ───────────────
type Tee = { id: string; name: string; courseRating: number; slopeRating: number; par: number };
/** Nearest whole number, a half upwards: floor((2n + d) / 2d). */
const nearest = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));
/** An unrounded course handicap in 1,130ths of a stroke. */
const course1130 = (indexTenths: number, tee: Tee) =>
  indexTenths * tee.slopeRating + (Math.round(tee.courseRating * 10) - tee.par * 10) * 113;
/** What a player plays off: the allowance before rounding (6.2a), then the strokes for a higher par (6.2b). */
const playsOff = (indexTenths: number, tee: Tee, pct: number, lowestPar: number) =>
  nearest(course1130(indexTenths, tee) * pct, 113_000) + Math.max(0, tee.par - lowestPar);

test("the organizer sets the tees for the tournament, a flight and one player, and each player's handicap follows", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  test.setTimeout(240_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");

  // ── a mixed open at the seeded club's own course ──────────────────────────
  const teeRows = await prisma.tee.findMany({ where: { course: { organizationId: club.org.id } } });
  const redRow = teeRows.find((t) => t.name === "Red");
  expect(redRow, "the seeded club's course has no Red set").toBeTruthy();
  const at = teeRows.filter((t) => t.courseId === redRow!.courseId);
  const tee = (name: string): Tee => {
    const t = at.find((x) => x.name === name);
    expect(t, `the seeded course has no ${name} set`).toBeTruthy();
    return { id: t!.id, name, courseRating: t!.courseRating, slopeRating: t!.slopeRating, par: t!.par };
  };
  const [WHITE, RED, BLUE] = [tee("White"), tee("Red"), tee("Blue")];
  // CONTROLS on the fixture: the ladies' set is the only one of a higher par, and is marked as theirs.
  expect([WHITE.par, BLUE.par, RED.par]).toEqual([71, 71, 72]);
  expect(at.filter((t) => /^(women|female)$/i.test(t.gender)).map((t) => t.name)).toEqual(["Red"]);

  const courseRow = await prisma.course.findUniqueOrThrow({ where: { id: redRow!.courseId } });
  const token = randomBytes(6).toString("hex");
  const event = await prisma.event.create({
    data: {
      organizationId: club.org.id,
      name: `${MARK} Mixed Open ${testInfo.project.name}`,
      status: "registration",
      shape: "single",
      format: "stroke",
      formationRule: "manual",
      dates: "",
      course: courseRow.name,
      city: "",
      address: "",
      regDeadline: "",
      capacity: 40,
      registrationOpen: true,
      registrationApproval: "auto",
      registrationToken: token,
      shareToken: randomBytes(10).toString("hex"),
      customPars: courseRow.pars,
      customYards: courseRow.yards,
      customStrokeIndex: courseRow.strokeIndex,
      courseId: courseRow.id,
      defaultTeeId: WHITE.id,
      teePolicy: "own",
    },
  });
  await prisma.eventCourse.create({ data: { eventId: event.id, courseId: courseRow.id } });
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "net" },
  });
  // Three entrants with NO tees of their own — which is how every entry lands now.
  const FIELD = [
    { key: "ann", name: `${MARK} Ann Reyes`, gender: "female", indexTenths: 120 },
    { key: "bob", name: `${MARK} Bob Okafor`, gender: "male", indexTenths: 204 },
    { key: "dee", name: `${MARK} Dee Lindqvist`, gender: "", indexTenths: 51 },
  ] as const;
  const idOf: Record<string, string> = {};
  for (const [i, p] of FIELD.entries()) {
    const row = await prisma.player.create({
      data: {
        eventId: event.id,
        name: p.name,
        email: `${MARK}.${p.key}.${testInfo.project.name}@example.invalid`,
        seed: i + 1,
        status: "confirmed",
        handicap: p.indexTenths / 10,
        gender: p.gender,
      },
    });
    idOf[p.key] = row.id;
  }
  const flight = await prisma.group.create({ data: { eventId: event.id, name: `${MARK} Seniors`, position: 0 } });
  await prisma.player.updateMany({ where: { id: { in: [idOf.ann, idOf.bob] } }, data: { groupId: flight.id } });

  await context.addCookies([
    { name: "ng_session", value: club.organizer.session, url: baseURL! },
    { name: "ng_active_event", value: sign(event.id), url: baseURL! },
  ]);

  /** What Registration says a player plays if nobody moves them: the Tees box's own blank option. */
  const registrationSays = async () => {
    await page.goto(`/registration?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const out: Record<string, string> = {};
    for (const p of FIELD) {
      const box = page.getByLabel(`Tees for ${p.name}`, { exact: true });
      if ((await box.count()) === 0) {
        out[p.key] = "(no Tees box)";
        continue;
      }
      out[p.key] = ((await box.first().locator("option:checked").innerText()) ?? "").trim();
    }
    return out;
  };
  /** The round's own handicap list, opened: each player's line of words. */
  const handicapLines = async () => {
    await page.goto(`/stages?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const card = page.locator("main .card", { has: page.locator("button", { hasText: /Round 1/ }) }).first();
    await expect(card, "Rounds & formats has no card for Round 1").toBeVisible();
    const heading = card.getByText("Handicaps for this round", { exact: true });
    if (!(await heading.isVisible().catch(() => false))) await card.locator("button", { hasText: /Round 1/ }).first().click();
    await expect(heading, "the round's card has no handicap list").toBeVisible();
    await card.getByRole("button", { name: "Set one for this round", exact: true }).click();
    const out: Record<string, string> = {};
    for (const p of FIELD) {
      const row = card.locator("div", { has: page.locator("span", { hasText: p.name }) }).last();
      await expect(row, `the round's handicap list has no line for ${p.name}`).toBeVisible();
      out[p.key] = ((await row.innerText()) ?? "").replace(/\s+/g, " ").trim();
    }
    return out;
  };
  /** Holds the list to the Rules: who is on which tees, at the round's 95%. */
  const holds = async (on: Record<string, Tee>, what: string) => {
    const lowestPar = Math.min(...Object.values(on).map((t) => t.par));
    const lines = await handicapLines();
    for (const p of FIELD) {
      const t = on[p.key];
      const want = playsOff(p.indexTenths, t, 95, lowestPar);
      const figure = want > 0 ? String(want) : want === 0 ? "scratch" : `+${-want}`;
      expect(lines[p.key], `${what}: ${p.name} is on the ${t.name}`).toContain(`plays off ${figure} at 95%`);
      const forPars = t.par - lowestPar;
      if (forPars > 0) expect(lines[p.key], `${what}: ${p.name}`).toContain(`with ${forPars} stroke for tees of a higher par`);
      else expect(lines[p.key], `${what}: ${p.name}`).not.toContain("higher par");
    }
    return lines;
  };

  try {
    // CONTROL: on this field the three sets give different figures, so a player on the wrong tees is seen.
    for (const p of FIELD) {
      const three = new Set([WHITE, RED, BLUE].map((t) => playsOff(p.indexTenths, t, 95, 71)));
      expect(three.size, `${p.name} plays off the same figure from two sets, so the wrong tees could not show`).toBeGreaterThanOrEqual(2);
    }
    expect(playsOff(120, RED, 95, 71), "Ann off the reds and off the whites").not.toBe(playsOff(120, WHITE, 95, 71));

    // ── nothing set: the tournament's tees, and the ladies' set for a woman ──
    expect(await registrationSays()).toEqual({
      ann: "Red (ladies’)",
      bob: "White (tournament’s)",
      dee: "White (tournament’s)",
    });
    await holds({ ann: RED, bob: WHITE, dee: WHITE }, "with nothing set");

    // ── a flight is put on the Blues ─────────────────────────────────────────
    await page.goto(`/grouping?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const flightTees = page.locator('main select[aria-label^="Tees for"]').first();
    await expect(flightTees, "Flights & groups offers no Tees box for the flight").toBeVisible();
    await flightTees.selectOption({ label: "Blue" });
    await expect
      .poll(async () => (await prisma.group.findUniqueOrThrow({ where: { id: flight.id } })).teeId, { message: "the flight's tees were not stored" })
      .toBe(BLUE.id);
    expect(await registrationSays()).toEqual({
      ann: "Blue (flight’s)",
      bob: "Blue (flight’s)",
      dee: "White (tournament’s)",
    });
    await holds({ ann: BLUE, bob: BLUE, dee: WHITE }, "with the flight on the Blues");

    // ── one player is moved, by the organizer ────────────────────────────────
    await page.goto(`/registration?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByLabel(`Tees for ${FIELD[0].name}`, { exact: true }).first().selectOption({ label: "Red" });
    await expect
      .poll(async () => (await prisma.player.findUniqueOrThrow({ where: { id: idOf.ann } })).teeId, { message: "the player's own tees were not stored" })
      .toBe(RED.id);
    await page.goto(`/registration?bust=${Date.now()}`);
    await expect(page.getByLabel(`Tees for ${FIELD[0].name}`, { exact: true }).first(), "the box does not show the set she was moved to").toHaveValue(RED.id);
    await holds({ ann: RED, bob: BLUE, dee: WHITE }, "with Ann moved back to the Reds");

    // ── one set for everyone ─────────────────────────────────────────────────
    await page.goto(`/event?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByText("Who may play other tees", { exact: true }).first(), "Tournament details does not ask who may play other tees").toBeVisible();
    await expect(page.locator("label", { hasText: /choose their own tees/i }), "a player choosing their own tees is still offered").toHaveCount(0);
    await page.locator("label", { hasText: "Everyone plays the tournament's tees" }).first().click();
    const save = page.getByRole("button", { name: /^Save settings/ }).first();
    await expect(save).toBeEnabled();
    await save.click();
    await expect
      .poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).teePolicy, { message: "the tee setting was not stored" })
      .toBe("one");
    expect(await registrationSays(), "a per-player Tees box is drawn under one set for everyone").toEqual({
      ann: "(no Tees box)",
      bob: "(no Tees box)",
      dee: "(no Tees box)",
    });
    await holds({ ann: WHITE, bob: WHITE, dee: WHITE }, "with one set for everyone");

    // ── and nobody entering is asked which tees ──────────────────────────────
    const visitor = await context.browser()!.newContext();
    const form = await visitor.newPage();
    const visitorErrors: string[] = [];
    watchPageErrors(form, visitorErrors, "an entrant");
    await form.goto(`/register/${token}`);
    await expect(form.getByLabel(/^Handicap index/).first(), "the entry form did not open").toBeVisible();
    await expect(form.getByText(/Preferred tee/i), "the entry form still asks which tees").toHaveCount(0);
    await expect(form.locator("input").filter({ has: form.locator("xpath=self::*[contains(@id,'-tee')]") }), "a tee box is still on the entry form").toHaveCount(0);
    expect(visitorErrors, visitorErrors.join("\n")).toEqual([]);
    await visitor.close();

    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await prisma.event.deleteMany({ where: { id: event.id } });
  }
  // Used only to keep the round in hand for the fixture above.
  expect(stage.id).toBeTruthy();
});
