import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "@/lib/services/tournament";
import { resultLinesFor } from "@/lib/services/tournament-result";

/**
 * A TEAM MATCH'S RESULT LINE NAMES ITS SIDES (found by the engineer of #1027).
 *
 * A four-ball or foursomes match leaves `playerAId` / `playerBId` empty and
 * carries `teamAId` / `teamBId`. The result line (shown on /me/board) read the
 * player columns and so said "Side A beat Side B". It now names the sides the
 * way the match card does (`matchCardFor`): the team's own name, which for a
 * pair is the pair's names.
 *
 * A round of several team matches is counted per SIDE, so a round robin of
 * pairs reads "N wins" for a named pair rather than "Every match halved".
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-TEAMLINE";
let eventId = "";
const stageIds: Record<string, string> = {};
const teams: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const won = (side: "A" | "B", n = 10) => JSON.stringify([...new Array(n).fill(side), ...new Array(18 - n).fill(null)]);

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
  // Two rounds: a four-ball (one match) and a foursomes (two matches).
  for (const [i, format] of ["Four-Ball", "Foursomes"].entries()) {
    stageIds[format] = (
      await prisma.stage.create({ data: { eventId, position: i, type: "Round Robin", format, holes: 18, scoringBasis: "net" } })
    ).id;
  }
  const names: Array<[string, string]> = [
    ["Four-Ball", "Ann & Bob"], ["Four-Ball", "Cat & Dot"],
    ["Foursomes", "Eve & Fay"], ["Foursomes", "Gus & Hal"], ["Foursomes", "Ivy & Jon"],
  ];
  for (const [i, [format, name]] of names.entries()) {
    teams[name] = (await prisma.team.create({ data: { eventId, stageId: stageIds[format], name, seed: i + 1 } })).id;
  }
  const group = (format: string) => prisma.group.create({ data: { eventId, stageId: stageIds[format], isCarrier: true, name: format, position: 9 } });
  const match = async (format: string, a: string, b: string, holes: string) => {
    const g = await group(format);
    return prisma.match.create({
      data: { eventId, stageId: stageIds[format], groupId: g.id, round: 1, playerAId: "", playerBId: "", teamAId: teams[a], teamBId: teams[b], holes },
    });
  };
  await match("Four-Ball", "Ann & Bob", "Cat & Dot", won("B"));
  // Foursomes: Eve & Fay beat Gus & Hal; Eve & Fay beat Ivy & Jon.
  await match("Foursomes", "Eve & Fay", "Gus & Hal", won("A"));
  await match("Foursomes", "Ivy & Jon", "Eve & Fay", won("B"));
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const lines = async () => resultLinesFor((await loadEventState(eventId))!);

describe("a team match's result line", () => {
  it("names the pair that won and the pair that lost on a four-ball match, with the margin", async () => {
    const l = (await lines())[0];
    expect(l.result).toContain("Cat & Dot beat Ann & Bob");
    expect(l.result).not.toMatch(/Side [AB]/);
    expect(l.settled).toBe(true);
  });

  it("counts a foursomes round per pair, not per (empty) player column", async () => {
    const l = (await lines())[1];
    expect(l.result).toContain("Eve & Fay");
    expect(l.result).not.toMatch(/Side [AB]|halved/i);
  });

  it("CONTROL: a match whose teams are gone still reads, as it always did, 'Side A'/'Side B'", async () => {
    await prisma.match.updateMany({
      where: { stageId: stageIds["Four-Ball"] },
      data: { teamAId: "gone-a", teamBId: "gone-b" },
    });
    expect((await lines())[0].result).toMatch(/Side B beat Side A/);
  });
});
