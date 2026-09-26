import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const { loadEventState } = await import("@/lib/services/tournament");

/**
 * A KNOCKOUT WITH NO QUALIFYING ROUND DRAWS EVERY ENTRANT.
 *
 * Found 2026-09-26 setting up a club knockout from scratch as a newcomer: a
 * bracket as the only round, eight members entered, and the defaults a
 * knockout is created with (top 2 per flight). The bracket screen read
 * "0 players qualify for the knockout round", and with two flights generated
 * the cut would have drawn four of the eight — chosen by seed order, because
 * nobody had played anything to be ranked on.
 *
 * A club match-play knockout puts every entrant in the draw. Qualification is
 * for a draw FED by a round — the control below is exactly that shape (a round
 * robin, then the bracket) and must still cut.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-STRAIGHTKO";

let organizationId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  organizationId = org.id;
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

/** Eight confirmed players in two flights, with the given rounds. */
async function knockout(name: string, types: string[]) {
  const event = await prisma.event.create({
    data: {
      organizationId,
      name: `${TAG} ${name}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}-${process.pid}`,
      shape: "knockout",
      format: "match",
      // The defaults `createEvent` gives a knockout, which are the ones that bit.
      qualifyMode: "perFlight",
      qualifyPerGroup: 2,
      bracketMode: "single",
    },
  });
  const flights = await Promise.all(
    [0, 1].map((i) => prisma.group.create({ data: { eventId: event.id, name: `Flight ${i + 1}`, position: i } })),
  );
  for (let i = 0; i < 8; i++) {
    await prisma.player.create({
      data: {
        eventId: event.id,
        name: `${TAG} player ${i + 1}`,
        email: `${TAG}-${name}-p${i + 1}@example.invalid`.toLowerCase().replace(/\s+/g, "-"),
        handicap: 5 + i * 3,
        handicapType: "18",
        status: "confirmed",
        seed: i + 1,
        groupId: flights[i % 2].id,
      },
    });
  }
  for (const [position, type] of types.entries()) {
    await prisma.stage.create({ data: { eventId: event.id, position, type, format: "Match Play", holes: 18 } });
  }
  return event.id;
}

const drawnIn = (state: NonNullable<Awaited<ReturnType<typeof loadEventState>>>) =>
  new Set(
    state.brackets.winners.rounds[0].matches.flatMap((m) =>
      [m.a, m.b].map((slot) => slot.playerId).filter((id): id is string => !!id),
    ),
  );

describe("a knockout", () => {
  it("with no qualifying round puts all eight entrants in the draw", async () => {
    const eventId = await knockout("straight", ["Bracket Stage"]);
    const state = await loadEventState(eventId);
    expect(state!.qualifiers, "entrants left out of the draw").toHaveLength(8);
    expect(drawnIn(state!).size, "players in the first round of the bracket").toBe(8);
  });

  it("fed by a round robin still qualifies into it — top 2 per flight (control)", async () => {
    const eventId = await knockout("fed", ["Round Robin", "Bracket Stage"]);
    const state = await loadEventState(eventId);
    expect(state!.qualifiers).toHaveLength(4);
  });
});
