import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { playGroups, openFullList } from "./keep-on-play";

/**
 * THE CUP'S WRONG CARD, PRESSED THE NEW WAY (2026-11-04).
 *
 * At a real team cup on 18 Oct scorers scanned the cart sign, which opens
 * `/play` with the round code, and the page listed every player. Two scorers
 * tapped a name from the OPPOSING pair; the card turned round to face that pair,
 * they pressed the place their own side's button had been, and the board took
 * every hole they won as the other side's.
 *
 * Here a scorer on side B does what they did, the way the page now asks:
 *
 *   the code                     → the round's ONE group, the match, both pairs
 *                                  named, side A first ("Match 1")
 *   the group                    → said back in full: "You're keeping Match 1: …",
 *                                  "Yes, that's my group" / "No, go back"
 *   yes                          → the match as drawn, side A first, answers by
 *                                  TEAM: "Zz Reds won · Halved · Zz Golds won"
 *   hole 1 to their own team     → stored for side B
 *   the public board             → side B one up after one: "1 UP thru 1 ▶"
 *   the same phone, again        → straight to the card: asked once per phone
 *
 * Its own club, cup, round code, four invented players and one match, deleted
 * afterwards. WHAT IT CANNOT SEE: a second phone keeping the same match (sprint 2).
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const MARK = "zz-keeps-a-group";
const ALPHABET = "ABCDEFGHJKMNPQRTWXYZ2346789";
const CODE = "ZZ" + Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const ids = { org: "", event: "", match: "", token: `${MARK}-${CODE}` };
const A = "Zz Ann Ash & Zz Bea Birch";
const B = "Zz Cal Cedar & Zz Dot Dale";

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
      shareToken: ids.token,
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(380)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      playerAccess: "code",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      leaderboardVisibility: "public",
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
      matchKeptBy: "holes",
    },
  });
  const [reds, golds] = await Promise.all(
    ["Zz Reds", "Zz Golds"].map((name, position) => prisma.group.create({ data: { eventId: event.id, name, position } })),
  );
  const carrier = await prisma.group.create({
    data: { eventId: event.id, name: "Four-Ball — cup session", position: 2, stageId: stage.id, isCarrier: true },
  });
  const person = (name: string, groupId: string, i: number) =>
    prisma.player.create({
      data: { eventId: event.id, groupId, name, email: `${MARK}-${i}@example.invalid`, status: "confirmed", seed: i + 1, handicap: 0 },
    });
  const a1 = await person("Zz Ann Ash", reds.id, 0);
  const a2 = await person("Zz Bea Birch", reds.id, 1);
  const b1 = await person("Zz Cal Cedar", golds.id, 2);
  const b2 = await person("Zz Dot Dale", golds.id, 3);
  const side = (name: string, flight: string, players: string[]) =>
    prisma.team.create({
      data: { eventId: event.id, stageId: stage.id, name, clubGroupId: flight, members: { create: players.map((playerId, position) => ({ playerId, position })) } },
    });
  const sa = await side(A, reds.id, [a1.id, a2.id]);
  const sb = await side(B, golds.id, [b1.id, b2.id]);
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

const storedHole = async (i: number) => {
  const m = await prisma.match.findUniqueOrThrow({ where: { id: ids.match }, select: { holes: true } });
  return (JSON.parse(m.holes) as (string | null)[])[i];
};

test("a scorer on side B: the code, the group, one confirmation, a hole to their own team — and the board credits side B", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  watchPageErrors(page, errors, "a scorer by the code");
  try {
    await page.goto("/play");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByLabel("Round code").fill(CODE);
    await page.getByRole("button", { name: "Continue" }).click();

    // GROUPS, not names: the round's one match, side A first.
    await expect(page.getByText("Tap your group to start scoring.")).toBeVisible({ timeout: 20_000 });
    await expect(playGroups(page)).toHaveCount(1);
    const group = playGroups(page).first();
    await expect(group).toHaveText(new RegExp(`^Match 1\\s+${A} v ${B}$`));
    for (const n of ["Zz Ann Ash", "Zz Cal Cedar"]) await expect(page.getByRole("button", { name: n, exact: true }), "a name is still a button of its own").toHaveCount(0);

    // THE ONE CONFIRMATION, in full, before anything starts.
    await group.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`You're keeping Match 1: ${A} v ${B}`);
    await expect(page.getByRole("button", { name: "No, go back" })).toBeVisible();
    expect((await ctx.cookies()).some((c) => c.name.toLowerCase().includes("play")), "a group nobody confirmed started a session").toBe(false);
    await page.getByRole("button", { name: "Yes, that's my group" }).click();

    // The match as drawn, whoever holds the phone: side A first, answers by team.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(new RegExp(`${A}\\s*vs\\s*${B}`), { timeout: 30_000 });
    const hole1 = page.getByRole("group", { name: "Who won hole 1" });
    await expect(hole1.getByRole("button")).toHaveText([/^Zz Reds won/, /^Halved/, /^Zz Golds won/]);
    await expect(page.getByText("Keeping this match for both sides")).toBeVisible();

    // The scorer is a Gold: they give hole 1 to their own team, by its name.
    const golds = hole1.getByRole("button", { name: /^Hole 1 to Zz Cal Cedar & Zz Dot Dale/ });
    await expect(golds).toHaveText(/^Zz Golds won/);
    await golds.click();
    await expect.poll(() => storedHole(0), { timeout: 15_000, message: "the hole given to the Golds was never stored" }).toBe("B");
    await expect(page.getByText("Zz Golds 1 up with 8 to play")).toBeVisible();

    // THE BOARD: side B one up after one, arrow to the right-hand (side B) names.
    const board = await ctx.newPage();
    watchPageErrors(board, errors, "the public board");
    await board.goto(`/live/${ids.token}?bust=${Date.now()}`);
    const row = board.getByRole("listitem").filter({ hasText: "Zz Ann Ash" }).filter({ hasText: "Zz Cal Cedar" }).first();
    await expect(row, "the board does not show the match").toBeVisible({ timeout: 30_000 });
    await expect(row, "the board did not credit side B with the hole").toContainText(/1 UP thru 1\s*▶/);
    await expect(row).not.toContainText("◀");
    await board.close();

    // ASKED ONCE PER PHONE: out and back in on the same phone goes straight to the card.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("Round code")).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("Round code").fill(CODE);
    await page.getByRole("button", { name: "Continue" }).click();
    // The phone confirmed this group a moment ago, so the page offers it first (2026-11-05): the list is behind "Not my group".
    await openFullList(page);
    await playGroups(page).first().click();
    await expect(page.getByRole("group", { name: /^Who won hole/ }), "the confirmed group did not open its card").toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Yes, that's my group" }), "the same phone was asked again").toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await ctx.close();
  }
});
