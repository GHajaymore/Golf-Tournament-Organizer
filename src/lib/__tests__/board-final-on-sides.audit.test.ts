import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

// The board is `unstable_cache`d in production. Identity here, so each read
// reflects the rows as they stand rather than a minute ago.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { liveBoard } from "@/lib/services/live-board";

/**
 * A FINISHED SIDE ROUND READS FINAL ON THE PUBLIC BOARD (2026-10-08).
 *
 * Walked as the tournament grid's best-ball: both sides round, the dashboard
 * saying "Sides in 2/2 · 100% returned", and `/live` — the page a club sends
 * its members — reading "LIVE · updated just now" for ever. Its "Final" asked
 * every PLAYER's row how far it had got, and a side round keeps its cards on
 * the side (`TeamScorecard`), so every player row read thru 0. It asks the
 * round's own unit now, the one `boardProgress` counts for every other screen.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SIDESFINAL";
const PARS = new Array(18).fill(4);
let eventId = "";
let stageId = "";
const sides: { id: string; members: string[] }[] = [];

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} best ball`,
      status: "live",
      shape: "single",
      sideStyle: "pairs",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      leaderboardVisibility: "public",
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  eventId = event.id;
  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Best Ball", holes: 18, scoringBasis: "gross" },
  });
  stageId = stage.id;
  for (const [t, names] of [["Ann", "Bea"], ["Cat", "Dot"]].entries()) {
    const team = await prisma.team.create({ data: { id: `${TAG}-t${t}-${process.pid}`, eventId, stageId, name: names.join(" & "), seed: t + 1 } });
    const members: string[] = [];
    for (const [pos, n] of names.entries()) {
      const p = await prisma.player.create({
        data: { eventId, name: `${TAG} ${n}`, email: `${TAG}.${n}@example.invalid`.toLowerCase(), seed: t * 2 + pos + 1, status: "confirmed" },
      });
      await prisma.teamMember.create({ data: { id: `${TAG}-m${t}${pos}-${process.pid}`, teamId: team.id, playerId: p.id, position: pos } });
      members.push(p.id);
    }
    sides.push({ id: team.id, members });
  }
});

beforeEach(async () => {
  await prisma.teamScorecard.deleteMany({ where: { eventId } });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const cardFor = (side: number, member: number, holes = 18) =>
  prisma.teamScorecard.create({
    data: {
      eventId,
      stageId,
      teamId: sides[side].id,
      playerId: sides[side].members[member],
      strokes: JSON.stringify(PARS.map((p, i) => (i < holes ? p : null))),
    },
  });

const board = async () => {
  const b = await liveBoard(eventId);
  expect(b, "the public board did not load").not.toBeNull();
  return b!;
};

describe("a best-ball round on the public board", () => {
  it("is Final once every side is round", async () => {
    for (const s of [0, 1]) for (const m of [0, 1]) await cardFor(s, m);
    expect((await board()).allIn, "two complete sides read LIVE").toBe(true);
  });

  it("is Live while a side is still out — the control", async () => {
    await cardFor(0, 0);
    await cardFor(0, 1);
    await cardFor(1, 0, 12);
    await cardFor(1, 1, 12);
    expect((await board()).allIn, "a side on the 13th is not finished").toBe(false);
  });
});
