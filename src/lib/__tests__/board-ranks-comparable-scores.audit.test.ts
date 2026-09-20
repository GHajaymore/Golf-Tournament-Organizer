import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

import { loadEventState } from "@/lib/services/tournament";

/**
 * A LIVE BOARD RANKS PLAY, NOT PROGRESS.
 *
 * `StrokeStanding` was ordered on the raw total, and a raw total only compares
 * like with like. After the last card is in every player has played the same
 * holes and it is exactly right; DURING a round it is not, because a player
 * through nine has a smaller number than a player through eighteen for no
 * reason but arithmetic.
 *
 * Measured on the fixture 2026-09-18: four players all level par, ordered
 * 34, 56, 60, 63 by net — the 34 being NINE HOLES. So the club's live board,
 * the one on the screen in the clubhouse, named as leader whoever had played
 * least. It was deferred then because it moves the cut line and the
 * qualification bubble too; taken 2026-09-20 on Ajay's word, and that movement
 * is the point rather than a side effect — a cut taken mid-round off raw
 * totals cuts on how far round people are.
 *
 * THE FIXTURE IS FOUR PLAYERS ON THE SAME ROUND AT DIFFERENT STAGES, all
 * exactly level par, which is the one arrangement where the right answer is
 * unarguable: nobody is playing better than anybody, so nobody may be ranked
 * above them. Par 4 every hole, scratch handicaps, so nothing turns on an
 * allowance or on a stroke index.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-comparable-board";

const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);

/** Level par through `thru` holes, the rest of the card not yet written. */
const levelThrough = (thru: number) => PARS.map((p, i) => (i < thru ? p : null));

let eventId = "";
let stageId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
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
      name: `${TAG} medal`,
      status: "live",
      shape: "single",
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

  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      description: "Round 1",
      type: "Stroke Play Round",
      format: "Stroke Play",
      scoringBasis: "net",
      holes: 18,
    },
    select: { id: true },
  });
  stageId = stage.id;

  // Seeded in the order that used to come out as the ranking, so a stable
  // sort cannot accidentally produce the right answer.
  const field: [string, number][] = [
    ["ninth", 9],
    ["fourteenth", 14],
    ["fifteenth", 15],
    ["home", 18],
  ];
  for (const [who, thru] of field) {
    const player = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: `${TAG}-${who}@example.invalid`,
        handicap: 0,
        seed: field.findIndex(([n]) => n === who) + 1,
        status: "confirmed",
      },
      select: { id: true },
    });
    await prisma.scorecard.create({
      data: {
        eventId,
        stageId,
        playerId: player.id,
        strokes: JSON.stringify(levelThrough(thru)),
      },
    });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const who = (name: string) => name.replace(`${TAG} `, "");

describe("four players level par, at four different stages of the round", () => {
  it("ranks none of them above the others", async () => {
    const state = await loadEventState(eventId);
    const rows = state!.strokeStandings.filter((s) => s.ranked);
    expect(rows, "all four should hold a position").toHaveLength(4);

    // The fixture really is what it claims: four different hole counts, and
    // every one of them level par. A fixture where they are NOT level cannot
    // express the wrong answer, and every assertion below would be decoration.
    expect(rows.map((r) => r.thru).sort((a, b) => a - b)).toEqual([9, 14, 15, 18]);
    for (const r of rows) {
      expect(r.toPar, `${who(r.player.name)} is not level par`).toBe(0);
    }

    // Level par is level par, whatever o'clock it is.
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 1, 1]);
  });

  it("does not simply rank by holes played either", async () => {
    /**
     * THE CONTROL, and the one that matters: making totals comparable must not
     * become "everybody is equal". Somebody going better has to be in front,
     * and somebody going worse behind — both measured from the same nine
     * holes, so the only thing separating them is how they are playing.
     */
    const state = await loadEventState(eventId);
    const base = state!.strokeStandings.find((s) => who(s.player.name) === "ninth")!;
    expect(base.rank).toBe(1);

    const better = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} underpar`,
        email: `${TAG}-underpar@example.invalid`,
        handicap: 0,
        seed: 5,
        status: "confirmed",
      },
      select: { id: true },
    });
    // Three under through nine — the same nine holes the level player has.
    const card = levelThrough(9);
    for (let i = 0; i < 3; i += 1) card[i] = 3;
    await prisma.scorecard.create({
      data: { eventId, stageId, playerId: better.id, strokes: JSON.stringify(card) },
    });

    const after = await loadEventState(eventId);
    const rows = after!.strokeStandings.filter((s) => s.ranked);
    const lead = rows.filter((r) => r.rank === 1);
    expect(lead.map((r) => who(r.player.name))).toEqual(["underpar"]);
    expect(lead[0].toPar).toBe(-3);
    // And the four level players are still level with each other, one place
    // further down rather than scattered.
    const level = rows.filter((r) => r.toPar === 0);
    expect(level).toHaveLength(4);
    expect(new Set(level.map((r) => r.rank)).size, "the level four were separated").toBe(1);
  });
});
