import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "@/lib/services/tournament";
import { resultLinesFor } from "@/lib/services/tournament-result";

/**
 * A SIDE STILL ON THE COURSE HAS NOT LOST (2026-10-08).
 *
 * The tournament result named a team round's winner from every side that had
 * BEGUN: a scramble whose Eagles were in on 66 and whose Hackers were nine
 * holes round read "Eagles · 66 gross" and counted the round settled, with the
 * Hackers free to come home in 30. The stroke path waited for unfinished cards
 * since this morning; the sides path did not. And a round all in is
 * unofficial until the committee closes it — the public board's own words.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SIDEOUT";
const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
let eventId = "";
let stageId = "";
let hackersCard = "";

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
      name: `${TAG} scramble`,
      status: "live",
      sideStyle: "teams",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  eventId = event.id;
  stageId = (
    await prisma.stage.create({
      data: { eventId, position: 0, type: "Stroke Play Round", format: "Texas Scramble", holes: 18, scoringBasis: "gross" },
    })
  ).id;
  const sides: Array<[string, (number | null)[]]> = [
    ["Eagles", PARS.map((p, i) => (i < 5 ? p - 1 : p))],
    ["Hackers", PARS.map((p, i) => (i < 9 ? p : null))],
  ];
  for (const [i, [name, strokes]] of sides.entries()) {
    const team = await prisma.team.create({ data: { eventId, stageId, name: `${TAG} ${name}`, seed: i + 1 } });
    for (let m = 0; m < 2; m++) {
      const p = await prisma.player.create({
        data: { eventId, name: `${TAG} ${name} ${m}`, email: `${TAG}.${name}${m}@example.invalid`.toLowerCase(), seed: i * 2 + m + 1, status: "confirmed" },
      });
      await prisma.teamMember.create({ data: { teamId: team.id, playerId: p.id, position: m } });
    }
    const card = await prisma.teamScorecard.create({
      data: { eventId, stageId, teamId: team.id, playerId: "", strokes: JSON.stringify(strokes) },
    });
    if (name === "Hackers") hackersCard = card.id;
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const line = async () => {
  const state = await loadEventState(eventId);
  return (await resultLinesFor(state!))[0];
};

describe("a team round with a side still out", () => {
  it("has no winner yet, and says a side is still on the course", async () => {
    const l = await line();
    expect(l.result, "named a winner over a side nine holes round").not.toMatch(/Eagles/);
    expect(l.result).toMatch(/1 side still on the course/);
    expect(l.settled).toBe(false);
  });

  it("names the winner once every side is in — unofficial until the round is closed", async () => {
    await prisma.teamScorecard.update({ where: { id: hackersCard }, data: { strokes: JSON.stringify(PARS) } });
    const l = await line();
    expect(l.result).toMatch(/Eagles/);
    expect(l.unofficial).toBe(true);
    expect(l.settled).toBe(false);

    await prisma.stage.update({ where: { id: stageId }, data: { closedAt: new Date() } });
    const closed = await line();
    expect(closed.settled).toBe(true);
    expect(closed.result).not.toMatch(/unofficial/);
  });
});
