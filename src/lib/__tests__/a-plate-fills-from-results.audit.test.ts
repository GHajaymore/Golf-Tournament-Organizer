import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A PLATE FILLS FROM RESULTS, ON REAL ROWS.
 *
 * #573 proved the shape through the engines and #574 fixed the screen that
 * names the second draw. Neither ran a `plate` tournament through
 * `loadEventState`, which is where the mode is actually resolved against
 * stored rows — and every bracket the app has been walked with until now is
 * `single` or `split`.
 *
 * The distinction is the whole point of the mode and it only exists once
 * there are results:
 *
 *   split  seeds the second bracket from the QUALIFYING RANK. Its field is
 *          known before a ball is struck.
 *   plate  fills it from the FIRST ROUND'S LOSERS. Its field is empty until
 *          somebody loses, and grows as results come in.
 *
 * So the fixture records the qualifying round and asks the service what the
 * two draws hold, rather than asking the pure function what it would return.
 * A stored bracket result is a `BracketWinner` row keyed by SLOT — no Match,
 * no Scorecard — which is the fourth result table CLAUDE.md sets out, and the
 * keys used here are read back off the app's OWN draw rather than rebuilt from
 * `seedOrder`, so this cannot drift from the pairing the organizer sees.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { loadEventState } from "@/lib/services/tournament";
import { drawBrackets } from "@/lib/domain/bracket";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-PLATE";
const HOLES = 18;

let eventId = "";
const playerIds: string[] = [];

/** A card the named side wins by `by` holes with `left` to play. */
const card = (winner: "A" | "B", by: number, left: number) =>
  JSON.stringify([
    ...Array.from({ length: HOLES - left }, (_, i) => (i < by ? winner : "H")),
    ...Array.from({ length: left }, () => null),
  ]);

beforeAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });

  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });

  const ev = await prisma.event.create({
    data: {
      name: `${TAG} plate championship`,
      organizationId: org.id,
      status: "live",
      shape: "knockout",
      format: "match",
      sideStyle: "individual",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-share`,
      // THE MODE UNDER TEST. Everything else here exists to give it results
      // to fill from.
      bracketMode: "plate",
      qualifyMode: "overall",
      // Everybody goes through: the qualifying MATCH is what separates them,
      // which is the shape a club means by "winner up, loser across".
      qualifyOverall: 16,
      customStrokeIndex: JSON.stringify(Array.from({ length: HOLES }, (_, i) => i + 1)),
    },
    select: { id: true },
  });
  eventId = ev.id;

  const flights = [];
  for (let i = 0; i < 4; i += 1) {
    flights.push(
      await prisma.group.create({
        data: { eventId, name: `${TAG} Flight ${i + 1}`, position: i },
        select: { id: true },
      }),
    );
  }

  for (let i = 0; i < 16; i += 1) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} P${String(i + 1).padStart(2, "0")}`,
        email: `${TAG.toLowerCase()}-p${i + 1}@example.invalid`,
        seed: i + 1,
        status: "confirmed",
        handicap: i % 8,
        groupId: flights[i % 4].id,
      },
      select: { id: true },
    });
    playerIds.push(p.id);
  }

  // TWO qualifying rounds, the second carrying the first's points forward —
  // the customization a club uses when a league runs over several nights.
  const rr: string[] = [];
  for (let s = 0; s < 2; s += 1) {
    const stage = await prisma.stage.create({
      data: {
        eventId,
        position: s,
        description: `Qualifying ${s + 1}`,
        type: "Round Robin",
        format: "Match Play",
        holes: HOLES,
        carryForwardEnabled: s === 1,
      },
      select: { id: true },
    });
    rr.push(stage.id);
  }

  // The bracket the qualifying rounds feed, with a third-place play-off.
  await prisma.stage.create({
    data: {
      eventId,
      position: 2,
      description: "Knockout",
      type: "Bracket Stage",
      format: "Match Play",
      holes: HOLES,
      thirdPlace: true,
    },
  });

  // A full round robin inside each flight. The lower seed wins, so the
  // qualifying order is knowable without re-deriving it from the engine.
  for (const [s, stageId] of rr.entries()) {
    for (const [f, flight] of flights.entries()) {
      const seats = playerIds.filter((_, i) => i % 4 === f);
      let n = 0;
      for (let a = 0; a < seats.length; a += 1) {
        for (let b = a + 1; b < seats.length; b += 1) {
          await prisma.match.create({
            data: {
              eventId,
              stageId,
              groupId: flight.id,
              round: n + 1,
              playerAId: seats[a],
              playerBId: seats[b],
              holes: card("A", 2 + ((n + s) % 3), 1 + (n % 2)),
            },
          });
          n += 1;
        }
      }
    }
  }

  const user = await prisma.user.create({
    data: {
      email: `${TAG.toLowerCase()}-admin@example.invalid`,
      name: `${TAG} Admin`,
      password: "x:unusable",
    },
    select: { id: true },
  });
  await prisma.account.create({
    data: {
      eventId,
      name: `${TAG} Admin`,
      email: `${TAG.toLowerCase()}-admin@example.invalid`,
      role: "admin",
    },
  });
  await createSession(user.id);
  await setActiveEvent(eventId);
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.$disconnect();
});

describe("a plate fills from results, not from seeding", () => {
  it("is empty before a qualifying result exists, and says so", async () => {
    const state = await loadEventState(eventId);
    expect(state, "the fixture did not load").not.toBeNull();

    // All sixteen come through the qualifying rounds.
    expect(state!.qualifiers).toHaveLength(16);

    // The name the screen puts on the second draw comes from here, and in
    // plate mode it is a PLATE. #574 fixed a screen that said "Consolation".
    expect(drawBrackets(state!.qualifiers, "plate").secondLabel).toBe("Plate");

    // THE DISTINCTION FROM `split`, stated as an assertion: with no result
    // recorded the plate has nobody in it, where split would already have
    // eight names drawn by rank.
    const plateNow = state!.brackets.consolation.rounds.flatMap((r) =>
      r.matches.flatMap((m) => [m.a.playerId, m.b.playerId].filter(Boolean)),
    );
    expect(plateNow, "a plate with a field before anybody has lost").toHaveLength(0);
    expect(drawBrackets(state!.qualifiers, "split").second.length).toBe(8);
  });

  it("fills with the qualifying losers once the round is recorded, and nobody is in both", async () => {
    const before = await loadEventState(eventId);
    const opening = before!.brackets.winners.rounds[0];
    expect(opening.matches, "sixteen qualifiers make eight qualifying matches").toHaveLength(8);

    // Record the qualifying round off the app's OWN pairing — the slot keys
    // and the players in them come from the draw the organizer sees, so this
    // cannot drift from `seedOrder`.
    const expectedLosers = new Set<string>();
    for (const m of opening.matches) {
      const a = m.a.playerId!;
      const b = m.b.playerId!;
      const winner = (m.a.seed ?? 99) < (m.b.seed ?? 99) ? a : b;
      expectedLosers.add(winner === a ? b : a);
      await prisma.bracketWinner.create({
        data: { eventId, key: m.key, winnerId: winner, result: "3&2" },
      });
    }
    expect(expectedLosers.size).toBe(8);

    const after = await loadEventState(eventId);
    const plate = new Set(
      after!.brackets.consolation.rounds[0].matches.flatMap((m) =>
        [m.a.playerId, m.b.playerId].filter(Boolean) as string[],
      ),
    );

    // THE RULE: the plate is exactly the players who lost, and the eight who
    // won are still in the main draw. Nobody is in both, and nobody is lost.
    expect([...plate].sort()).toEqual([...expectedLosers].sort());

    const stillIn = new Set(
      after!.brackets.winners.rounds[1].matches.flatMap((m) =>
        [m.a.playerId, m.b.playerId].filter(Boolean) as string[],
      ),
    );
    expect(stillIn.size).toBe(8);
    for (const id of stillIn) {
      expect(plate.has(id), `${id} is in the plate and still in the main draw`).toBe(false);
    }
    expect(new Set([...plate, ...stillIn]).size).toBe(16);
  });
});
