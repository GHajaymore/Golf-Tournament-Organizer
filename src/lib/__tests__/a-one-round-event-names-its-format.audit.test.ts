import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "@/lib/services/tournament";
import { meFor } from "@/lib/services/me";

/**
 * A ONE-ROUND EVENT CALLS ITS ROUND BY ITS FORMAT (2026-10-10).
 *
 * Walked as a member of a society on the $49 plan entering its Saturday
 * Stableford: Today read "You're in · Stroke Play Round". That is the stage's
 * internal TYPE, the same for a Stableford, a scramble and a medal; the number
 * that names a round in a longer event is blank when there is only one. The
 * format is what the member is about to play.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ONE-ROUND-NAME";
const lower = TAG.toLowerCase();

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function eventWith(name: string, rounds: Array<{ type: string; format: string }>) {
  const org = await prisma.organization.create({ data: { name: `${TAG} ${name} club`, kind: "society" }, select: { id: true } });
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} ${name}`,
      organizationId: org.id,
      status: "live",
      format: "stroke",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
    select: { id: true },
  });
  for (const [i, r] of rounds.entries()) {
    await prisma.stage.create({
      data: {
        eventId: ev.id,
        type: r.type,
        format: r.format,
        holes: 18,
        scoringBasis: "net",
        position: i,
        // The blurb every round is created with — a sentence, so `roundKicker` skips it.
        description: "The field plays the round and returns cards; standings come from the scores.",
      },
    });
  }
  const email = `${lower}-${name}@example.invalid`;
  await prisma.player.create({ data: { eventId: ev.id, name: `${TAG} ${name} player`, email, seed: 1, status: "confirmed", handicap: 10 } });
  return { id: ev.id, email };
}

const roundOf = async (e: { id: string; email: string }) => (await meFor((await loadEventState(e.id))!, e.email)).round;

beforeAll(cleanup);
afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("what a member's Today calls the round", () => {
  it("names a one-round Stableford by its format, not 'Stroke Play Round'", async () => {
    const r = await roundOf(await eventWith("stableford", [{ type: "Stroke Play Round", format: "Stableford" }]));
    expect(r?.name).toBe("Stableford");
    expect(r?.label).toBe("Stableford");
  });

  it("and a one-round medal by ITS format", async () => {
    const r = await roundOf(await eventWith("medal", [{ type: "Stroke Play Round", format: "Stroke Play" }]));
    expect(r?.name).toBe("Stroke Play");
  });

  it("CONTROL: in a two-round event the number still names it", async () => {
    const r = await roundOf(
      await eventWith("two", [
        { type: "Stroke Play Round", format: "Stableford" },
        { type: "Stroke Play Round", format: "Stableford" },
      ]),
    );
    expect(r?.name).toBe("Round 1");
  });
});
