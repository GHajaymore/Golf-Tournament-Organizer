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
 *   the holder is on the SECOND side       → the card reads "Us" v "Them", the
 *                                            two sides by name, and hole 1 to
 *                                            "you" is stored as hole 1 to side B
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
    // The holder speaks for their side: "Us" against "Them", not "Me" against a first name.
    await expect(hole1.getByText("Us", { exact: true })).toBeVisible();
    await expect(hole1.getByText("Them", { exact: true })).toBeVisible();
    await hole1.getByRole("button", { name: /^Hole 1 to you/ }).click();

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
    await expect(page.getByText("Us 1 up with 8 to play")).toBeVisible();

    // Four more: five up with four to play over a nine, and the phone says the
    // match is OVER rather than offering the sixth as if it were still on.
    for (let n = 2; n <= 5; n += 1) {
      const g = page.getByRole("group", { name: `Who won hole ${n}` });
      await expect(g).toBeVisible({ timeout: 10_000 });
      await g.getByRole("button", { name: new RegExp(`^Hole ${n} to you`) }).click();
    }
    await expect(page.getByRole("status").filter({ hasText: "Match over: Us 5&4. Nothing more to enter." })).toBeVisible({ timeout: 10_000 });
    expect(errors).toEqual([]);
  } finally {
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
