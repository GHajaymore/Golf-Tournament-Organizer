import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * A FOUR-BALL PARTNER SCORES THEIR SIDE'S MATCH WITH A ROUND CODE.
 *
 * A cup's four-ball match is stored between two SIDES, with both player columns
 * empty. The round-code page looked a player's match up by the player columns
 * alone, so every four-ball player who typed the code was told they had no
 * match — while the save behind it (`savePlayMatchHoles`) had always let a
 * member of either side keep the card. Found 2026-10-16, setting up a real
 * Ryder-style cup whose players have codes and no accounts.
 *
 *   the holder is on the SECOND side       → the answers name the two PAIRS
 *                                            (never "Us" v "Them"), and hole 1
 *                                            to the holder's pair is stored as
 *                                            hole 1 to side B
 *   the holder picked an OPPONENT's name   → a hole given to a pair by name is
 *                                            stored for that pair all the same
 *   a tee-sheet foursome                   → listed as its two pairs, each
 *                                            under its team
 *   a player in the round with no match    → told so, and shown no card (the control:
 *                                            the lookup did not just hand everybody
 *                                            the first match)
 *
 * Its own club, tournament, session, five invented players and one match,
 * deleted afterwards. WHAT IT CANNOT SEE: shots on a net side's card (a side's
 * card shows none, on purpose — four players' shots do not fit two rows of
 * dots), and two partners keeping one card on two phones at once.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const MARK = "zz-four-ball-code";
const ALPHABET = "ABCDEFGHJKMNPQRTWXYZ2346789";
const CODE = "ZZ" + Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const ids = { org: "", event: "", match: "" };

test.beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${MARK} society`, kind: "society" } });
  ids.org = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Autumn Cup`,
      status: "live",
      shape: "single",
      format: "match",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${MARK}-${CODE}`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(380)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      playerAccess: "code",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
    },
  });
  ids.event = event.id;
  const stage = await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 0,
      type: "Team Session",
      format: "Four-Ball",
      description: "Front nine four-balls",
      scoringBasis: "gross",
      holes: 9,
      nine: "front",
      accessCode: CODE,
      lineupPublished: true,
    },
  });
  const [blues, whites] = await Promise.all(
    ["Blues", "Whites"].map((name, position) => prisma.group.create({ data: { eventId: event.id, name, position } })),
  );
  const carrier = await prisma.group.create({
    data: { eventId: event.id, name: "Four-Ball — cup session", position: 2, stageId: stage.id, isCarrier: true },
  });
  const person = (name: string, groupId: string, i: number) =>
    prisma.player.create({
      data: { eventId: event.id, groupId, name, email: `${MARK}-${i}@example.invalid`, status: "confirmed", seed: i + 1, handicap: 0 },
    });
  const a1 = await person("Zz Ailsa", blues.id, 0);
  const a2 = await person("Zz Bram", blues.id, 1);
  const b1 = await person("Zz Edda", whites.id, 2);
  const b2 = await person("Zz Finn", whites.id, 3);
  await person("Zz Spare", whites.id, 4);
  const side = (name: string, flight: string, players: string[]) =>
    prisma.team.create({
      data: {
        eventId: event.id,
        stageId: stage.id,
        name,
        clubGroupId: flight,
        members: { create: players.map((playerId, position) => ({ playerId, position })) },
      },
    });
  const sa = await side("Zz Ailsa & Zz Bram", blues.id, [a1.id, a2.id]);
  const sb = await side("Zz Edda & Zz Finn", whites.id, [b1.id, b2.id]);
  ids.match = (
    await prisma.match.create({
      data: {
        eventId: event.id,
        stageId: stage.id,
        groupId: carrier.id,
        round: 1,
        playerAId: "",
        playerBId: "",
        teamAId: sa.id,
        teamBId: sb.id,
        holes: JSON.stringify(new Array(9).fill(null)),
      },
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

async function code(page: import("@playwright/test").Page) {
  await page.goto("/play");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByLabel("Round code").fill(CODE);
  await page.getByRole("button", { name: "Continue" }).click();
}

async function enter(page: import("@playwright/test").Page, name: string) {
  await code(page);
  await page.getByRole("button", { name }).click();
}

/**
 * THE NAMES COME IN GROUPS, not as the whole field (Ajay, 2026-10-16: "can you
 * keep it to the foursome?"). With no tee sheet, the round's matches: the
 * four-ball's four under one heading and the player with no match under
 * "Everyone else". With a published tee sheet, its foursomes by tee time.
 */
test("the names after the code come in the round's groups: the match, then the tee sheet's foursomes", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  const stage = await prisma.match.findUniqueOrThrow({ where: { id: ids.match }, select: { stageId: true } });
  try {
    await code(page);
    // The round is named with its holes, so the wrong nine's code shows at once.
    await expect(page.getByText("Round 1 · Four-Ball · holes 1–9")).toBeVisible({ timeout: 20_000 });
    const match = page.getByRole("region", { name: "Zz Ailsa & Zz Bram v Zz Edda & Zz Finn" });
    await expect(match, "the match is not a group of its own").toBeVisible({ timeout: 20_000 });
    for (const n of ["Zz Ailsa", "Zz Bram", "Zz Edda", "Zz Finn"]) await expect(match.getByRole("button", { name: n })).toBeVisible();
    await expect(match.getByRole("button", { name: "Zz Spare" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Everyone else" }).getByRole("button", { name: "Zz Spare" })).toBeVisible();

    // A published tee sheet decides the groups instead — its own foursomes.
    const ps = await prisma.player.findMany({ where: { eventId: ids.event }, select: { id: true, name: true } });
    const id = (n: string) => ps.find((p) => p.name === n)!.id;
    await prisma.stage.update({
      where: { id: stage.stageId },
      data: {
        teeSheetPublished: true,
        teeSheet: JSON.stringify({
          savedAt: new Date().toISOString(),
          startType: "tee",
          groups: [
            { name: "Group 1", startHole: 10, time: "12:45 PM", playerIds: [id("Zz Ailsa"), id("Zz Edda"), id("Zz Bram"), id("Zz Finn")] },
            { name: "Group 2", startHole: 10, time: "12:54 PM", playerIds: [id("Zz Spare")] },
          ],
        }),
      },
    });
    await code(page);
    const first = page.getByRole("region", { name: "12:45 PM · Group 1" });
    await expect(first, "the tee sheet's foursome is not a group").toBeVisible({ timeout: 20_000 });
    await expect(first.getByRole("button")).toHaveCount(4);
    // AS TWO PAIRS, each under its team (2026-10-18). The sheet lists the four
    // mixed — Ailsa, Edda, Bram, Finn, as a real cup's sheet did — and at the
    // first real cup a scorer, looking at four names in one block, tapped an
    // opponent's and kept the whole four-ball from the other pair's side.
    await expect(first.getByRole("heading", { name: "Blues", exact: true }), "the foursome is not split into its pairs").toBeVisible();
    await expect(first.getByRole("heading", { name: "Whites", exact: true })).toBeVisible();
    expect((await first.innerText()).replace(/\s+/g, " "), "a pair is not under its own team").toMatch(/blues zz ailsa zz bram whites zz edda zz finn/i);
    await expect(page.getByRole("region", { name: "12:54 PM · Group 2" }).getByRole("button", { name: "Zz Spare" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Zz Ailsa & Zz Bram v Zz Edda & Zz Finn" })).toHaveCount(0);
  } finally {
    await prisma.stage.update({ where: { id: stage.stageId }, data: { teeSheetPublished: false, teeSheet: "" } });
    await ctx.close();
  }
});

test("a four-ball partner with a round code keeps their side's match, from their side", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  watchPageErrors(page, errors);
  try {
    await enter(page, "Zz Finn");
    await expect(page.getByText(/is scored side by side on one card/)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Zz Edda & Zz Finn\s*vs\s*Zz Ailsa & Zz Bram/ })).toBeVisible({ timeout: 20_000 });

    const hole1 = page.getByRole("group", { name: "Who won hole 1" });
    await expect(hole1).toBeVisible({ timeout: 10_000 });
    // Each answer names a PAIR — never "Us" and "Them", which mean whoever's
    // name was tapped (2026-10-18). The four share a first name here, so the
    // pairs are widened to "Zz E. & Zz F." against "Zz A. & Zz B.".
    await expect(hole1.getByRole("button", { name: /^Hole 1 to Zz Edda & Zz Finn/ })).toHaveText(/^Zz E\. & Zz F\./);
    await expect(hole1.getByRole("button", { name: /^Hole 1 to Zz Ailsa & Zz Bram/ })).toHaveText(/^Zz A\. & Zz B\./);
    await expect(hole1.getByText(/^(Us|Them)$/)).toHaveCount(0);
    await hole1.getByRole("button", { name: /^Hole 1 to Zz Edda & Zz Finn/ }).click();

    await expect
      .poll(
        async () => {
          const m = await prisma.match.findUniqueOrThrow({ where: { id: ids.match }, select: { holes: true } });
          return (JSON.parse(m.holes) as (string | null)[])[0];
        },
        { timeout: 15_000, message: "the side's hole was never saved" },
      )
      // Stored A-relative, and the holder's side is the match's side B.
      .toBe("B");
    await expect(page.getByText("Zz E. & Zz F. 1 up with 8 to play")).toBeVisible();

    // Four more: five up with four to play over a nine, and the phone says the
    // match is OVER rather than offering the sixth as if it were still on.
    for (let n = 2; n <= 5; n += 1) {
      const g = page.getByRole("group", { name: `Who won hole ${n}` });
      await expect(g).toBeVisible({ timeout: 10_000 });
      await g.getByRole("button", { name: new RegExp(`^Hole ${n} to Zz Edda & Zz Finn`) }).click();
    }
    await expect(page.getByRole("status").filter({ hasText: "Match over: Zz E. & Zz F. 5&4. Nothing more to enter." })).toBeVisible({ timeout: 10_000 });

    // And the way to the next nine's code is right there, not a "Sign out"
    // at the foot of the page.
    await page.getByRole("button", { name: "Enter another round code" }).click();
    await expect(page.getByLabel("Round code")).toBeVisible({ timeout: 15_000 });
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

/**
 * A NET FOUR-BALL SAYS WHO GETS A SHOT ON EACH HOLE, off the lowest of the
 * four; and the hole strip marks a played hole W / ½ / L from the holder's side.
 *
 *   Ailsa 0, Bram 4, Edda 8, Finn 12: a nine halves each, so 0, 2, 4, 6
 *   before the round's allowance; Ailsa is the low and gets none anywhere.
 *   Hole 1 (S.I. 1) — Bram, Edda and Finn all get one. Hole 9 (S.I. 9) —
 *   nobody does (the most anybody gets is six).
 */
test("a net four-ball card says who gets a shot on the hole, and the strip marks W from the holder's side", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const stage = await prisma.match.findUniqueOrThrow({ where: { id: ids.match }, select: { stageId: true } });
  const set = async (name: string, handicap: number) =>
    prisma.player.updateMany({ where: { eventId: ids.event, name }, data: { handicap } });
  await prisma.stage.update({ where: { id: stage.stageId }, data: { scoringBasis: "net" } });
  await Promise.all([set("Zz Ailsa", 0), set("Zz Bram", 4), set("Zz Edda", 8), set("Zz Finn", 12)]);
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  try {
    await enter(page, "Zz Finn");
    await page.getByRole("button", { name: /^Hole 1,/ }).click();
    const note = page.getByText(/^Shots here: /);
    await expect(note, "the hole does not say who gets a shot").toBeVisible({ timeout: 20_000 });
    // The four share a first name ("Zz"), so the line names them in full.
    for (const n of ["Zz Bram", "Zz Edda", "Zz Finn"]) await expect(note).toContainText(n);
    await expect(note).not.toContainText("Zz Ailsa");
    await page.getByRole("button", { name: /^Hole 9,/ }).click();
    await expect(page.getByText("No shots on this hole")).toBeVisible();
    // Hole 1 went to side B in the first test, and Finn is side B: a W for him.
    await expect(page.getByRole("button", { name: /^Hole 1, won by Zz Edda & Zz Finn/ })).toContainText("W");
  } finally {
    await prisma.stage.update({ where: { id: stage.stageId }, data: { scoringBasis: "gross" } });
    await ctx.close();
  }
});

/**
 * A SCORER WHO PICKS THE WRONG NAME STILL GIVES EACH HOLE TO THE PAIR THAT WON
 * IT (2026-10-18). At the first real cup a scorer on the second side tapped an
 * OPPONENT's name, got the card from the opponents' side, and tapped "Us" for
 * his own pair's holes: the whole four-ball was stored the wrong way round, on
 * a card that looked right to him. The answers now name the pairs, so the tap
 * means the same whichever name was picked.
 *
 * Here a Whites scorer picks Ailsa — a Blues name — and gives hole 1 to his own
 * pair, Edda & Finn, by name: it must be stored for side B. And the control,
 * the same phone giving hole 2 to Ailsa & Bram: side A.
 */
test("a scorer who picked an opponent's name still gives each hole to the pair that won it", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const before = await prisma.match.findUniqueOrThrow({ where: { id: ids.match }, select: { holes: true } });
  await prisma.match.update({ where: { id: ids.match }, data: { holes: JSON.stringify(new Array(9).fill(null)) } });
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  const stored = async (i: number) => {
    const m = await prisma.match.findUniqueOrThrow({ where: { id: ids.match }, select: { holes: true } });
    return (JSON.parse(m.holes) as (string | null)[])[i];
  };
  try {
    await enter(page, "Zz Ailsa");
    // The card is the picked name's side, as it was on the course.
    await expect(page.getByRole("heading", { name: /Zz Ailsa & Zz Bram\s*vs\s*Zz Edda & Zz Finn/ })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("group", { name: "Who won hole 1" }).getByRole("button", { name: /^Hole 1 to Zz Edda & Zz Finn/ }).click();
    await expect.poll(() => stored(0), { timeout: 15_000, message: "hole 1, given to Edda & Finn by name, was not stored for their side" }).toBe("B");

    const hole2 = page.getByRole("group", { name: "Who won hole 2" });
    await expect(hole2).toBeVisible({ timeout: 10_000 });
    await hole2.getByRole("button", { name: /^Hole 2 to Zz Ailsa & Zz Bram/ }).click();
    await expect.poll(() => stored(1), { timeout: 15_000, message: "hole 2, given to Ailsa & Bram by name, was not stored for their side" }).toBe("A");
    // One hole each: the phone agrees it is all square.
    await expect(page.getByText("All square with 7 to play")).toBeVisible();
  } finally {
    await prisma.match.update({ where: { id: ids.match }, data: { holes: before.holes } });
    await ctx.close();
  }
});

test("a player in the round with no match is told so, and given nobody's card", async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  try {
    await enter(page, "Zz Spare");
    await expect(page.getByText(/is scored side by side on one card/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("group", { name: "Who won hole 1" })).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

/**
 * THE LEADERBOARD IS ONE TAP AWAY FROM THE CARD (2026-10-18). At the first real
 * cup every player scored by the code, and this page was score entry and
 * nothing else: nobody could see how the cup stood without the link on the
 * printed sheet. Where the organizer has made the board public, the page's
 * header carries it; where not, nothing is drawn (the control).
 */
test("the card links to the public leaderboard, and only when the board is public", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const was = await prisma.event.findUniqueOrThrow({ where: { id: ids.event }, select: { leaderboardVisibility: true, shareToken: true } });
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  try {
    await prisma.event.update({ where: { id: ids.event }, data: { leaderboardVisibility: "participants" } });
    await enter(page, "Zz Finn");
    await expect(page.getByRole("heading", { name: /Zz Edda & Zz Finn\s*vs/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: "Leaderboard" }), "a board only players may see is offered to a code").toHaveCount(0);

    await prisma.event.update({ where: { id: ids.event }, data: { leaderboardVisibility: "public" } });
    await page.goto(`/play?bust=${Date.now()}`);
    const board = page.getByRole("link", { name: "Leaderboard" });
    await expect(board, "the card has no way to the public board").toBeVisible({ timeout: 20_000 });
    await expect(board).toHaveAttribute("href", `/live/${was.shareToken}`);
    await board.click();
    await expect(page).toHaveURL(new RegExp(`/live/${was.shareToken}`));
    await expect(page.getByText(`${MARK} Autumn Cup`).first(), "the link does not open this tournament's board").toBeVisible({ timeout: 20_000 });
  } finally {
    await prisma.event.update({ where: { id: ids.event }, data: { leaderboardVisibility: was.leaderboardVisibility } });
    await ctx.close();
  }
});
