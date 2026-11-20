import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "@/lib/services/tournament";
import { resultLinesFor } from "@/lib/services/tournament-result";

/**
 * ARRANGED IS NOT HAPPENED (CLAUDE.md; Rules of Golf 3.2): a match drawn and not
 * yet played is not a halved match.
 *
 * A match is created with `holes = "[]"`. `resolveMatch([])` counts no holes
 * left (`remaining` 0), so it says `complete` with a "halved" winner, and the
 * result line, which filtered on `.complete`, read "halved" for a fixture nobody
 * had begun. `matchIsOver` is the question that also asks whether a hole was
 * played. The line is shown on /me/board.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-UNPLAYED";
let eventId = "";
let matchId = "";

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
        organizationId: org.id, name: `${TAG} match`, status: "live", dates: "", course: "Home", city: "", address: "",
        regDeadline: "", shareToken: `${TAG}-${process.pid}`,
        customPars: JSON.stringify(new Array(18).fill(4)),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    })
  ).id;
  const stageId = (
    await prisma.stage.create({ data: { eventId, position: 0, type: "Round Robin", format: "Match Play", holes: 18, scoringBasis: "net" } })
  ).id;
  const ann = await prisma.player.create({ data: { eventId, name: `${TAG} Ann`, email: "ann@example.invalid", seed: 1, status: "confirmed" } });
  const bob = await prisma.player.create({ data: { eventId, name: `${TAG} Bob`, email: "bob@example.invalid", seed: 2, status: "confirmed" } });
  const group = await prisma.group.create({ data: { eventId, stageId, name: "A", position: 0 } });
  matchId = (
    await prisma.match.create({
      data: { eventId, stageId, groupId: group.id, round: 1, playerAId: ann.id, playerBId: bob.id },
    })
  ).id;
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const line = async () => (await resultLinesFor((await loadEventState(eventId))!))[0];

describe("a match that has been arranged and not played", () => {
  it("is not reported as halved", async () => {
    const l = await line();
    expect(l.result).not.toMatch(/halved/i);
    expect(l.settled).toBe(false);
  });

  it("CONTROL: a match actually halved all the way round is", async () => {
    await prisma.match.update({ where: { id: matchId }, data: { holes: JSON.stringify(new Array(18).fill("H")) } });
    expect((await line()).result).toMatch(/halved/i);
  });
});
