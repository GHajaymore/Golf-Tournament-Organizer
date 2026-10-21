import { test, expect, type Locator, type Page } from "./coverage";
import { createHmac } from "node:crypto";
import { watchPageErrors } from "./page-errors";
import { signedInNow } from "../scripts/session-cookie.mjs";
import { prisma, makeClub, dropClub, makeEvent, signIn, saidBeside, centre, NAMES, type Club } from "./rounds-fixture";

/**
 * A COURSE'S CARD, GIVEN FOUR WAYS, AND A MATCH PLAYED AWAY (2026-10-21).
 *
 * Four actions no browser test performed (the reach report): the card typed on
 * Score entry when a tournament has none (`saveCustomCourse`), a card pasted
 * into the club's library (`importClubCourseCard`), a match moved to another of
 * the club's courses (`setMatchCourse`) and a venue named by the player who
 * played there, in a league with no fixed course (`nameMatchVenue`). Each is
 * done by the person who would, each refusal is pressed where it is met, and
 * each result is read from the rows and from the screen after a reload:
 *
 *   saveCustomCourse      a card whose pars add to 90 → refused beside the
 *                         button, by the SERVER (every box passes the screen's
 *                         own checks); nothing stored. A real card → stored on
 *                         the tournament, and Score entry opens on it
 *   importClubCourseCard  a name the library already holds → refused beside
 *                         Add course; no second row. A new one → in the
 *                         library, imported and unverified, after a reload
 *   setMatchCourse        the secretary moves a match to the away course → the
 *                         match's card reads the AWAY course's pars after a
 *                         reload. A course taken out of the library in another
 *                         tab → refused beside the picker; the match stays put
 *   nameMatchVenue        the player names a course new to the club, with a
 *                         card in sorted order → refused by the server beside
 *                         "Use this course"; nothing stored. The real card and
 *                         tees → a course, a set of tees, the match on both,
 *                         and the card reads that course's pars after a reload
 *
 * `importClubCourseCard` makes no outbound request (it parses the pasted rows
 * and writes a row; the directory and its allowance are other actions), so it
 * is safe to perform here. The card camera beside it is not pressed.
 *
 * WHAT IT CANNOT SEE: a nine-hole venue (which nine is asked for and stored,
 * but no board here is read off it), and a course the library holds with no
 * card — `cardless-venue.audit.test.ts` holds both.
 */

const WALKED = ["desktop", "phone"];
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
const markFor = (what: string, project: string) => `zz-ccv-${what}-${project}`;

/** A home card (par 71, the fixture's) and an away card that differs from it on most holes (par 72). */
const HOME_PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
const AWAY_PARS = [5, 3, 4, 4, 3, 5, 4, 4, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];
const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];
const YARDS = AWAY_PARS.map((p) => (p === 3 ? 165 : p === 4 ? 390 : 515));

test.describe.configure({ timeout: 180_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  await dropClub("zz-ccv-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

/** The `.field` whose own label reads `label` — the card forms label their boxes without `for`. */
function field(scope: Locator, label: RegExp): Locator {
  return scope.locator(".field").filter({ has: scope.page().locator("label", { hasText: label }) }).first();
}

async function openEntry(page: Page) {
  await page.goto(`/entry?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.locator("main h1").first()).toBeVisible();
}

/** The pars printed on a match card's Par row, hole by hole (the Out and In totals left out). */
async function parRow(page: Page): Promise<number[]> {
  const cells = await page.locator("tr.sc-par").first().locator("td").allInnerTexts();
  // Par | 1..9 | Out | 10..18 | In
  const holes = [...cells.slice(1, 10), ...cells.slice(11, 20)];
  return holes.map((c) => Number(c.trim()));
}

async function course(club: Club, name: string, pars: number[]) {
  return prisma.course.create({
    data: {
      organizationId: club.orgId,
      name,
      city: "Invented Bay",
      pars: JSON.stringify(pars),
      yards: JSON.stringify(pars.map((p) => p * 95)),
      strokeIndex: JSON.stringify(SI),
      source: "manual",
    },
  });
}

/** A round robin of one match, in a tournament the club runs. */
async function matchEvent(club: Club, name: string, event: Record<string, unknown>) {
  const made = await makeEvent(club, name, {
    status: "live",
    stages: [{ type: "Round Robin", format: "Match Play", scoringBasis: "gross" }],
    players: 2,
    flights: 1,
    event: { format: "match", customPars: "", customStrokeIndex: "", ...event },
  });
  const match = await prisma.match.create({
    data: {
      eventId: made.event.id,
      stageId: made.stages[0].id,
      groupId: made.flights[0].id,
      round: 1,
      playerAId: made.players[0].id,
      playerBId: made.players[1].id,
      teamAId: "",
      teamBId: "",
      holes: JSON.stringify(new Array(18).fill(null)),
    },
  });
  return { ...made, match };
}

test("Score entry asks for the card, refuses one no course plays beside the button, and opens on the real one", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("custom", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    // A net medal, and no card anywhere: not on the tournament, and no venue.
    const { event } = await makeEvent(club, "Spring Medal", {
      status: "live",
      stages: [{ scoringBasis: "net" }],
      event: { course: `${mark} Rowan Hill`, customPars: "", customStrokeIndex: "" },
    });
    await signIn(context, baseURL!, club, event.id);
    await openEntry(page);
    await expect(page.getByText("Set up this course"), "Score entry did not ask for a card").toBeVisible();

    const typeCard = async (pars: number[]) => {
      const summary = page.getByText("Or type the card in by hand");
      if ((await page.locator("details").first().getAttribute("open")) === null) await summary.click();
      for (let h = 0; h < 18; h++) {
        await page.getByLabel(`Par, hole ${h + 1}`, { exact: true }).fill(String(pars[h]));
        await page.getByLabel(new RegExp(`^(Yards|Metres), hole ${h + 1}$`)).fill(String(YARDS[h]));
        await page.getByLabel(`S.I., hole ${h + 1}`, { exact: true }).fill(String(SI[h]));
      }
    };

    await test.step("pars that add to 90: every box passes the screen, and the server refuses beside the button", async () => {
      await typeCard(new Array(18).fill(5));
      const save = page.getByRole("button", { name: /Save course & start scoring/ });
      await centre(save);
      await save.click();
      const refused = page.getByText("These pars add up to 90, which no 18-hole course plays.", { exact: false });
      await expect(refused, "a card no course plays was not refused in words").toBeVisible({ timeout: 20_000 });
      await saidBeside(refused, save, "a card adding to 90");
      const row = await prisma.event.findUniqueOrThrow({ where: { id: event.id }, select: { customPars: true } });
      expect(row.customPars, "the refused card was stored").toBe("");
    });

    await test.step("the real card: stored on the tournament, and Score entry opens on it after a reload", async () => {
      await typeCard(AWAY_PARS);
      await page.getByRole("button", { name: /Save course & start scoring/ }).click();
      await expect
        .poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: event.id }, select: { customPars: true } })).customPars, {
          message: "the card was not stored on the tournament",
          timeout: 20_000,
        })
        .toBe(JSON.stringify(AWAY_PARS));
      const row = await prisma.event.findUniqueOrThrow({ where: { id: event.id }, select: { customStrokeIndex: true, customYards: true, course: true } });
      expect(row.customStrokeIndex).toBe(JSON.stringify(SI));
      expect(row.customYards).toBe(JSON.stringify(YARDS));
      expect(row.course).toBe(`${mark} Rowan Hill`);
      await openEntry(page);
      await expect(page.getByText("Set up this course"), "Score entry still asks for a card it has").toHaveCount(0);
    });
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a card pasted into the library: a name it already holds is refused beside Add course, a new one is added", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("import", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const held = await course(club, `${mark} Rowan Hill`, HOME_PARS);
    const { event } = await makeEvent(club, "Summer Stableford", { stages: [{}] });
    await signIn(context, baseURL!, club, event.id);
    const openLibrary = async () => {
      await page.goto(`/event?bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
    };
    await openLibrary();
    await page.getByRole("button", { name: "Paste a card" }).click();
    const card = page.locator(".card", { has: page.getByText("Paste a course card", { exact: true }) }).last();
    const paste = async (name: string) => {
      await field(card, /^Course name$/).locator("input").fill(name);
      await field(card, /^Par$/).locator("textarea").fill(`Par ${AWAY_PARS.slice(0, 9).join(" ")} 36 ${AWAY_PARS.slice(9).join(" ")} 36 72`);
      await field(card, /^Stroke index$/).locator("textarea").fill(`S.I. ${SI.join(" ")}`);
      await field(card, /^Yards/).locator("textarea").fill(`Yards ${YARDS.join(" ")}`);
      await field(card, /^Where it came from/).locator("input").fill("https://rowanhill.example.invalid/card");
      await expect(card.getByText(/Reads as\s+par 72/), "the pasted card was not read as par 72").toBeVisible();
    };

    await test.step("a name the library already holds: refused beside Add course, and no second row", async () => {
      await paste(held.name.toUpperCase());
      const add = card.getByRole("button", { name: "Add course" });
      await centre(add);
      await add.click();
      const refused = card.getByText(`${held.name} is already in your course library.`);
      await expect(refused, "a second card under one name was not refused in words").toBeVisible({ timeout: 20_000 });
      await saidBeside(refused, add, "a name already in the library");
      expect(await prisma.course.count({ where: { organizationId: club.orgId } }), "a second course was made under one name").toBe(1);
    });

    await test.step("a new course: stored as an imported, unverified card, and in the library after a reload", async () => {
      await field(card, /^Course name$/).locator("input").fill(`${mark} Craigmore Links`);
      await card.getByRole("button", { name: "Add course" }).click();
      await expect
        .poll(async () => prisma.course.findFirst({ where: { organizationId: club.orgId, name: `${mark} Craigmore Links` } }), { message: "the pasted course was not stored", timeout: 20_000 })
        .not.toBeNull();
      const made = await prisma.course.findFirstOrThrow({ where: { organizationId: club.orgId, name: `${mark} Craigmore Links` } });
      expect(JSON.parse(made.pars), "the pars stored are not the pars pasted").toEqual(AWAY_PARS);
      expect(JSON.parse(made.strokeIndex)).toEqual(SI);
      expect(JSON.parse(made.yards)).toEqual(YARDS);
      expect(made.source).toBe("imported");
      expect(made.verifiedAt, "a pasted card was marked checked").toBeNull();
      expect(made.sourceUrl).toBe("https://rowanhill.example.invalid/card");
      await openLibrary();
      await expect(page.getByText(`${mark} Craigmore Links`).first(), "the pasted course is not in the library after a reload").toBeVisible();
    });
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the secretary moves a match to the away course and its card reads the away pars; a course gone from the library is refused beside the picker", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("away", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const home = await course(club, `${mark} Rowan Hill`, HOME_PARS);
    const away = await course(club, `${mark} Craigmore Links`, AWAY_PARS);
    const spare = await course(club, `${mark} Dunholm Heath`, AWAY_PARS);
    const { event, match } = await matchEvent(club, "Matchplay League", { course: home.name });
    await prisma.eventCourse.create({ data: { eventId: event.id, courseId: home.id } });
    await signIn(context, baseURL!, club, event.id);
    const stored = async () => (await prisma.match.findUniqueOrThrow({ where: { id: match.id }, select: { courseId: true } })).courseId;

    await openEntry(page);
    await expect(page.getByText(home.name, { exact: true }).first(), "the match does not say it is played at the home course").toBeVisible();
    expect(await parRow(page), "the match card does not read the home pars").toEqual(HOME_PARS);

    const choose = async (name: string, before?: () => Promise<void>) => {
      await page.getByRole("button", { name: "Change for this match" }).click();
      // The MATCH's picker. Once the away course is one of the tournament's venues the round's
      // own "Played at" is drawn too, with nothing chosen ("Not set").
      const picker = page.locator('input[role="combobox"][aria-label="Played at"]:not([placeholder="Not set"])');
      await expect(picker).toHaveCount(1);
      await centre(picker);
      await picker.click();
      await picker.fill(name.slice(mark.length + 1));
      const option = page.getByRole("option", { name: new RegExp(name.slice(mark.length + 1)) }).first();
      await expect(option, `${name} is not offered`).toBeVisible();
      await before?.();
      await option.click();
      return picker;
    };

    await test.step("moved to the away course: stored, and the card reads the away pars after a reload", async () => {
      await choose(away.name);
      await expect.poll(stored, { message: "the match's venue was not stored", timeout: 20_000 }).toBe(away.id);
      expect(await prisma.eventCourse.count({ where: { eventId: event.id, courseId: away.id } }), "the away course was not made one of the tournament's venues").toBe(1);
      await openEntry(page);
      await expect(page.getByText(away.name, { exact: true }).first(), "the match does not say it was played away").toBeVisible();
      expect(await parRow(page), "the match card does not read the away course's pars").toEqual(AWAY_PARS);
    });

    await test.step("a course taken out of the library in another tab: refused beside the picker, and the match stays away", async () => {
      const picker = await choose(spare.name, async () => {
        await prisma.course.delete({ where: { id: spare.id } });
      });
      const refused = page.getByText("That course isn't in this club's library.");
      await expect(refused, "a course no longer in the library was not refused in words").toBeVisible({ timeout: 20_000 });
      // Beside the picker that was pressed — soft, so the rows are still read when it is not.
      const [a, b] = [await refused.boundingBox(), await picker.boundingBox()];
      const gap = a && b ? Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height)) : Infinity;
      await expect.soft(refused, "a course gone from the library: the refusal is not on the screen").toBeInViewport();
      expect.soft(gap, `a course gone from the library: the refusal is ${Math.round(gap)}px from the picker that was pressed`).toBeLessThanOrEqual(200);
      expect(await stored(), "the refused course was stored").toBe(away.id);
      await openEntry(page);
      expect(await parRow(page), "the match card moved off the away course").toEqual(AWAY_PARS);
    });
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("in a league with no fixed course the player names where they played: a card in sorted order is refused beside the button, the real one is kept", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "player");
  const mark = markFor("venue", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, match } = await matchEvent(club, "Open League", { courseMode: "open", course: "" });
    // The player of the match, signed in as themselves.
    const me = await prisma.user.create({ data: { email: `${mark}-p0@example.invalid`, name: NAMES[0], password: "x:unusable" } });
    await prisma.account.create({ data: { eventId: event.id, email: me.email, name: NAMES[0], role: "player" } });
    await context.addCookies([
      { name: "ng_session", value: sign(signedInNow(me.id)), url: baseURL! },
      { name: "ng_active_event", value: sign(event.id), url: baseURL! },
    ]);
    const NAME = `${mark} Craigmore Links`;
    await openEntry(page);
    const prompt = page.locator(".card", { has: page.getByText("Where was this played?") });
    await expect(prompt, "the player was not asked where the match was played").toBeVisible();

    const typeCard = async (pars: number[]) => {
      for (let h = 0; h < 18; h++) {
        await prompt.getByLabel(`Par hole ${h + 1}`, { exact: true }).fill(String(pars[h]));
        await prompt.getByLabel(`Stroke index hole ${h + 1}`, { exact: true }).fill(String(SI[h]));
      }
    };
    await field(prompt, /^Golf course$/).locator("input").fill(NAME);
    await expect(prompt.getByText(/New to this/), "a course new to the club was not said to be new").toBeVisible();
    await field(prompt, /^Tees$/).locator("input").fill("Blue");
    await field(prompt, /^Rating$/).locator("input").fill("70.1");
    await field(prompt, /^Slope$/).locator("input").fill("125");
    await field(prompt, /^Par$/).locator("input").fill("72");

    await test.step("a card in sorted order: passes the screen, refused by the server beside the button; nothing stored", async () => {
      await typeCard([3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5]);
      const use = prompt.getByRole("button", { name: /Use this course/ });
      await centre(use);
      await use.click();
      const refused = prompt.getByText("These pars are in sorted order rather than hole order", { exact: false });
      await expect(refused, "a card in sorted order was not refused in words").toBeVisible({ timeout: 20_000 });
      await saidBeside(refused, use, "a card in sorted order");
      expect(await prisma.course.count({ where: { organizationId: club.orgId } }), "the refused card was stored as a course").toBe(0);
      expect((await prisma.match.findUniqueOrThrow({ where: { id: match.id } })).courseId).toBeNull();
    });

    await test.step("the real card and tees: a course, its tees, the match on both — and the card reads its pars after a reload", async () => {
      await typeCard(AWAY_PARS);
      const use = prompt.getByRole("button", { name: /Use this course/ });
      await use.click();
      const pointed = async () => (await prisma.match.findUniqueOrThrow({ where: { id: match.id } })).courseId;
      /**
       * WITHOUT YARDAGES, which the screen labels "optional" — and which nothing scores off
       * (CLAUDE.md, "Course cards": yardage "must never be why a card is thrown away"). Asserted
       * softly so that, when the server refuses it, the walk goes on with the lengths typed in.
       */
      const yardage = prompt.getByText("That yardage looks wrong for a golf hole.", { exact: false });
      await expect.poll(async () => (await pointed()) !== null || (await yardage.isVisible()), { timeout: 20_000 }).toBe(true);
      expect.soft(await yardage.isVisible(), "a card with its optional yardages left empty was refused: \"That yardage looks wrong for a golf hole\"").toBe(false);
      if ((await pointed()) === null && (await yardage.isVisible())) {
        for (let h = 0; h < 18; h++) await prompt.getByLabel(`Yards hole ${h + 1}`, { exact: true }).fill(String(YARDS[h]));
        await use.click();
      }
      await expect.poll(pointed, { message: "the match was not pointed at the course named", timeout: 20_000 }).not.toBeNull();
      const m = await prisma.match.findUniqueOrThrow({ where: { id: match.id } });
      const made = await prisma.course.findUniqueOrThrow({ where: { id: m.courseId! }, include: { tees: true } });
      expect(made.name).toBe(NAME);
      expect(made.organizationId, "the course did not join the club's library").toBe(club.orgId);
      expect(JSON.parse(made.pars)).toEqual(AWAY_PARS);
      expect(JSON.parse(made.strokeIndex)).toEqual(SI);
      expect(made.tees.map((t) => [t.name, t.courseRating, t.slopeRating, t.par]), "the tees played were not kept").toEqual([["Blue", 70.1, 125, 72]]);
      expect(m.teeId, "the match is not pointed at the tees played").toBe(made.tees[0].id);
      expect(await prisma.eventCourse.count({ where: { eventId: event.id, courseId: made.id } }), "the course was not made one of the tournament's venues").toBe(1);
      await openEntry(page);
      await expect(page.getByText("Where was this played?"), "the player is asked again after answering").toHaveCount(0);
      await expect(page.getByText(NAME, { exact: true }).first()).toBeVisible();
      expect(await parRow(page), "the match card does not read the named course's pars").toEqual(AWAY_PARS);
    });
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
