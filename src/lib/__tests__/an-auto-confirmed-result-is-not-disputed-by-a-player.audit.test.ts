import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A RESULT THAT HAS AUTO-CONFIRMED IS CONFIRMED, AND A PLAYER ASKS THE COMMITTEE TO REOPEN IT.
 *
 * Where players approve their own results (`scoreApproval: "players"`), a match
 * left pending for a day is confirmed without anybody pressing anything
 * (`effectiveScoreStatus`). Its COLUMN still reads "pending". `disputeMatch`
 * refused a player only when the column said "confirmed" — or "auto-confirmed",
 * which is never stored — so the player who lost could dispute a final result
 * days later and take it off the board. `clearMatch`, one door along, has read
 * the effective status since the same lesson was learned there.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-AUTODISPUTE";
const B_EMAIL = `${TAG}-b@example.invalid`.toLowerCase();

let session: Record<string, string> | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { disputeMatch } = await import("@/app/actions/tournament");

const ids = { event: "", stage: "", group: "", a: "", b: "" };

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const A_WON = JSON.stringify([...new Array(10).fill("A"), ...new Array(8).fill("H")]);
const aMatch = async (scoredAt: Date) =>
  (
    await prisma.match.create({
      data: { eventId: ids.event, stageId: ids.stage, groupId: ids.group, round: 1, playerAId: ids.a, playerBId: ids.b, holes: A_WON, scoreStatus: "pending", scoredAt },
    })
  ).id;

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} matchplay`,
      status: "live",
      format: "match",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      scoreEntryBy: "players",
      // The players approve: a result nobody disputes for a day confirms itself.
      scoreApproval: "players",
    },
  });
  ids.event = event.id;
  ids.group = (await prisma.group.create({ data: { eventId: event.id, name: `${TAG} flight`, position: 0 } })).id;
  ids.stage = (await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Round Robin", format: "Match Play", holes: 18 } })).id;
  for (const [k, who, email] of [["a", "Ainsley", `${TAG}-a@example.invalid`], ["b", "Brody", B_EMAIL]] as const) {
    ids[k] = (await prisma.player.create({ data: { eventId: event.id, groupId: ids.group, name: `${TAG} ${who}`, email, status: "confirmed", seed: 1 } })).id;
  }
  // Brody, who lost.
  session = { eventId: event.id, email: B_EMAIL, viewRole: "player", name: `${TAG} Brody`, role: "player", userId: "", accountId: "" };
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the player who lost, disputing a result", () => {
  it("is refused once it has auto-confirmed, and the result stands", async () => {
    const id = await aMatch(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
    const res = await disputeMatch(id);
    expect(res.ok, "a result two days unchallenged is confirmed").toBe(false);
    expect(res.error).toMatch(/confirmed/);
    expect((await prisma.match.findUniqueOrThrow({ where: { id } })).scoreStatus).toBe("pending");
  });

  it("CONTROL: may still dispute it an hour after it went in", async () => {
    const id = await aMatch(new Date(Date.now() - 60 * 60 * 1000));
    expect((await disputeMatch(id)).ok).toBe(true);
    expect((await prisma.match.findUniqueOrThrow({ where: { id } })).scoreStatus).toBe("disputed");
  });
});
