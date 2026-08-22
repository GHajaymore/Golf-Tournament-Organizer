import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { loadEventState } from "@/lib/services/tournament";
import { freezeRoundHandicaps } from "@/lib/services/round-handicap";

/**
 * A round keeps the handicap it was played off.
 *
 * Asserted against Ajay's sentence, not against the code:
 *
 *   "If the round is complete and the member handicap changes on the Member
 *   screen, the closed round should not be affected and should keep the old
 *   handicap — but as soon as the member gets a new handicap assigned (or their
 *   GHIN changes), the next round should use the new one."
 *
 * Driven through `loadEventState` because that is the reader every board goes
 * through, and the defect this prevents is invisible in the pure rule: the
 * arithmetic was always right, it was simply given a number that had moved.
 *
 * The field is unrated on purpose — no tees, so a Course Handicap is the roster
 * number and the assertions are about WHICH number, not about slope.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/round-handicap.audit.test.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ROUND-HANDICAP";

let orgId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

/** A tournament with `handicaps.length` confirmed players and two rounds. */
async function tournament(name: string, handicaps: number[], allowance = 100) {
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${name}`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}-${Date.now()}`,
      format: "stroke",
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  const players = [];
  for (let i = 0; i < handicaps.length; i += 1) {
    players.push(
      await prisma.player.create({
        data: {
          eventId: event.id,
          // Invented names, never a real member's.
          name: `${TAG} Player ${i + 1}`,
          seed: i + 1,
          status: "confirmed",
          handicap: handicaps[i],
        },
      }),
    );
  }
  const stages = [];
  for (const position of [0, 1]) {
    stages.push(
      await prisma.stage.create({
        data: {
          eventId: event.id,
          position,
          type: "Stroke Play Round",
          format: "Stroke Play",
          scoringBasis: "net",
          holes: 18,
          handicapAllowance: allowance,
        },
      }),
    );
  }
  return { event, players, stages };
}

const card = (eventId: string, stageId: string, playerId: string, gross = 5) =>
  prisma.scorecard.create({
    data: { eventId, stageId, playerId, strokes: JSON.stringify(new Array(18).fill(gross)) },
  });

/** What the board would price this player's card at, in this round, right now. */
async function boardHandicap(eventId: string, stageId: string, playerId: string) {
  const state = await loadEventState(eventId);
  return state!.strokeHandicapFor(playerId, stageId);
}

describe("a played round keeps the handicap it was played off", () => {
  it("holds round one still while round two moves — Ajay's sentence, end to end", async () => {
    const { event, players, stages } = await tournament("sentence", [12]);
    const [p] = players;
    const [one, two] = stages;

    await card(event.id, one.id, p.id);
    await freezeRoundHandicaps(event.id, one.id);

    // The roster changes the way it changes in real life: he gets cut.
    await prisma.player.update({ where: { id: p.id }, data: { handicap: 9 } });

    expect(await boardHandicap(event.id, one.id, p.id)).toBe(12);
    expect(await boardHandicap(event.id, two.id, p.id)).toBe(9);
  });

  it("freezes the whole field, not only the player whose card arrived", async () => {
    // The last card in must not be priced differently from the first. This is
    // the case a per-card freeze gets wrong and nobody notices until two
    // players in the same round are scored off different days' handicaps.
    const { event, players, stages } = await tournament("field", [4, 20]);
    const [first, second] = players;

    await card(event.id, stages[0].id, first.id);
    await freezeRoundHandicaps(event.id, stages[0].id);
    await prisma.player.update({ where: { id: second.id }, data: { handicap: 6 } });

    expect(await boardHandicap(event.id, stages[0].id, second.id)).toBe(20);
  });

  it("is the same number the round was already using — freezing re-scores nothing", async () => {
    const { event, players, stages } = await tournament("no-change", [7]);
    const [p] = players;

    const before = await boardHandicap(event.id, stages[0].id, p.id);
    await card(event.id, stages[0].id, p.id);
    await freezeRoundHandicaps(event.id, stages[0].id);

    expect(await boardHandicap(event.id, stages[0].id, p.id)).toBe(before);
  });

  it("never rewrites a frozen value, however often it is called", async () => {
    const { event, players, stages } = await tournament("idempotent", [15]);
    const [p] = players;

    await card(event.id, stages[0].id, p.id);
    expect(await freezeRoundHandicaps(event.id, stages[0].id)).toBe(1);

    await prisma.player.update({ where: { id: p.id }, data: { handicap: 2 } });
    // Every later card in the round calls this again. It must find nothing to do.
    expect(await freezeRoundHandicaps(event.id, stages[0].id)).toBe(0);
    expect(await boardHandicap(event.id, stages[0].id, p.id)).toBe(15);
  });

  it("works at a field of ONE", async () => {
    // CLAUDE.md: field sizes start at one, because that is where the
    // off-by-ones live. Covered by the cases above, and asserted here so a
    // future change that assumes a field cannot be smaller than a fourball
    // fails on the smallest tournament rather than in the field.
    const { event, players, stages } = await tournament("solo", [18]);
    const rows = await freezeRoundHandicaps(event.id, stages[0].id);
    expect(rows).toBe(1);
    expect(await boardHandicap(event.id, stages[0].id, players[0].id)).toBe(18);
  });
});

describe("the committee's override", () => {
  it("applies to its own round and to no other", async () => {
    const { event, players, stages } = await tournament("scoped", [10]);
    const [p] = players;

    await prisma.roundHandicap.create({
      data: { eventId: event.id, stageId: stages[0].id, playerId: p.id, override: 4 },
    });

    expect(await boardHandicap(event.id, stages[0].id, p.id)).toBe(4);
    expect(await boardHandicap(event.id, stages[1].id, p.id)).toBe(10);
  });

  it("is not undone by a later roster edit", async () => {
    // Decision 4, 2026-08-22: an override is a deliberate decision, and a
    // roster edit must not silently reverse it.
    const { event, players, stages } = await tournament("deliberate", [10]);
    const [p] = players;

    await prisma.roundHandicap.create({
      data: { eventId: event.id, stageId: stages[0].id, playerId: p.id, override: 4 },
    });
    await prisma.player.update({ where: { id: p.id }, data: { handicap: 16 } });

    expect(await boardHandicap(event.id, stages[0].id, p.id)).toBe(4);
  });

  it("loses to what the round was actually scored against", async () => {
    // Decision 2. An organizer changing an override after cards are in has
    // changed their mind; a played round is not a thing anyone gets to change
    // their mind about.
    const { event, players, stages } = await tournament("too-late", [10]);
    const [p] = players;

    await card(event.id, stages[0].id, p.id);
    await freezeRoundHandicaps(event.id, stages[0].id);
    await prisma.roundHandicap.updateMany({
      where: { eventId: event.id, stageId: stages[0].id, playerId: p.id },
      data: { override: 4 },
    });

    expect(await boardHandicap(event.id, stages[0].id, p.id)).toBe(10);
  });

  it("is a COURSE handicap, so the round's allowance still applies on top", async () => {
    // Decision 6, and the defect the 2026-08-12 audit found: two screens
    // pricing one card off different units, five shots apart. An override says
    // what he plays off. It does not switch off the format's allowance.
    const { event, players, stages } = await tournament("allowance", [10], 50);
    const [p] = players;

    await prisma.roundHandicap.create({
      data: { eventId: event.id, stageId: stages[0].id, playerId: p.id, override: 8 },
    });

    expect(await boardHandicap(event.id, stages[0].id, p.id)).toBe(4);
  });

  it("survives the freeze it was frozen at", async () => {
    const { event, players, stages } = await tournament("frozen-override", [10]);
    const [p] = players;

    await prisma.roundHandicap.create({
      data: { eventId: event.id, stageId: stages[0].id, playerId: p.id, override: 6 },
    });
    await card(event.id, stages[0].id, p.id);
    await freezeRoundHandicaps(event.id, stages[0].id);
    await prisma.player.update({ where: { id: p.id }, data: { handicap: 20 } });

    // Frozen AT the override, not at the roster number underneath it.
    expect(await boardHandicap(event.id, stages[0].id, p.id)).toBe(6);
  });
});

describe("what counts as a round having been played", () => {
  it("a round nobody has entered a score in still takes a new roster handicap", async () => {
    const { event, players, stages } = await tournament("unplayed", [12]);
    const [p] = players;

    await prisma.player.update({ where: { id: p.id }, data: { handicap: 5 } });
    expect(await boardHandicap(event.id, stages[0].id, p.id)).toBe(5);
  });

  it("clearing the whole round releases the freeze; clearing one card does not", async () => {
    // A cleared round has not been played, and a frozen number protecting no
    // cards would refuse an organizer on a round that is visibly empty.
    const { event, players, stages } = await tournament("cleared", [12]);
    const [p] = players;

    await card(event.id, stages[0].id, p.id);
    await freezeRoundHandicaps(event.id, stages[0].id);
    await prisma.scorecard.deleteMany({ where: { eventId: event.id, stageId: stages[0].id } });
    await prisma.roundHandicap.updateMany({
      where: { eventId: event.id, stageId: stages[0].id },
      data: { frozen: null, frozenAt: null },
    });
    await prisma.player.update({ where: { id: p.id }, data: { handicap: 3 } });

    expect(await boardHandicap(event.id, stages[0].id, p.id)).toBe(3);
  });
});
