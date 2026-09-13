import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { weekViewFor } from "@/lib/services/week-view";

/**
 * THE HEADING OVER THE SEASON TABLE FOLLOWS THE TABLE.
 *
 * `standingsWithMovement` has known since 2026-09-12 that a medal night in a
 * match-play league "earns no match points, so it shows the season as it
 * stands going INTO that night". The heading above it did not, and read
 * "Standings after this week" whatever was underneath.
 *
 * Read off the demo league's Week 2 — a Stroke Play Round in a match-play
 * season: seven gross scores on the night, and beneath them a points table
 * whose movement column read "—" for all thirty-three players. Every number
 * right; the heading says the night has been counted and the dashes say it has
 * not. The natural reading is that the app lost a week.
 *
 * AN AUDIT TEST BECAUSE IT IS ABOUT WHICH ROWS THE SERVICE CHOSE. The rule is
 * two lines and the way to get it wrong is to ask the stage's TYPE instead of
 * asking the list that actually builds the table — a mistake no pure test of a
 * two-line predicate can see.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-WEEKHEAD";

let matchLeague = "";
let matchWeek = "";
let medalWeek = "";
let strokeLeague = "";
let strokeWeek2 = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function makeLeague(name: string, format: string) {
  const org = await prisma.organization.create({
    data: { name: `${TAG} ${name}`, kind: "club" },
    select: { id: true },
  });
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} ${name}`,
      organizationId: org.id,
      shape: "series",
      format,
      status: "active",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}`,
    },
    select: { id: true },
  });
  const group = await prisma.group.create({
    data: { eventId: ev.id, name: `${TAG} g`, position: 0 },
    select: { id: true },
  });
  const players = [];
  for (let i = 0; i < 2; i += 1) {
    players.push(
      await prisma.player.create({
        data: {
          eventId: ev.id,
          groupId: group.id,
          name: `${TAG} P${i + 1}`,
          email: `${TAG}-${name}-${i}@example.invalid`.toLowerCase(),
          seed: i + 1,
          status: "confirmed",
          handicap: 0,
        },
        select: { id: true },
      }),
    );
  }
  return { eventId: ev.id, groupId: group.id, players };
}

const stage = (eventId: string, position: number, description: string, type: string, format: string) =>
  prisma.stage.create({
    data: { eventId, position, description, type, format, scoringBasis: "gross", holes: 18 },
    select: { id: true },
  });

beforeAll(async () => {
  await scrub();

  /**
   * A MATCH LEAGUE WITH A MEDAL NIGHT IN IT — the demo's shape, and the case
   * that was wrong. Week 1 a round robin, week 2 a medal, both with real
   * scores on them so neither is empty for the wrong reason.
   */
  {
    const { eventId, groupId, players } = await makeLeague("match-league", "match");
    matchLeague = eventId;
    const w1 = await stage(eventId, 0, "Week 1", "Round Robin", "Match Play");
    const w2 = await stage(eventId, 1, "Week 2", "Stroke Play Round", "Stroke Play");
    matchWeek = w1.id;
    medalWeek = w2.id;
    await prisma.match.create({
      data: {
        eventId,
        stageId: w1.id,
        groupId,
        round: 1,
        playerAId: players[0].id,
        playerBId: players[1].id,
        holes: JSON.stringify(new Array(18).fill("A")),
        scoreStatus: "confirmed",
      },
    });
    for (const [i, p] of players.entries()) {
      await prisma.scorecard.create({
        data: {
          eventId,
          stageId: w2.id,
          playerId: p.id,
          strokes: JSON.stringify(new Array(18).fill(4 + i)),
          status: "approved",
        },
      });
    }
  }

  /**
   * THE CONTROL: a stroke league, where every week really does feed the table.
   * Without it a change that simply stopped claiming "after this week" for
   * everybody would pass — and would be a different untruth, on the screen a
   * stroke league reads every week.
   */
  {
    const { eventId, players } = await makeLeague("stroke-league", "stroke");
    strokeLeague = eventId;
    const w1 = await stage(eventId, 0, "Week 1", "Stroke Play Round", "Stroke Play");
    const w2 = await stage(eventId, 1, "Week 2", "Stroke Play Round", "Stroke Play");
    strokeWeek2 = w2.id;
    for (const s of [w1, w2]) {
      for (const [i, p] of players.entries()) {
        await prisma.scorecard.create({
          data: {
            eventId,
            stageId: s.id,
            playerId: p.id,
            strokes: JSON.stringify(new Array(18).fill(4 + i)),
            status: "approved",
          },
        });
      }
    }
  }
});

afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

describe("whether the week is in the table above it", () => {
  it("says a medal night in a match league is not", async () => {
    const view = (await weekViewFor(matchLeague, medalWeek))!;
    expect(view.standingsIncludeThisWeek, "a night that earns no points claimed to be counted").toBe(false);
    // And the table is not empty — the claim is about what is IN it, not
    // whether there is one. A blank table would make this pass for free.
    expect(view.standings.length).toBeGreaterThan(0);
  });

  it("says a match night in the same league is", async () => {
    /**
     * THE DISCRIMINATOR. Same tournament, same players, one stage different.
     * A change that answered "false" everywhere passes the test above and
     * fails this one.
     */
    const view = (await weekViewFor(matchLeague, matchWeek))!;
    expect(view.standingsIncludeThisWeek).toBe(true);
  });

  it("says every week of a stroke league is", async () => {
    // A stroke league sums the cards, so there is no night that earns nothing
    // — and this is the shape `verify-week-view.mjs` asserts the heading on.
    const view = (await weekViewFor(strokeLeague, strokeWeek2))!;
    expect(view.standingsIncludeThisWeek).toBe(true);
    expect(view.standings.length).toBeGreaterThan(0);
  });
});
