import { test, expect, type Page, type Browser } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * A ROUND CODE ON A TOURNAMENT WHOSE CARDS THE CLUB KEEPS (2026-10-24).
 *
 * "Who enters scores: Organizers and assistants only" refuses every save the
 * round-code surface makes (`canEnterScores(settings, "player")` in each writer
 * of actions/play.ts). `/play` drew the card's buttons regardless, and a player
 * learned only after tapping a hole that the card "wouldn't save". Now the page
 * asks the server's own question before it draws anything to press:
 *
 *   a medal round, the club keeps the cards   → no stroke boxes, no Par button,
 *                                               the sentence saying the club is
 *                                               keeping them, and the way to the
 *                                               public board
 *   a match round, the club keeps the cards   → no hole buttons, no Final result
 *   CONTROL: a medal round the players keep   → the stroke boxes and the Par
 *                                               button ARE drawn, and the club-kept
 *                                               sentence is not — so the first
 *                                               case cannot pass on a page that
 *                                               simply failed to draw a card
 *
 * Its own society, two tournaments, three rounds and three invented players,
 * marked `zz-staffkept` and deleted in a `finally`. Signed out throughout: a
 * round code is the only credential. WHAT IT CANNOT SEE: `/me/card`, which
 * has refused the same way since before this (`canEnterScores` on its own
 * line); and a board that is not public, whose sentence differs only in
 * naming who to ask for the link.
 */

const prisma = new PrismaClient();
const MARK = "zz-staffkept";
const ALPHABET = "ABCDEFGHJKMNPQRTWXYZ2346789";
const code = () => "ZZ" + Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const KEPT_MEDAL = code();
const KEPT_MATCH = code();
const OWN_MEDAL = code();
const ids = { org: "", kept: "", own: "" };
const ORLA = "Orla Fenwhistle";
const PIP = "Pip Larchmont";
const QUILL = "Quill Ashbury";
const SHARE = `${MARK}-board-${KEPT_MEDAL}`;

const SENTENCE = /Scores for this tournament are entered by the organi[sz]er, so there is nothing to enter on this phone\./;

async function sweepLeftovers() {
  const orgs = await prisma.organization.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } });
  if (orgs.length === 0) return;
  await prisma.event.deleteMany({ where: { organizationId: { in: orgs.map((o) => o.id) } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs.map((o) => o.id) } } });
}

function eventData(name: string, scoreEntryBy: "staff" | "players", shareToken: string) {
  return {
    organizationId: ids.org,
    name,
    status: "live",
    shape: "single",
    format: "stroke",
    dates: "",
    course: "Home",
    city: "",
    address: "",
    regDeadline: "",
    shareToken,
    customPars: JSON.stringify(new Array(18).fill(4)),
    customYards: JSON.stringify(new Array(18).fill(380)),
    customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    playerAccess: "code",
    scoreEntryBy,
    scoreEntryWindow: "during",
    scoreApproval: "staff",
    leaderboardVisibility: "public",
  };
}

test.beforeAll(async () => {
  await sweepLeftovers();
  const org = await prisma.organization.create({ data: { name: `${MARK} society`, kind: "society" } });
  ids.org = org.id;

  const kept = await prisma.event.create({ data: eventData(`${MARK} Committee Medal`, "staff", SHARE) });
  ids.kept = kept.id;
  await prisma.stage.create({
    data: { eventId: kept.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", scoringBasis: "gross", holes: 9, nine: "front", accessCode: KEPT_MEDAL },
  });
  const matchStage = await prisma.stage.create({
    data: { eventId: kept.id, position: 1, type: "Round Robin", format: "Match Play", scoringBasis: "gross", holes: 18, accessCode: KEPT_MATCH },
  });
  const flight = await prisma.group.create({ data: { eventId: kept.id, name: `${MARK} flight`, position: 0 } });
  const [orla, pip] = await Promise.all(
    [ORLA, PIP].map((name, i) =>
      prisma.player.create({
        data: { eventId: kept.id, groupId: flight.id, name, email: `${MARK}-${i}@example.invalid`, status: "confirmed", seed: i + 1, handicap: 0 },
      }),
    ),
  );
  await prisma.match.create({
    data: { eventId: kept.id, stageId: matchStage.id, groupId: flight.id, round: 1, playerAId: orla.id, playerBId: pip.id, holes: JSON.stringify(new Array(18).fill(null)) },
  });

  const own = await prisma.event.create({ data: eventData(`${MARK} Players' Medal`, "players", `${MARK}-own-${OWN_MEDAL}`) });
  ids.own = own.id;
  await prisma.stage.create({
    data: { eventId: own.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", scoringBasis: "gross", holes: 9, nine: "front", accessCode: OWN_MEDAL },
  });
  await prisma.player.create({
    data: { eventId: own.id, name: QUILL, email: `${MARK}-2@example.invalid`, status: "confirmed", seed: 1, handicap: 0 },
  });
});

test.afterAll(async () => {
  try {
    if (ids.kept || ids.own) await prisma.event.deleteMany({ where: { id: { in: [ids.kept, ids.own].filter(Boolean) } } });
    if (ids.org) await prisma.organization.deleteMany({ where: { id: ids.org } });
  } finally {
    try {
      await sweepLeftovers();
    } finally {
      await prisma.$disconnect();
    }
  }
});

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

test("a medal the club keeps offers no score buttons, says so, and points to the board", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const ctx = await signedOut(browser, baseURL);
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    watchPageErrors(page, errors, "Orla, by the code, club-kept medal");
    await enter(page, KEPT_MEDAL, ORLA);

    await expect(page.getByText("Your club is keeping the cards"), "the screen does not say who keeps the cards").toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(SENTENCE)).toBeVisible();
    await expect(page.getByText("Follow the round on the board: the scores appear there as they go in.")).toBeVisible();
    const board = page.getByRole("link", { name: "See the board" });
    await expect(board, "no way to the board where the buttons would be").toBeVisible();
    await expect(board).toHaveAttribute("href", `/live/${SHARE}`);

    // Nothing to press that the server would refuse.
    await expect(page.getByLabel(/Strokes on hole/), "a stroke box is offered").toHaveCount(0);
    await expect(page.getByRole("button", { name: /Par$/ }), "a Par button is offered").toHaveCount(0);
    await expect(page.getByRole("button", { name: "Certify my card" })).toHaveCount(0);
    await expect(page.getByText(/wouldn.t save/)).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test("a match the club keeps offers no hole buttons and no result to phone in", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const ctx = await signedOut(browser, baseURL);
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    watchPageErrors(page, errors, "Pip, by the code, club-kept match");
    await enter(page, KEPT_MATCH, PIP);

    await expect(page.getByText("Your club is keeping the cards")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(SENTENCE)).toBeVisible();
    await expect(page.getByText("Final result", { exact: true }), "a result is offered").toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save result" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 }), "the match card was drawn").not.toContainText(/vs/);
    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test("CONTROL: a medal the players keep draws the card's buttons, and no club-kept sentence", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const ctx = await signedOut(browser, baseURL);
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    watchPageErrors(page, errors, "Quill, by the code, player-kept medal");
    await enter(page, OWN_MEDAL, QUILL);

    await expect(page.getByLabel("Strokes on hole 1"), "the player's own card has no stroke box").toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /Par$/ }).first(), "the player's own card has no Par button").toBeVisible();
    await expect(page.getByText("Your club is keeping the cards")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await ctx.close();
  }
});
