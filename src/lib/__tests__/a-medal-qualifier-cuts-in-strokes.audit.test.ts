import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "@/lib/services/tournament";
import { qualifyingCutoffText } from "@/lib/domain/cut";

/**
 * A MEDAL QUALIFIER'S LINE IS IN STROKES (2026-10-10).
 *
 * Walked on a club's Matchplay Championship — 120 in a gross medal, the top 64
 * into the knockout: the dashboard read "Cutoff line ≈ 0 pts" and the bracket's
 * qualification table listed the field in handicap order on 0 points each,
 * beside a draw correctly seeded off the cards. `overallCutoff` is match points,
 * which a medal never fills.
 *
 * Six players on a par 72 — 70, 72, 74, 76, 78, 80 — top 4 overall into a
 * bracket: the fourth qualifier is on 76, so the line is +4. The control is
 * the unit: the same field, with no cards in yet, has no line at all.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-MEDAL-QUALIFIER";
const lower = TAG.toLowerCase();
const PARS = new Array(18).fill(4);
const card = (total: number) => {
  const c = [...PARS];
  let diff = total - 72;
  for (let i = 0; diff < 0; i += 1, diff += 1) c[i] = 3;
  for (let i = 17; diff > 0; i -= 1, diff -= 1) c[i] = 5;
  return c;
};

let eventId = "";
let r1 = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  eventId = (
    await prisma.event.create({
      data: {
        name: `${TAG} matchplay`,
        organizationId: org.id,
        status: "live",
        format: "stroke",
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-share`,
        qualifyMode: "overall",
        qualifyOverall: 4,
        customPars: JSON.stringify(PARS),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
      select: { id: true },
    })
  ).id;
  r1 = (
    await prisma.stage.create({
      data: { eventId, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross", position: 0, description: "Qualifier" },
      select: { id: true },
    })
  ).id;
  await prisma.stage.create({
    data: { eventId, type: "Bracket Stage", format: "Match Play", holes: 18, scoringBasis: "gross", position: 1, description: "Knockout" },
  });
  for (let i = 0; i < 6; i += 1) {
    await prisma.player.create({
      data: { eventId, name: `${TAG} P${i}`, email: `${lower}-p${i}@example.invalid`, seed: i + 1, status: "confirmed", handicap: 0 },
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

describe("the qualifying line of a medal qualifier", () => {
  it("CONTROL: with no cards in, there is no line", async () => {
    const state = (await loadEventState(eventId))!;
    expect(state.qualifiesOnCards).toBe(true);
    expect(state.qualifyingCutoff).toBeNull();
  });

  it("is the fourth qualifier's score, in strokes to par — not 0 pts", async () => {
    const players = await prisma.player.findMany({ where: { eventId }, orderBy: { seed: "asc" }, select: { id: true } });
    for (const [i, total] of [70, 72, 74, 76, 78, 80].entries()) {
      await prisma.scorecard.create({ data: { eventId, stageId: r1, playerId: players[i].id, strokes: JSON.stringify(card(total)), status: "approved" } });
    }
    const state = (await loadEventState(eventId))!;
    expect(state.advancingIds.size).toBe(4);
    expect(state.qualifyingCutoff).toEqual({ kind: "toPar", value: 4 });
    expect(qualifyingCutoffText(state.qualifyingCutoff, String)).toBe("+4");
  });
});

describe("qualifyingCutoffText", () => {
  it("words each unit the way a board does", () => {
    expect(qualifyingCutoffText({ kind: "toPar", value: 0 }, String)).toBe("E");
    expect(qualifyingCutoffText({ kind: "toPar", value: -3 }, String)).toBe("-3");
    expect(qualifyingCutoffText({ kind: "stableford", value: 31 }, String)).toBe("31 pts");
    expect(qualifyingCutoffText({ kind: "pts", value: 10.5 }, String)).toBe("10.5 pts");
    expect(qualifyingCutoffText(null, String)).toBe("—");
  });
});
