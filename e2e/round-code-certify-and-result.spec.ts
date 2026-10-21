import { test, expect, type Page, type Browser } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * A ROUND-CODE PLAYER SIGNS THEIR CARD, AND PHONES IN A MATCH RESULT (2026-10-21).
 *
 * `certifyPlayCard` and `savePlayMatchResult` were performed by no browser test
 * (the reach report). Both are the round-code surface, `/play`: somebody with a
 * code and no account, on the course.
 *
 *   a medal card, nine holes, all in      → "Certify my card" appears; pressed, the
 *                                           card is stored CERTIFIED, signed by the
 *                                           player's own name (Rule 3.3b), and the
 *                                           screen says so — and, opened again, still
 *                                           does (KNOWN FAULT: it does not; see below)
 *   a card the committee has already
 *   accepted                              → Certify is refused, in words, beside the
 *                                           button; the card stays approved, unsigned
 *   a match, the holder is the SECOND
 *   player, "Wren won" typed as "2&3"     → refused before it is sent (it is "3&2"
 *                                           transposed); Save is not offered
 *   "3&2"                                 → stored as the holes it means: sixteen
 *                                           played, the holder's side (B) three up,
 *                                           pending; after a reload the card reads
 *                                           "Match over: Wren 3&2"
 *   the committee takes the scoring back
 *   while the screen is open, a result is
 *   saved                                 → refused, said beside Save result, and
 *                                           nothing stored changes
 *
 * Its own club, tournament, two rounds and two invented players, deleted
 * afterwards. WHAT IT CANNOT SEE: a net match (gross here), a match kept on
 * stroke cards (`match-kept-by.spec`), and `certifyPlayCard`'s own refusals —
 * the screen saves the card first, and the save asks every question the
 * signature does, so the signature can only be refused by a race between the
 * two calls.
 */

const prisma = new PrismaClient();
const MARK = "zz-code-certify";
const ALPHABET = "ABCDEFGHJKMNPQRTWXYZ2346789";
const code = () => "ZZ" + Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const MEDAL = code();
const MATCH = code();
const ids = { org: "", event: "", medal: "", matchStage: "", match: "", wren: "", thea: "" };
const WREN = "Wren Calloway";
const THEA = "Thea Brightwater";

test.beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${MARK} society`, kind: "society" } });
  ids.org = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Autumn Meeting`,
      status: "live",
      shape: "single",
      format: "stroke",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${MARK}-${MEDAL}`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(380)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      playerAccess: "code",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      // A signed card then waits for the committee.
      scoreApproval: "staff",
    },
  });
  ids.event = event.id;
  ids.medal = (
    await prisma.stage.create({
      data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", scoringBasis: "gross", holes: 9, nine: "front", accessCode: MEDAL },
    })
  ).id;
  ids.matchStage = (
    await prisma.stage.create({
      data: { eventId: event.id, position: 1, type: "Round Robin", format: "Match Play", scoringBasis: "gross", holes: 18, accessCode: MATCH },
    })
  ).id;
  const flight = await prisma.group.create({ data: { eventId: event.id, name: `${MARK} flight`, position: 0 } });
  const [thea, wren] = await Promise.all(
    [THEA, WREN].map((name, i) =>
      prisma.player.create({
        data: { eventId: event.id, groupId: flight.id, name, email: `${MARK}-${i}@example.invalid`, status: "confirmed", seed: i + 1, handicap: 0 },
      }),
    ),
  );
  ids.thea = thea.id;
  ids.wren = wren.id;
  // Thea is A and Wren is B, so the holder of the phone is the SECOND player and every
  // answer the screen gives "from her side" has to be turned round before it is stored.
  ids.match = (
    await prisma.match.create({
      data: { eventId: event.id, stageId: ids.matchStage, groupId: flight.id, round: 1, playerAId: thea.id, playerBId: wren.id, holes: JSON.stringify(new Array(18).fill(null)) },
    })
  ).id;
});

test.afterAll(async () => {
  try {
    if (ids.event) await prisma.event.deleteMany({ where: { id: ids.event } });
    if (ids.org) await prisma.organization.deleteMany({ where: { id: ids.org } });
  } finally {
    await prisma.$disconnect();
  }
});

const card = (playerId: string) =>
  prisma.scorecard.findFirst({ where: { stageId: ids.medal, playerId }, select: { strokes: true, status: true, certifiedBy: true, certifiedAt: true } });

const matchRow = async () => {
  const m = await prisma.match.findUniqueOrThrow({ where: { id: ids.match }, select: { holes: true, scoreStatus: true, scoredAt: true } });
  const holes = JSON.parse(m.holes) as (string | null)[];
  return {
    status: m.scoreStatus,
    played: holes.filter((h) => h !== null).length,
    // The holder (Wren) is side B.
    bUp: holes.filter((h) => h === "B").length - holes.filter((h) => h === "A").length,
    scored: m.scoredAt !== null,
  };
};

async function signedOut(browser: Browser, baseURL: string | undefined) {
  return browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
}

/** The round code typed and the player's own name tapped, as on the first tee. */
async function enter(page: Page, roundCode: string, name: string) {
  await page.goto("/play");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByLabel("Round code").fill(roundCode);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name, { timeout: 30_000 });
}

/** Nine pars, entered on the card's own pad; it moves on by itself. */
async function ninePars(page: Page) {
  for (let hole = 1; hole <= 9; hole += 1) {
    await expect(page.getByLabel(`Strokes on hole ${hole}`)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /Par$/ }).first().click();
  }
  await expect(page.getByText("9/9 holes")).toBeVisible();
}

test("a round-code player signs their own card, and it is stored and shown as certified", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  await prisma.scorecard.deleteMany({ where: { stageId: ids.medal, playerId: ids.wren } });
  const ctx = await signedOut(browser, baseURL);
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    watchPageErrors(page, errors, "Wren, by the code");
    await enter(page, MEDAL, WREN);
    const sign = page.getByRole("button", { name: "Certify my card" });
    // Never on an unfinished card: certifying one would vouch for holes nobody played.
    await expect(sign, "Certify is offered before the card is finished").toHaveCount(0);
    await ninePars(page);

    await expect(sign, "a finished card cannot be signed").toBeEnabled({ timeout: 10_000 });
    await expect(page.getByText("Certifying says these hole scores are correct. The committee accepts it after that.")).toBeVisible();
    await sign.click();
    await expect(page.getByRole("button", { name: "Certified" }), "the screen does not say the card is signed").toBeVisible({ timeout: 20_000 });

    await expect.poll(async () => (await card(ids.wren))?.status, { timeout: 15_000, message: "the card was not stored as certified" }).toBe("certified");
    const kept = await card(ids.wren);
    expect(kept?.certifiedBy, "the signature is not the player's own name").toBe(WREN);
    expect(kept?.certifiedAt, "a certified card has no time it was signed").not.toBeNull();
    expect(JSON.parse(kept!.strokes), "the signed card is not the card entered").toEqual(new Array(9).fill(4));
    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await ctx.close();
  }
});

/**
 * FOUND BY THIS SPEC ON 2026-10-21, AND FIXED: `/play` never told `PlayClient` the card's status,
 * and `certified` started false — so a card the player had signed read "Certify my card" again the
 * moment the page was opened again, with the sentence saying the committee had yet to accept it.
 * The page now hands the card's status down (`signed`).
 */
test("a signed card still reads as signed when the player opens it again", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  await prisma.scorecard.deleteMany({ where: { stageId: ids.medal, playerId: ids.wren } });
  await prisma.scorecard.create({
    data: { eventId: ids.event, stageId: ids.medal, playerId: ids.wren, strokes: JSON.stringify(new Array(9).fill(4)), status: "certified", certifiedBy: WREN, certifiedAt: new Date() },
  });
  const ctx = await signedOut(browser, baseURL);
  try {
    const page = await ctx.newPage();
    await enter(page, MEDAL, WREN);
    await expect(page.getByText("9/9 holes")).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole("button", { name: "Certified" }),
      "a card the player has signed offers to be signed again",
    ).toBeVisible({ timeout: 10_000 });
  } finally {
    await ctx.close();
  }
});

test("a card the committee has already accepted cannot be signed, and the screen says so beside the button", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  await prisma.scorecard.deleteMany({ where: { stageId: ids.medal, playerId: ids.thea } });
  const ctx = await signedOut(browser, baseURL);
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    watchPageErrors(page, errors, "Thea, by the code");
    await enter(page, MEDAL, THEA);
    await ninePars(page);
    await expect.poll(async () => JSON.parse((await card(ids.thea))?.strokes ?? "[]").filter((s: unknown) => s != null).length, {
      timeout: 15_000,
      message: "the nine holes were never saved",
    }).toBe(9);

    // At the desk meanwhile, the committee accepts the card as it stands.
    await prisma.scorecard.updateMany({ where: { stageId: ids.medal, playerId: ids.thea }, data: { status: "approved", approvedBy: "The committee", approvedAt: new Date() } });

    await page.getByRole("button", { name: "Certify my card" }).click();
    const refused = page.getByText("That card has been approved. An organizer has to reopen it before it can be changed.");
    await expect(refused, "the refusal was not said").toBeVisible({ timeout: 20_000 });
    await expect(refused, "the refusal is not on screen where Certify was pressed").toBeInViewport();
    await expect(page.getByRole("button", { name: "Certified" }), "a refused signature reads as signed").toHaveCount(0);
    const kept = await card(ids.thea);
    expect(kept?.status, "an approved card changed status").toBe("approved");
    expect(kept?.certifiedBy, "a refused signature was recorded").toBe("");
    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test("a match result phoned in by code is stored as the holes it means, and read back in golf's words", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  await prisma.match.update({ where: { id: ids.match }, data: { holes: JSON.stringify(new Array(18).fill(null)), scoreStatus: "pending", scoredAt: null } });
  const ctx = await signedOut(browser, baseURL);
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    watchPageErrors(page, errors, "Wren, by the code");
    await enter(page, MATCH, WREN);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Wren Calloway\s*vs\s*Thea Brightwater/);

    await page.getByText("Final result", { exact: true }).click();
    await page.getByLabel("Wren won", { exact: true }).check();
    const margin = page.getByPlaceholder(/3&2/);
    const save = page.getByRole("button", { name: "Save result" });

    // Two up with three to play is not a finished match: "3&2", transposed.
    await margin.fill("2&3");
    const transposed = page.getByText(/"2&3" isn't a possible result .* Did you mean "3&2"\?/);
    await expect(transposed, "an impossible margin is not answered").toBeVisible();
    await expect(transposed).toBeInViewport();
    await expect(save, "an impossible margin can be saved").toBeDisabled();
    expect((await matchRow()).played, "a refused margin stored holes").toBe(0);

    await margin.fill("3&2");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByRole("button", { name: "Result saved" }), "the screen does not say the result was saved").toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await matchRow()).played, { timeout: 15_000, message: "the result was not stored" }).toBe(16);
    // Rule 3.2a(3): won 3 and 2 is three up with two to play — sixteen holes, the holder's side three up.
    expect(await matchRow(), "3&2 to the holder (side B) is not stored as the holes it means").toEqual({ status: "pending", played: 16, bUp: 3, scored: true });

    await page.goto(`/play?bust=${Date.now()}`);
    await expect(page.getByText(/Match over: Wren 3&2\. Nothing more to enter\./), "after a reload the card does not read the result back").toBeVisible({ timeout: 20_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test("a result saved after the committee took the scoring back is refused beside Save result, and nothing changes", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  // The match as the test above left it: Wren 3&2, sixteen holes.
  const holes = [...new Array(5).fill("B"), ...new Array(2).fill("A"), ...new Array(9).fill("H"), null, null];
  await prisma.match.update({ where: { id: ids.match }, data: { holes: JSON.stringify(holes), scoreStatus: "pending" } });
  const before = await matchRow();
  const ctx = await signedOut(browser, baseURL);
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    watchPageErrors(page, errors, "Wren, by the code");
    await enter(page, MATCH, WREN);

    // On the console meanwhile: "Who enters scores" is now the organizer.
    await prisma.event.update({ where: { id: ids.event }, data: { scoreEntryBy: "staff" } });

    await page.getByText("Final result", { exact: true }).click();
    await page.getByText("Halved", { exact: true }).click();
    // A result replaces the holes already on the card, so the card asks first.
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Save result" }).click();
    const refused = page.getByText("Scores for this tournament are entered by the organizer.");
    await expect(refused, "the refusal was not said").toBeVisible({ timeout: 20_000 });
    await expect(refused, "the refusal is not on screen where Save result was pressed").toBeInViewport();
    await expect(page.getByRole("button", { name: "Result saved" }), "a refused result reads as saved").toHaveCount(0);
    expect(await matchRow(), "a refused result changed the match").toEqual(before);
    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await prisma.event.update({ where: { id: ids.event }, data: { scoreEntryBy: "players" } });
    await ctx.close();
  }
});
