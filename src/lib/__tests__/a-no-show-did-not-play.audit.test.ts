import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState, standingRows } from "@/lib/services/tournament";
import { meFor } from "@/lib/services/me";

/**
 * A NO-SHOW ON A CLOSED ROUND DID NOT PLAY IT (2026-10-08, grid cell T48).
 *
 * Ann and Bea played; Dan was entered and never teed off; the committee
 * closed the round. `missedRound` was only set for a player with holes
 * somewhere, so Dan's row read "not started" under FINAL, his Today promised
 * "Your score appears once the first hole goes in", and My card offered him an
 * empty pad the server refuses on the first save.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-NOSHOW";
const PARS = new Array(18).fill(4);
const at = (n: string) => `${TAG}.${n}@example.invalid`.toLowerCase();
let eventId = "";
let stageId = "";
const ids: Record<string, string> = {};

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
        name: `${TAG} medal`,
        status: "live",
        dates: "",
        course: "Home",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-${process.pid}`,
        customPars: JSON.stringify(PARS),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    })
  ).id;
  stageId = (
    await prisma.stage.create({
      data: { eventId, position: 0, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross", closedAt: new Date() },
    })
  ).id;
  for (const [i, n] of ["Ann", "Bea", "Dan"].entries()) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${n}`, email: at(n), seed: i + 1, status: "confirmed" },
    });
    ids[n] = p.id;
    if (n !== "Dan") {
      await prisma.scorecard.create({ data: { eventId, stageId, playerId: p.id, strokes: JSON.stringify(PARS), status: "approved" } });
    }
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a player who never teed off in a closed round", () => {
  it("is on the board as not having played it, beneath the field", async () => {
    const rows = standingRows((await loadEventState(eventId))!);
    const dan = rows.find((r) => r.id === ids.Dan)!;
    expect(dan.ranked).toBe(false);
    expect(dan.missedRound, "the board can only say 'not started'").toBe("Round 1");
    expect(rows[rows.length - 1].id, "a no-show sorted above the field").toBe(ids.Dan);
  });

  it("is told the round is closed and is not offered a card", async () => {
    const me = await meFor((await loadEventState(eventId))!, at("Dan"));
    expect(me.round?.closedWithout).toBe("Round 1");
    expect(me.round?.ownCard).toBe(false);
  });

  it("while the round is open he is simply not started — the control", async () => {
    await prisma.stage.update({ where: { id: stageId }, data: { closedAt: null } });
    try {
      const dan = standingRows((await loadEventState(eventId))!).find((r) => r.id === ids.Dan)!;
      expect(dan.missedRound).toBe("");
      expect((await meFor((await loadEventState(eventId))!, at("Dan"))).round?.ownCard).toBe(true);
    } finally {
      await prisma.stage.update({ where: { id: stageId }, data: { closedAt: new Date() } });
    }
  });
});

describe("the same no-show on a Stableford round (grid cell T49)", () => {
  /**
   * A points board deliberately keeps a missed-week player RANKED — the points
   * they did not score already cost them — so the missed-round rule skipped
   * Stableford, and Dan read "not started" under FINAL. The words are named
   * now; the ranking rule is untouched.
   */
  it("names the round he did not play, and still ranks the players who did", async () => {
    await prisma.stage.update({ where: { id: stageId }, data: { format: "Stableford", scoringBasis: "net" } });
    try {
      const rows = standingRows((await loadEventState(eventId))!);
      expect(rows.find((r) => r.id === ids.Dan)!.missedRound).toBe("Round 1");
      for (const n of ["Ann", "Bea"]) {
        const r = rows.find((x) => x.id === ids[n])!;
        expect(r.ranked, `${n} lost a place`).toBe(true);
        expect(r.missedRound).toBe("");
      }
    } finally {
      await prisma.stage.update({ where: { id: stageId }, data: { format: "Individual Stroke Play", scoringBasis: "gross" } });
    }
  });
});
