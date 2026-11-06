import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { statusFixture, prisma } from "./status-fixture";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * THE DAY'S RESULT NAMES THE PAIRS, NOT "SIDE A" (#1034).
 *
 * A team match leaves its player columns empty, and the result line on
 * `/me/board` read them: "Side B beat Side A 10&8". Two rounds of pairs, one
 * match each, played out:
 *
 *   Round 1 (Four-Ball)   zz Reds v zz Blues     Reds won 10&8
 *   Round 2 (Foursomes)   zz Greens v zz Golds   Golds won 10&8
 *
 * The board shows a result line only where there are two rounds, which is why
 * this is two. It reads the lines, not the table, so which round the table
 * shows does not matter here.
 *
 * Its own throwaway club (`zz-status-teamline-*`), deleted in `finally`.
 */
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

test("a player's board names the pairs that won, never Side A or Side B (#1034)", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "teamline",
    players: 8,
    event: { dates: "Sunday", format: "match", status: "live", configUnlocked: false },
    rounds: [
      { type: "Round Robin", format: "Four-Ball", scoringBasis: "net" },
      { type: "Round Robin", format: "Foursomes", scoringBasis: "net" },
    ],
  });
  const size = testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase();
  const playerEmail = `zz-status-teamline-${size}-0@example.invalid`; // the fixture's first player
  let playerUserId = "";
  try {
    const sides: Array<[string, number, string[]]> = [
      ["zz Reds", 0, f.playerIds.slice(0, 2)],
      ["zz Blues", 0, f.playerIds.slice(2, 4)],
      ["zz Greens", 1, f.playerIds.slice(4, 6)],
      ["zz Golds", 1, f.playerIds.slice(6, 8)],
    ];
    const teamId: Record<string, string> = {};
    for (const [i, [name, round, ids]] of sides.entries()) {
      const t = await prisma.team.create({ data: { eventId: f.eventId, stageId: f.stageIds[round], name, seed: i + 1 } });
      teamId[name] = t.id;
      for (const [p, playerId] of ids.entries()) await prisma.teamMember.create({ data: { teamId: t.id, playerId, position: p } });
    }
    const tenWon = (side: "A" | "B") => JSON.stringify([...new Array(10).fill(side), ...new Array(8).fill(null)]);
    const match = async (round: number, a: string, b: string, holes: string) => {
      const carrier = await prisma.group.create({
        data: { eventId: f.eventId, stageId: f.stageIds[round], isCarrier: true, name: `Round ${round + 1}`, position: 9 + round },
      });
      return prisma.match.create({
        data: { eventId: f.eventId, stageId: f.stageIds[round], groupId: carrier.id, round: 1, playerAId: "", playerBId: "", teamAId: teamId[a], teamBId: teamId[b], holes },
      });
    };
    await match(0, "zz Reds", "zz Blues", tenWon("A"));
    await match(1, "zz Greens", "zz Golds", tenWon("B"));

    const user = await prisma.user.create({ data: { email: playerEmail, name: "Wren Halloway", password: "x:unusable", emailVerifiedAt: new Date() } });
    playerUserId = user.id;
    await prisma.account.create({ data: { eventId: f.eventId, email: playerEmail, name: "Wren Halloway", role: "player" } });
    const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] } });
    await ctx.addCookies([
      { name: "ng_session", value: sign(signedInNow(user.id)), url: baseURL! },
      { name: "ng_active_event", value: sign(f.eventId), url: baseURL! },
    ]);
    try {
      const phone = await ctx.newPage();
      watchPageErrors(phone, errors, "player");
      expect((await phone.goto(`/me/board?bust=${Date.now()}`))?.status(), "the player is signed in").toBe(200);
      const main = phone.locator("main");
      await expect(main, "round 1 names the pair that won").toContainText("zz Reds beat zz Blues 10&8");
      await expect(main, "round 2 names the pair that won").toContainText("zz Golds beat zz Greens 10&8");
      await expect(main, "no placeholder side").not.toContainText(/Side [AB]\b/);
    } finally {
      await ctx.close();
    }
    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await f.done();
    if (playerUserId) await prisma.user.deleteMany({ where: { id: playerUserId } });
    await prisma.$disconnect();
  }
});
