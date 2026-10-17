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

async function enter(page: import("@playwright/test").Page, name: string) {
  await page.goto("/play");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByLabel("Round code").fill(CODE);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name }).click();
}

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
