import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { weekViewFor } from "@/lib/services/week-view";

/**
 * THE SEASON TABLE BELONGS TO THE WEEK IT IS UNDER.
 *
 * `chainRoundStandings` returns a list parallel to `state.rrStages` — Round
 * Robins only — and the week sheet read it at the index of the WEEK, which is
 * `WEEKLY_ROUND_TYPES`: Round Robin AND Stroke Play Round. Those two lists line
 * up only in a league whose every week is a round robin, and slip by one the
 * moment a medal night appears before a match night.
 *
 * Measured on 2026-09-12 on a two-week league, medal first:
 *
 *   week 1 (the MEDAL)  -> standings 2.5/0   <- week 2's match points
 *   week 2 (the MATCH)  -> standings (none)  <- its own, missing
 *
 * A league's season table shown against the wrong night and absent from the
 * right one — and nothing on either screen says so, because the numbers are
 * real numbers belonging to a real week.
 *
 * The same shape the repo already records as `ranking-then-renumbering`: an
 * answer that knows which row it belongs to, handed to a reader that
 * re-derives it from a position.
 *
 * Found by following the `event.format` sweep of 2026-09-11/12 into the week
 * sheet — not by anybody looking at a league.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SEASONALIGN";

let eventId = "";
let medalWeek = "";
let matchWeek = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} league`,
      organizationId: org.id,
      shape: "series",
      format: "match",
      status: "active",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-1`,
    },
    select: { id: true },
  });
  eventId = ev.id;
  const group = await prisma.group.create({
    data: { eventId, name: `${TAG} g`, position: 0 },
    select: { id: true },
  });
  const ps = [];
  for (let i = 0; i < 2; i += 1) {
    ps.push(
      await prisma.player.create({
        data: {
          eventId,
          groupId: group.id,
          name: `${TAG} P${i + 1}`,
          email: `${TAG}-${i}@example.invalid`,
          seed: i + 1,
          status: "confirmed",
          handicap: 0,
        },
        select: { id: true },
      }),
    );
  }

  /**
   * WEEK 1 IS THE MEDAL, and that ORDER is the entire fixture.
   *
   * A Stroke Play Round is a week and is not a Round Robin, so it is in
   * `weeks` and not in `rrStages`. Put it first and every index after it is
   * off by one. Put it last — which is what every earlier fixture in this repo
   * happened to do — and nothing goes wrong, which is why this survived.
   */
  const medal = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      description: "Week 1",
      type: "Stroke Play Round",
      format: "Stroke Play",
      scoringBasis: "gross",
      holes: 18,
    },
    select: { id: true },
  });
  medalWeek = medal.id;
  for (const [i, p] of ps.entries()) {
    await prisma.scorecard.create({
      data: {
        eventId,
        stageId: medalWeek,
        playerId: p.id,
        strokes: JSON.stringify([...new Array(17).fill(4), 4 + i * 3]),
      },
    });
  }

  // Week 2 is the match night, and the only source of match points in the
  // league.
  const match = await prisma.stage.create({
    data: { eventId, position: 1, description: "Week 2", type: "Round Robin", format: "Match Play", holes: 18 },
    select: { id: true },
  });
  matchWeek = match.id;
  await prisma.match.create({
    data: {
      eventId,
      stageId: matchWeek,
      groupId: group.id,
      round: 1,
      playerAId: ps[0].id,
      playerBId: ps[1].id,
      holes: JSON.stringify(["A", "A", "A", "A", "A", ...new Array(13).fill(null)]),
    },
  });
}, 120_000);

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a league with a medal night first", () => {
  it("does not show the match week's points under the medal week", async () => {
    /**
     * THE ONE THAT WAS WRONG. Nothing has been won when week 1 is played — the
     * only match night is still to come — so there is no season table to show.
     * It showed week 2's.
     */
    const view = await weekViewFor(eventId, medalWeek);
    expect(view, "the week sheet did not build").toBeTruthy();
    expect(
      view!.standings,
      "a week before any match night was given somebody's points",
    ).toEqual([]);
    // And the night itself is not empty — it has cards, and its own gross/net
    // table. The two questions are separate, which is what made this hard to
    // see: the screen looked fully populated.
    expect(view!.empty).toBe(false);
    expect(view!.hasScoreTable).toBe(true);
  });

  it("shows the match week's points under the match week", async () => {
    // The other half, and it was MISSING rather than wrong — `chained[1]` did
    // not exist, so the season table simply was not rendered on the only night
    // that had one.
    const view = await weekViewFor(eventId, matchWeek);
    expect(view!.standings.length, "the season table vanished from its own week").toBeGreaterThan(0);
    const total = view!.standings.reduce((a, r) => a + r.value, 0);
    expect(total, "a decided match awarded nobody anything").toBeGreaterThan(0);
  });
});
