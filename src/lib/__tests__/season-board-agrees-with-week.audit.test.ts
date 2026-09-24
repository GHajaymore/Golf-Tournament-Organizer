import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

import { weekViewFor } from "@/lib/services/week-view";
import { loadEventState } from "@/lib/services/tournament";

/**
 * THE SEASON TABLE AND THIS-WEEK MUST RANK THE LEAGUE THE SAME WAY.
 *
 * A league season is decided on the TOTAL — Ajay's call, and the whole of the
 * #565 fix. Two screens carry that total and read it two different ways:
 * `/week` (`standingsWithMovement`) ranks on the raw points total, and
 * `/leaderboard` + the player's `/me/board` read `state.strokeStandings`, which
 * ranks on `points − levelPoints`. `levelPoints` normalises a SINGLE live round
 * so a player thru 9 is not buried on a smaller total — right for a one-day
 * board, wrong across a season, because the "active round" is the most recent
 * PLAYED week and charging it at holes-played hands a level-score gift to
 * whoever skipped THAT week, floating them above higher-scoring members.
 *
 * Found 2026-09-23 on the seeded Thursday Evening League: Priyanka on 87 (skipped
 * the board week) ranked 11th above Rafe on 112 (played it) at 13th, and the two
 * screens disagreed below row ten. `stableford-ranks-on-points.audit.test.ts`
 * could not see it: its fixture is ONE Stableford round, and this bug needs two
 * rounds with uneven attendance. This is that fixture.
 *
 * THE TRAP IS BUILT IN: the skipper's single big week beats the faithful
 * player's per-week score, so the buggy reader floats the skipper up — while
 * the skipper's SEASON total is lower and the league is theirs to lose. So the
 * test pins the two readers AGREE, and pins the direction the bug reversed:
 * higher total wins, the lower-total skipper does not.
 *
 * Revert the `isSeason` guard in `tournament.ts` (take the board week as the
 * active round again) and the strokeStandings assertions go red while the week
 * view stays green — the two screens split, which is the defect.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-season-agrees";

const PAR = 4;
const PARS = new Array(18).fill(PAR);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);

// Scratch handicaps, PAR-4 everywhere, net = gross. Stableford pays 2 for a
// par and 1 for a bogey, so points are read straight off how many bogeys.
/** 6 bogeys, 12 pars → 30 Stableford points. The faithful player, every week. */
const FAITHFUL_CARD = PARS.map((p, i) => (i < 6 ? p + 1 : p));
/** 2 bogeys, 16 pars → 34 points: a better single night than the faithful. */
const SKIPPER_CARD = PARS.map((p, i) => (i < 2 ? p + 1 : p));

let eventId = "";
let weekOne = "";
let weekTwo = "";
let faithfulId = "";
let skipperId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function week(position: number, description: string, daysAgo: number) {
  const iso = new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);
  const s = await prisma.stage.create({
    data: {
      eventId,
      position,
      description,
      type: "Stroke Play Round",
      format: "Stableford",
      scoringBasis: "net",
      holes: 18,
      playedOn: iso,
    },
    select: { id: true },
  });
  return s.id;
}

async function card(stageId: string, playerId: string, strokes: number[]) {
  await prisma.scorecard.create({
    data: { eventId, stageId, playerId, strokes: JSON.stringify(strokes) },
  });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} league`,
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      dates: "",
      course: `${TAG} Course`,
      city: `${TAG} Town`,
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: randomBytes(10).toString("hex"),
      registrationToken: randomBytes(6).toString("hex"),
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
    },
    select: { id: true },
  });
  eventId = event.id;

  const mk = async (who: string, seed: number) =>
    (
      await prisma.player.create({
        data: {
          eventId,
          name: `${TAG} ${who}`,
          email: `${TAG}-${who}@example.invalid`,
          handicap: 0,
          seed,
          status: "confirmed",
        },
        select: { id: true },
      })
    ).id;
  faithfulId = await mk("faithful", 1);
  skipperId = await mk("skipper", 2);

  weekOne = await week(0, "Week 1", 14);
  weekTwo = await week(1, "Week 2", 7);

  // Week 1: both play. The skipper has the better night (34 vs 30).
  await card(weekOne, faithfulId, FAITHFUL_CARD);
  await card(weekOne, skipperId, SKIPPER_CARD);
  // Week 2 — the board week: only the faithful returns a card. The skipper is
  // absent, so the buggy reader charges them nothing for it and floats them up.
  await card(weekTwo, faithfulId, FAITHFUL_CARD);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const who = (name: string) => name.replace(`${TAG} `, "");

describe("a league season with uneven attendance", () => {
  it("has a fixture that really can float the skipper up", async () => {
    // The trap, asserted rather than assumed (a fixture where totals and single
    // weeks agree cannot express this bug). The SEASON table: faithful 30 + 30 =
    // 60 over two weeks, skipper 34 over one. And the skipper's single night
    // (34) beats the faithful's (30) — the figure the buggy reader floated up.
    const week = await weekViewFor(eventId, weekTwo);
    const f = week!.standings.find((r) => who(r.name) === "faithful")!;
    const s = week!.standings.find((r) => who(r.name) === "skipper")!;
    expect(f.value, "faithful's season total").toBe(60);
    expect(s.value, "skipper's season total (one week)").toBe(34);
    const nights = week!.results.filter((r) => r.thru > 0);
    // Only the faithful returned a card this (board) week, so the skipper's
    // absence is exactly the state that mischarged them.
    expect(nights.map((r) => who(r.name)), "only the faithful played the board week").toEqual([
      "faithful",
    ]);
  });

  it("ranks the week view season table on the total — faithful ahead of skipper", async () => {
    const week = await weekViewFor(eventId, weekTwo);
    expect(who(week!.standings[0].name), "the week view ranks on the season total").toBe(
      "faithful",
    );
  });

  it("ranks the season board the same way the week view does", async () => {
    // The reader that had the bug. It must agree with the week view above:
    // both are the same league on the same night, and a member reads both.
    const state = await loadEventState(eventId);
    const ranked = state!.strokeStandings.filter((r) => r.ranked);
    const faithful = ranked.find((r) => who(r.player.name) === "faithful")!;
    const skipper = ranked.find((r) => who(r.player.name) === "skipper")!;

    expect(faithful.points, "faithful has the higher season total").toBeGreaterThan(
      skipper.points,
    );
    // The direction the bug reversed: the lower-total skipper must NOT outrank
    // the higher-total faithful. rank 1 is best; a smaller rank is higher.
    expect(faithful.rank, "the higher total is ranked above the skipper").toBeLessThan(
      skipper.rank,
    );
    // And the two screens agree on the leader outright.
    expect(who(ranked[0].player.name), "season board leader == week view leader").toBe(
      "faithful",
    );
  });
});
