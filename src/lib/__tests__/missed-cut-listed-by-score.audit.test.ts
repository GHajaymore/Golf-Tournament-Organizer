import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState, standingRows } from "../services/tournament";

/**
 * THE MISSED CUT IS LISTED BY SCORE, beneath the field that made it.
 *
 * A finished championship's public board showed its missed-cut block in
 * SIGN-UP order: +20, +15, +19, +23, +15, +14 … (the seeded Club Championship,
 * 2026-09-26). Every results sheet lists the players who missed the cut in
 * score order, and a golfer reading down that block reads it as nonsense.
 *
 * Nothing here is ranked — a player who missed a closed round holds no place
 * (Ajay's rule, #577/#643) and still does not. Only the ORDER of that block
 * changes, and it reads the same statistic as the board's own "Ranked by".
 * Players with no score at all stay last, in the order they entered.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-MC-ORDER";
const PARS = new Array(18).fill(4);
/** A card of 72 + n strokes: `over` extra strokes on the first holes. */
const card = (over: number) => PARS.map((par, i) => par + (i < over ? 1 : 0));
let eventId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  eventId = (
    await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${TAG} championship`,
        dates: "",
        course: "Home",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-${process.pid}`,
        format: "stroke",
        customPars: JSON.stringify(PARS),
        customYards: JSON.stringify(new Array(18).fill(400)),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    })
  ).id;
  const r1 = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross" },
  });
  const r2 = await prisma.stage.create({
    data: {
      eventId, position: 1, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross",
      closedAt: new Date(),
    },
  });
  // Sign-up order deliberately NOT score order among the three who missed.
  const field: [string, number | null, number | null][] = [
    ["finisher", 1, 1],
    ["mc-plus10", 10, null],
    ["mc-plus2", 2, null],
    ["mc-plus6", 6, null],
    ["never-started", null, null],
  ];
  for (const [i, [who, one, two]] of field.entries()) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: `${TAG}.${who}@example.invalid`.toLowerCase(), seed: i + 1, status: "confirmed", handicap: 0 },
    });
    if (one !== null) await prisma.scorecard.create({ data: { eventId, stageId: r1.id, playerId: p.id, strokes: JSON.stringify(card(one)) } });
    if (two !== null) await prisma.scorecard.create({ data: { eventId, stageId: r2.id, playerId: p.id, strokes: JSON.stringify(card(two)) } });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const order = async () => (standingRows((await loadEventState(eventId))!) as { name: string; ranked?: boolean }[]).map((r) => r.name.replace(`${TAG} `, ""));

describe("the board's order below the finishers", () => {
  it("lists the players who missed the cut by score, best first", async () => {
    expect(await order()).toEqual(["finisher", "mc-plus2", "mc-plus6", "mc-plus10", "never-started"]);
  });

  it("still gives none of them a place (the rule this must not bend)", async () => {
    const rows = standingRows((await loadEventState(eventId))!) as { name: string; ranked?: boolean; rank?: number }[];
    const missed = rows.filter((r) => r.name.includes("mc-"));
    expect(missed).toHaveLength(3);
    for (const r of missed) expect(r.ranked, `${r.name} was given a place`).toBe(false);
  });
});
