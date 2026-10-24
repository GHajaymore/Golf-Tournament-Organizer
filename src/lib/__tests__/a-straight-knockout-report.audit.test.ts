import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

// The board is `unstable_cache`d, which throws outside a Next request.
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { eventReport } = await import("@/lib/services/event-report");

/**
 * THE REPORT OF A STRAIGHT KNOCKOUT, PART-PLAYED.
 *
 * Found 2026-10-23 on a club knockout of 129 kept by "tap who won", read as a
 * golf professional would read the report a club sends its members:
 *
 *   "The qualifying round"   a table of all 129 entrants with dashes — there
 *                            was no qualifying round; the draw IS the result
 *   "In numbers: 0 birdies"  over 65 ties nobody wrote a hole score for
 *   "beat Bob 19th"          a tie won at the 19th, said as if 19th were a margin
 *                            (the player's own screen already said "at the 19th")
 *   "beat Cat W/O"           a walkover, and "beat Dee Conceded"
 *   and nothing at all about how far the knockout had got.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */
const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-KOREPORT";
let eventId = "";
const ids: string[] = [];

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} knockout`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      shape: "knockout",
      format: "match",
      qualifyMode: "perFlight",
      qualifyPerGroup: 2,
      bracketMode: "single",
      status: "live",
    },
  });
  eventId = event.id;
  await prisma.stage.create({ data: { eventId, position: 0, type: "Bracket Stage", format: "Match Play", holes: 18 } });
  // Five: a draw of 8, seeds 1-3 with byes, 4 v 5 the one first-round tie.
  for (let i = 0; i < 5; i++) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} P${i + 1}`, email: `${TAG.toLowerCase()}-p${i + 1}@example.invalid`, handicap: 4 + i * 3, seed: i + 1, status: "confirmed" },
    });
    ids.push(p.id);
  }
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the report of a straight knockout, part-played", () => {
  it("prints the draw in a golfer's words, says how far it has got, and invents nothing", async () => {
    // 4 v 5 at the 19th; then seed 1 v that winner, conceded.
    await prisma.bracketWinner.create({ data: { eventId, key: "winners-0-1", winnerId: ids[4], result: "19th" } });
    await prisma.bracketWinner.create({ data: { eventId, key: "winners-1-0", winnerId: ids[0], result: "Conceded" } });
    const r = await eventReport(eventId, { kind: "public" });
    expect(r).not.toBeNull();
    const ties = r!.draw.flatMap((d) => d.ties);
    // CONTROL: the two results are in the draw at all.
    expect(ties).toHaveLength(2);
    expect(ties.some((t) => t.endsWith(`${TAG} P5 beat ${TAG} P4 at the 19th`)), ties.join(" | ")).toBe(true);
    expect(ties.some((t) => t.endsWith(`${TAG} P1 beat ${TAG} P5 by concession`)), ties.join(" | ")).toBe(true);
    // No qualifying round was played, so there is no table of one.
    expect(r!.rows).toEqual([]);
    // No hole was scored, so nothing is counted off holes.
    expect(r!.numbers).toEqual([]);
    // Not finished: nobody named, and how far it has got, in the dashboard's own count.
    expect(r!.first).toBeNull();
    expect(r!.facts).toEqual(expect.arrayContaining([{ label: "Ties played", value: "2 of 4" }, { label: "Still in", value: "3 of 5" }]));
  });
});
