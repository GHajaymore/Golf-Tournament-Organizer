import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, gotoStages, openRound, openCustomize, saidBeside, pick, centre, NAMES } from "./rounds-fixture";

/**
 * A MATCH-PLAY TOURNAMENT'S OWN RULES, SET ON ROUNDS & FORMATS AS A SECRETARY
 * SETS THEM — and each read back from the database and from the screen after
 * a reload.
 *
 * Five actions no browser test had performed (the reach report, round
 * G226-1). Each test builds the club it needs and drops it afterwards:
 *
 *   carry-forward   group points into the next round: part of them, all of
 *                   them, none; "a player on 12 pts here starts Round 2 on 9"
 *                   is the 75% the box holds, worked
 *   points          what a win, a halve and a hole won are worth, with a limit
 *                   a match: the worked example on the screen is the
 *                   tournament's own arithmetic, cap included
 *   tie-breakers    the order the table tries them in is the order stored and
 *                   the order shown after a reload; none is "share the place",
 *                   never all eight (the fault `saveTiebreakers` once had)
 *   qualifying      the top three of each of two flights is six into a draw of
 *                   eight, two byes, starting at the quarter-finals
 *   the final       a Single Match Stage between two named players; the same
 *                   player twice is refused, in the picker, and nothing stored
 *
 * WHAT IT CANNOT SEE: a table ranked on these points and tie-breakers (the
 * standings engine is held by `matrix.test.ts`), a draw made from the
 * qualifiers (`organizer-knockout.spec.ts`), and the final's match being made
 * and played (`createSingleMatch`).
 */

const WALKED = ["desktop", "phone"];
const markFor = (what: string, project: string) => `zz-mpr-${what}-${project}`;

test.describe.configure({ timeout: 150_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  await dropClub("zz-mpr-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

const GROUP_ROUNDS = [{ type: "Round Robin", format: "Match Play" }, { type: "Round Robin", format: "Match Play" }];

test("group points carry into the next round in part, in full, or not at all", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("carry", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages } = await makeEvent(club, "Winter Groups", { stages: GROUP_ROUNDS, players: 8, flights: 2 });
    await signIn(context, baseURL!, club, event.id);
    // The carry is a setting of the round it carries INTO.
    const next = async () => {
      const s = await prisma.stage.findUniqueOrThrow({ where: { id: stages[1].id } });
      return { on: s.carryForwardEnabled, pct: s.carryForwardPct, asked: s.carryForwardAsked };
    };
    expect(await next()).toEqual({ on: false, pct: 0, asked: false });

    await gotoStages(page);
    let card = await openRound(page, stages[0].id);
    let into = card.getByRole("radiogroup", { name: "Points into Round 2" });
    await expect(into, "a group round chained to another is not asked about carrying points").toBeVisible();
    // Asked, and nothing is chosen until somebody chooses.
    await expect(card.getByText(/carry into the next round\?/)).toBeVisible();
    for (const name of ["Start fresh", "Carry all", "Carry part"]) {
      await expect(into.getByRole("radio", { name, exact: true }), `${name} is chosen before anybody chose`).not.toBeChecked();
    }

    await pick(into, "Carry part");
    await expect.poll(next, { message: "Carry part was not stored as half of the points" }).toEqual({ on: true, pct: 50, asked: true });
    const share = card.getByLabel("Share of points carried into Round 2");
    await share.fill("75");
    await expect.poll(next, { message: "the share was not stored" }).toEqual({ on: true, pct: 75, asked: true });
    await expect(card.getByText("A player on 12 pts here starts Round 2 on 9.")).toBeVisible();

    await gotoStages(page);
    card = await openRound(page, stages[0].id);
    into = card.getByRole("radiogroup", { name: "Points into Round 2" });
    await expect(into.getByRole("radio", { name: "Carry part", exact: true }), "Carry part did not survive a reload").toBeChecked();
    await expect(card.locator(".tag", { hasText: /^75%$/ })).toBeVisible();
    await expect(card.getByText("A player on 12 pts here starts Round 2 on 9.")).toBeVisible();
    await expect(card.getByText(/carry into the next round\?/), "asked again after it was answered").toHaveCount(0);

    await pick(into, "Carry all");
    await expect.poll(next).toEqual({ on: true, pct: 100, asked: true });
    await expect(card.getByText("A player on 12 pts here starts Round 2 on 12.")).toBeVisible();

    // Starting fresh is an answer too: the question is not put again.
    await pick(into, "Start fresh");
    await expect.poll(next, { message: "Start fresh did not switch the carry off" }).toMatchObject({ on: false, asked: true });
    await gotoStages(page);
    card = await openRound(page, stages[0].id);
    into = card.getByRole("radiogroup", { name: "Points into Round 2" });
    await expect(into.getByRole("radio", { name: "Start fresh", exact: true })).toBeChecked();
    await expect(card.getByText(/starts Round 2 on/), "a fresh start still says what carries").toHaveCount(0);
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the points for a match are kept, and the worked example is the tournament's own arithmetic", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("points", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages } = await makeEvent(club, "Summer Groups", {
      stages: GROUP_ROUNDS,
      event: { winPts: 1, tiePts: 0.5, lossPts: 0, holeRatioPts: 0, bonusPts: 0, maxPerMatch: 0 },
    });
    await signIn(context, baseURL!, club, event.id);
    const stored = async () => {
      const e = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      return { win: e.winPts, halve: e.tiePts, loss: e.lossPts, perHole: e.holeRatioPts, bonus: e.bonusPts, cap: e.maxPerMatch };
    };

    await gotoStages(page);
    let card = await openRound(page, stages[0].id);
    await openCustomize(card);
    const rule = card.locator("span", { has: page.locator("b", { hasText: /^Points for a match$/ }) }).first();
    await expect(rule).toContainText("Win 1 · Halve 0.5 · Loss 0");
    await card.getByRole("button", { name: "Change: Points for a match", exact: true }).click();
    await card.getByLabel("Win — Points for winning a match").fill("2.5");
    await expect.poll(stored, { message: "the points for a win were not stored" }).toMatchObject({ win: 2.5 });
    await card.getByLabel("Halve — Points for a halved match").fill("1");
    await card.getByLabel("Hole-win ratio — Points per net hole won").fill("0.5");
    await card.getByLabel("Most from one match — 0 for no limit").fill("3");
    await expect.poll(stored, { message: "the points were not all stored" }).toEqual({ win: 2.5, halve: 1, loss: 0, perHole: 0.5, bonus: 0, cap: 3 });
    // Two wins, a halve and twelve holes won: four holes a match, so a win is 2.5 + 2 = 4.5 and a
    // halve 1 + 2 = 3, and the limit of 3 a match takes the win down to 3 — nine points, not twelve.
    await expect(card.getByText(/score 2×3 \+ 1×3 = 9 pts\./)).toBeVisible();
    await expect(card.getByText(/The 3-point limit is doing something here/)).toBeVisible();

    await gotoStages(page);
    card = await openRound(page, stages[0].id);
    await openCustomize(card);
    await expect(card.locator("span", { has: page.locator("b", { hasText: /^Points for a match$/ }) }).first(), "the points did not survive a reload").toContainText(
      "Win 2.5 · Halve 1 · Loss 0 · 0.5 per hole won · at most 3 a match",
    );
    await card.getByRole("button", { name: "Change: Points for a match", exact: true }).click();
    await expect(card.getByLabel("Win — Points for winning a match")).toHaveValue("2.5");
    await expect(card.getByLabel("Most from one match — 0 for no limit")).toHaveValue("3");
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the table's tie-breakers are tried in the order shown, the order stored, and none means a shared place", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("ties", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages } = await makeEvent(club, "Autumn Groups", {
      stages: GROUP_ROUNDS,
      event: { tiebreakers: JSON.stringify(["head-to-head", "most-wins", "toughest-6"]) },
    });
    await signIn(context, baseURL!, club, event.id);
    const stored = async () => JSON.parse((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).tiebreakers) as string[];
    const LABEL: Record<string, string> = {
      "head-to-head": "Head-to-head result",
      "most-wins": "Most match wins",
      "toughest-6": "Toughest 6 holes (by stroke index)",
      "toughest-3": "Toughest 3 holes (by stroke index)",
    };
    const open = async () => {
      const card = await openRound(page, stages[0].id);
      await openCustomize(card);
      await card.getByRole("button", { name: "Change: Level in the table", exact: true }).click();
      return card;
    };
    /** The chain as the screen lists it, top to bottom, read off each step's own Remove. */
    const shown = async (card: ReturnType<typeof page.locator>) =>
      (await card.getByRole("button", { name: /^Remove / }).evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label") ?? ""))).map((l) =>
        l.replace(/^Remove /, ""),
      );

    await gotoStages(page);
    let card = await open();
    expect(await shown(card)).toEqual(["head-to-head", "most-wins", "toughest-6"].map((k) => LABEL[k]));

    await card.getByRole("button", { name: "Move Most match wins earlier", exact: true }).click();
    await expect.poll(stored, { message: "moving a step earlier was not stored" }).toEqual(["most-wins", "head-to-head", "toughest-6"]);
    await card.getByRole("button", { name: "Remove Toughest 6 holes (by stroke index)", exact: true }).click();
    await expect.poll(stored, { message: "removing a step was not stored" }).toEqual(["most-wins", "head-to-head"]);
    await card.getByLabel("Add a step").selectOption("toughest-3");
    await expect.poll(stored, { message: "adding a step was not stored" }).toEqual(["most-wins", "head-to-head", "toughest-3"]);

    await gotoStages(page);
    card = await open();
    expect(await shown(card), "the order on the screen after a reload is not the order stored").toEqual(["most-wins", "head-to-head", "toughest-3"].map((k) => LABEL[k]));
    await expect(card.locator("span", { has: page.locator("b", { hasText: /^Level in the table$/ }) }).first()).toContainText("most wins, then head-to-head, +1 more");

    // None at all: players level on points share the place — never every tie-breaker there is.
    for (const k of ["most-wins", "head-to-head", "toughest-3"]) {
      const before = (await stored()).length;
      await card.getByRole("button", { name: `Remove ${LABEL[k]}`, exact: true }).click();
      await expect.poll(async () => (await stored()).length).toBe(before - 1);
    }
    expect(await stored(), "unticking the last tie-breaker stored something other than none").toEqual([]);
    await expect(card.getByText("None — players level on points share the place.")).toBeVisible();
    await gotoStages(page);
    card = await openRound(page, stages[0].id);
    await openCustomize(card);
    await expect(card.locator("span", { has: page.locator("b", { hasText: /^Level in the table$/ }) }).first()).toContainText("players level share the place");
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the top three of each of two flights is six qualifiers, a draw of eight with two byes", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("qual", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages } = await makeEvent(club, "Club Knockout", {
      stages: [{ type: "Round Robin", format: "Match Play" }, { type: "Bracket Stage", format: "Match Play" }],
      players: 8,
      flights: 2,
      event: { qualifyMode: "perFlight", qualifyPerGroup: 1 },
    });
    await signIn(context, baseURL!, club, event.id);
    const stored = async () => (await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).qualifyPerGroup;

    await gotoStages(page);
    let card = await openRound(page, stages[1].id);
    await expect(card.getByRole("radiogroup", { name: "Who qualifies for the knockout" }).getByRole("radio", { name: "Per flight", exact: true })).toBeChecked();
    const each = card.getByRole("radiogroup", { name: "Players from each flight" });
    // One from each of two flights is a final.
    await expect(card.getByText("2 go through — the draw starts with a final.")).toBeVisible();

    await pick(each, "Top 2");
    await expect.poll(stored, { message: "Top 2 was not stored" }).toBe(2);
    await expect(card.getByText("4 go through — the draw starts with the semi-finals.")).toBeVisible();
    await pick(each, "Top 3");
    await expect.poll(stored, { message: "Top 3 was not stored" }).toBe(3);
    // Six into a draw of eight: two byes, from the quarter-finals.
    await expect(card.getByText("6 go through — the draw starts with the quarter-finals, 2 byes.")).toBeVisible();

    await gotoStages(page);
    card = await openRound(page, stages[1].id);
    await expect(card.getByRole("radiogroup", { name: "Players from each flight" }).getByRole("radio", { name: "Top 3", exact: true }), "Top 3 did not survive a reload").toBeChecked();
    await expect(card.getByText("6 go through — the draw starts with the quarter-finals, 2 byes.")).toBeVisible();
    // And the round before says what goes into the knockout.
    const first = page.locator(`[id="round-${stages[0].id}"]`);
    await first.locator("button[aria-expanded]").first().click();
    await first.locator("button[aria-expanded]").first().click();
    await expect(first.getByText(/Into Round 2: top 3 per flight/)).toBeVisible();
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a final between two named players is kept, and the same player twice is refused in the picker", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("final", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages, players } = await makeEvent(club, "Champion of Champions", {
      stages: [{}, { type: "Single Match Stage", format: "Match Play" }],
    });
    await signIn(context, baseURL!, club, event.id);
    const rule = async () => {
      const raw = (await prisma.stage.findUniqueOrThrow({ where: { id: stages[1].id } })).singleMatchRule;
      return raw ? (JSON.parse(raw) as { kind: string; a: string | number; b: string | number }) : null;
    };
    const nameOf = (id: string | number) => players.find((p) => p.id === id)?.name ?? `(not in the field: ${id})`;
    // By its NAME: the boxes had labels tied to nothing, so a screen reader announced an unnamed
    // list (2026-10-21). getByLabel finds a box only through a label that names it.
    const select = (card: ReturnType<typeof page.locator>, label: string) => card.getByLabel(label, { exact: true });
    expect(await rule()).toBe(null);

    await gotoStages(page);
    let card = await openRound(page, stages[1].id);
    const picker = card.locator(".card", { has: page.getByText("Who plays this match", { exact: true }) });
    await expect(picker.getByText("No pairing set")).toBeVisible();
    await picker.getByRole("button", { name: "Two players I pick", exact: true }).click();
    await expect.poll(async () => (await rule())?.kind, { message: "Two players I pick stored no rule" }).toBe("named");
    const first = await rule();
    expect(first!.a, "the rule names the same player twice").not.toBe(first!.b);

    // Against: the third player in the field.
    await select(picker, "Against").selectOption({ label: NAMES[2] });
    await expect.poll(async () => (await rule())?.b, { message: "the second player chosen was not stored" }).toBe(players[2].id);
    const a = nameOf((await rule())!.a);
    await expect(picker.getByText(`${a} v ${NAMES[2]}`, { exact: true }), "the picker does not say who plays").toBeVisible();

    await gotoStages(page);
    card = await openRound(page, stages[1].id);
    const again = card.locator(".card", { has: page.getByText("Who plays this match", { exact: true }) });
    await expect(again.getByRole("button", { name: "Two players I pick", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(again.getByText(`${a} against ${NAMES[2]}`, { exact: true }), "the rule did not survive a reload").toBeVisible();
    await expect(again.getByText(`${a} v ${NAMES[2]}`, { exact: true })).toBeVisible();
    await expect(select(again, "Against").locator("option:checked")).toHaveText(NAMES[2]);

    // ── the same player on both sides: refused, in words, beside the box ──
    const against = select(again, "Against");
    // A person scrolls to the box before choosing in it; `selectOption` does not.
    await centre(against);
    await against.selectOption({ label: a });
    const refused = again.locator(".form-error", { hasText: "That pairing doesn't make sense — pick two different players or rounds." });
    await expect(refused, "a match of one player against themself was not refused in words").toBeVisible();
    await saidBeside(refused, against, "the same player on both sides of the final");
    expect((await rule())!.b, "the refused pairing was stored").toBe(players[2].id);
    await gotoStages(page);
    card = await openRound(page, stages[1].id);
    await expect(card.getByText(`${a} against ${NAMES[2]}`, { exact: true }), "a refused pairing changed the final").toBeVisible();
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
