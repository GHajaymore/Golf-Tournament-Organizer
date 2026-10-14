import { test, expect } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * A MATCH WON 5&4 ON A ROUND CODE GOES IN WHEN IT IS DECIDED, NOT AFTER EIGHTEEN HOLES.
 *
 * Where the organizer wants the whole round handed in at the end, the round-code
 * screen holds a player's card back until it is finished, and then sends it.
 * Until 2026-10-14 "finished" meant every hole filled, so a match won five up
 * with four to play (Rule 3.2a(3)) was never sent: the screen asked the player
 * for "all 18 holes", four of which nobody plays. It asks whether the match is
 * DECIDED now (`matchIsOverAfter`), and the server agrees (`matchIsOver`).
 *
 *   thirteen holes, five up with five to play   → nothing sent; the screen asks for more
 *   the fourteenth, five up with four to play   → the card goes in, scored
 *
 * Its own club, tournament, round, two invented players and one match, deleted
 * afterwards — never the fixture's tournament, which other specs are reading.
 * WHAT IT CANNOT SEE: a net match (this one is gross), and the Final result box.
 */

const prisma = new PrismaClient();
const MARK = "zz-decided-match";
const ALPHABET = "ABCDEFGHJKMNPQRTWXYZ2346789";
const CODE = "ZZ" + Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const ids = { org: "", event: "", match: "" };

test.beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${MARK} club`, kind: "club" } });
  ids.org = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Spring Matchplay`,
      status: "live",
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
      // The whole round handed in at the end.
      scoreEntryWindow: "after",
    },
  });
  ids.event = event.id;
  const group = await prisma.group.create({ data: { eventId: event.id, name: `${MARK} flight`, position: 0 } });
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Round Robin", format: "Match Play", scoringBasis: "gross", holes: 18, accessCode: CODE },
  });
  const [a, b] = await Promise.all(
    ["Zz Decider", "Zz Opponent"].map((name, i) =>
      prisma.player.create({
        data: { eventId: event.id, groupId: group.id, name, email: `${MARK}-${i}@example.invalid`, status: "confirmed", seed: i + 1, handicap: 0 },
      }),
    ),
  );
  ids.match = (
    await prisma.match.create({
      data: { eventId: event.id, stageId: stage.id, groupId: group.id, round: 1, playerAId: a.id, playerBId: b.id, holes: JSON.stringify(new Array(18).fill(null)) },
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

const stored = async () => {
  const m = await prisma.match.findUniqueOrThrow({ where: { id: ids.match }, select: { holes: true, scoredAt: true } });
  return { results: (JSON.parse(m.holes) as (string | null)[]).filter((h) => h !== null).length, scoredAt: m.scoredAt };
};

test("a match decided 5&4 on a round code is handed in at the fourteenth, not held for eighteen", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  watchPageErrors(page, errors);
  try {
    await page.goto("/play");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByLabel("Round code").fill(CODE);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Zz Decider" }).click();

    const ask = page.getByText("Fill in each hole until the match is decided");
    await expect(ask, "the whole-round screen says what it is waiting for").toBeVisible({ timeout: 20_000 });

    /** Who won hole n, pressed on the card's own button, and the card moved on to the next. */
    const press = async (n: number, who: RegExp) => {
      const group = page.getByRole("group", { name: `Who won hole ${n}` });
      await expect(group).toBeVisible({ timeout: 10_000 });
      await group.getByRole("button", { name: who }).click();
    };
    for (let n = 1; n <= 5; n += 1) await press(n, new RegExp(`^Hole ${n} to you`));
    for (let n = 6; n <= 13; n += 1) await press(n, new RegExp(`^Hole ${n} halved`));

    // Five up with five to play: not over, and so nothing has been sent.
    await expect(page.getByRole("group", { name: "Who won hole 14" })).toBeVisible();
    await page.waitForTimeout(1_500);
    expect((await stored()).results, "a card held for the end was sent before the match was decided").toBe(0);
    await expect(ask).toBeVisible();

    // The fourteenth halved: five up with four to play, and the match is over.
    await press(14, /^Hole 14 halved/);
    await expect(ask, "the screen still asks for holes after the match is decided").toBeHidden({ timeout: 10_000 });
    await expect.poll(async () => (await stored()).results, { timeout: 15_000, message: "the decided card was never sent" }).toBe(14);
    expect((await stored()).scoredAt, "a decided match is a scored one").not.toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});
