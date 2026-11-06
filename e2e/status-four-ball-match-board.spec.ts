import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { statusFixture, prisma } from "./status-fixture";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * A FOUR-BALL ROUND ROBIN, AS A PLAYER READS IT ON THEIR PHONE (J23, #1027).
 *
 * A round of team MATCHES is decided on the matches, not on the cards. The
 * player's board (`/me/board`) used to ask the format alone (`boardKind`) and
 * sent a four-ball match to the team STROKE table; the console leaderboard,
 * Reports and /live asked the round (`boardKindForRound`). Four sides of two:
 *
 *   Reds v Blues     Reds won 10&8, played out
 *   Greens v Golds   Golds won 10&8 on the card, but the result is in DISPUTE
 *
 * On /me/board the match table has Reds first, with a win, Blues second with a
 * loss, and the disputed match counts for nobody (Greens and Golds have played
 * none). On Today (/me) a Reds player is told how their side's match stands, not
 * a stroke place.
 *
 * WHAT IT CANNOT SEE: the arithmetic of the handicap strokes in a match
 * (`four-ball-plays-off.test.tsx`, `matrix.test.ts`).
 *
 * Its own throwaway club (`zz-status-fbmatch-*`), deleted in `finally`.
 */
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

test("a four-ball match round puts the side that won first on a player's board, and holds a disputed match off (J23)", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "fbmatch",
    players: 8,
    event: { dates: "Sunday", format: "match", status: "live", configUnlocked: false },
    rounds: [{ type: "Round Robin", format: "Four-Ball", scoringBasis: "net" }],
  });
  const stageId = f.stageIds[0];
  const size = testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase();
  const playerEmail = `zz-status-fbmatch-${size}-0@example.invalid`; // the fixture's first player: a Reds member
  let playerUserId = "";
  try {
    const sides: Array<[string, string[]]> = [
      ["zz Reds", f.playerIds.slice(0, 2)],
      ["zz Blues", f.playerIds.slice(2, 4)],
      ["zz Greens", f.playerIds.slice(4, 6)],
      ["zz Golds", f.playerIds.slice(6, 8)],
    ];
    const teamId: Record<string, string> = {};
    for (const [i, [name, ids]] of sides.entries()) {
      const t = await prisma.team.create({ data: { eventId: f.eventId, stageId, name, seed: i + 1 } });
      teamId[name] = t.id;
      for (const [p, playerId] of ids.entries()) await prisma.teamMember.create({ data: { teamId: t.id, playerId, position: p } });
    }
    const carrier = await prisma.group.create({
      data: { eventId: f.eventId, stageId, isCarrier: true, name: "Four-Ball — Round 1", position: 9 },
    });
    const tenWon = (side: "A" | "B") => JSON.stringify([...new Array(10).fill(side), ...new Array(8).fill(null)]);
    const match = (a: string, b: string, holes: string, scoreStatus?: string) =>
      prisma.match.create({
        data: { eventId: f.eventId, stageId, groupId: carrier.id, round: 1, playerAId: "", playerBId: "", teamAId: teamId[a], teamBId: teamId[b], holes, ...(scoreStatus ? { scoreStatus } : {}) },
      });
    await match("zz Reds", "zz Blues", tenWon("A"));
    await match("zz Greens", "zz Golds", tenWon("B"), "disputed");

    // The player: an account at this event whose address is a Reds member's.
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
      const rows = phone.locator("main table tbody tr");
      await expect(rows, "four sides on the match table").toHaveCount(4);
      const cells = async (i: number) => (await rows.nth(i).locator("td").allInnerTexts()).map((t) => t.trim());
      // Played, won, halved, lost — the columns of the match table.
      const first = await cells(0);
      expect(first[1], "the side that won the match is placed first").toContain("zz Reds");
      expect(first.slice(2, 6), "P W ½ L").toEqual(["1", "1", "0", "0"]);
      const second = await cells(1);
      expect(second[1]).toContain("zz Blues");
      expect(second.slice(2, 6)).toEqual(["1", "0", "0", "1"]);
      // The disputed match is held off: neither side in it has played one.
      for (const name of ["zz Greens", "zz Golds"]) {
        const row = rows.filter({ hasText: name });
        await expect(row).toHaveCount(1);
        expect((await row.locator("td").allInnerTexts()).map((t) => t.trim()).slice(2, 6), `${name}: a disputed match counts for nobody`).toEqual(["0", "0", "0", "0"]);
      }

      // Today tells the player how their side's match stands.
      expect((await phone.goto(`/me?bust=${Date.now()}`))?.status()).toBe(200);
      await expect(phone.locator("main")).toContainText("Won 1, halved 0, lost 0.");
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
