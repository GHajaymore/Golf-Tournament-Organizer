import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A QUALIFICATION WATCH NEEDS SOMETHING LEFT TO WATCH.
 *
 * Read off the seeded club's Summer Knockout on 2026-09-22, whose bracket was
 * at the semi-finals — five ties decided, a club announcement about the SECOND
 * semi-final — while two screens still described a live race:
 *
 *     dashboard    Cutoff line ≈ 10.5 pts · updates live with scores
 *     leaderboard  🎯 Nkechi Obioma holds the final qualifying spot
 *
 * The dashboard's is the worse of the two and is why this was fixed rather
 * than left. "Holds the final qualifying spot" is at least true about a
 * settled fact stated oddly. "Updates live with scores" is a promise about
 * FUTURE behaviour, and it is false: that cutoff cannot move however many
 * scores come in.
 *
 * THE BEFORE-STATE IS THE POINT OF THE FIXTURE. A rule that simply never
 * showed the watch would satisfy "it is gone once the knockout starts" and be
 * useless, so the same tournament is asserted twice — the watch present while
 * the draw is unplayed, absent the moment somebody advances out of it.
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
import { loadEventState, computeHighlights } from "@/lib/services/tournament";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-WATCH";
const HOLES = 18;

let eventId = "";
let rrStageId = "";
const playerIds: string[] = [];

/** A card A wins by `by` holes with `left` to play. */
const card = (by: number, left: number) =>
  JSON.stringify([
    ...Array.from({ length: HOLES - left }, (_, i) => (i < by ? "A" : "H")),
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
      name: `${TAG} knockout`,
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
      bracketMode: "single",
      qualifyMode: "overall",
      // Four of the eight go through, so there IS a bubble to watch.
      qualifyOverall: 4,
      customStrokeIndex: JSON.stringify(Array.from({ length: HOLES }, (_, i) => i + 1)),
    },
    select: { id: true },
  });
  eventId = ev.id;

  const flight = await prisma.group.create({
    data: { eventId, name: `${TAG} Flight`, position: 0 },
    select: { id: true },
  });

  for (let i = 0; i < 8; i += 1) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} P${i + 1}`,
        email: `${TAG.toLowerCase()}-p${i + 1}@example.invalid`,
        seed: i + 1,
        status: "confirmed",
        handicap: 0,
        groupId: flight.id,
      },
      select: { id: true },
    });
    playerIds.push(p.id);
  }

  const rr = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      description: "Group stage",
      type: "Round Robin",
      format: "Match Play",
      holes: HOLES,
    },
    select: { id: true },
  });
  rrStageId = rr.id;

  await prisma.stage.create({
    data: {
      eventId,
      position: 1,
      description: "Knockout",
      type: "Bracket Stage",
      format: "Match Play",
      holes: HOLES,
    },
  });

  // A full round robin, lower seed wins, so the qualifying order is settled
  // and four players genuinely advance.
  let n = 0;
  for (let a = 0; a < playerIds.length; a += 1) {
    for (let b = a + 1; b < playerIds.length; b += 1) {
      await prisma.match.create({
        data: {
          eventId,
          stageId: rr.id,
          groupId: flight.id,
          round: n + 1,
          playerAId: playerIds[a],
          playerBId: playerIds[b],
          holes: card(2 + (n % 3), 1 + (n % 2)),
        },
      });
      n += 1;
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

const watchTitles = async () => {
  const state = await loadEventState(eventId);
  return {
    settled: state!.qualifyingSettled,
    titles: computeHighlights(state!).map((h) => h.title),
  };
};

describe("a qualification watch needs something left to watch", () => {
  it("shows it while the draw is unplayed and the race could still move", async () => {
    await prisma.bracketWinner.deleteMany({ where: { eventId } });
    await prisma.stage.updateMany({ where: { eventId }, data: { closedAt: null } });

    const { settled, titles } = await watchTitles();
    expect(settled, "settled before anybody has played out of the draw").toBe(false);
    expect(titles, "no watch to remove, so the cells below would prove nothing").toContain(
      "Qualification watch",
    );
  });

  it("drops it once somebody has played their way out of the draw", async () => {
    const state = await loadEventState(eventId);
    const first = state!.brackets.winners.rounds[0].matches.find(
      (m) => m.a.playerId && m.b.playerId,
    )!;
    await prisma.bracketWinner.create({
      data: { eventId, key: first.key, winnerId: first.a.playerId!, result: "3&2" },
    });

    const { settled, titles } = await watchTitles();
    expect(settled).toBe(true);
    expect(titles, "still watching a race that finished before the draw was made").not.toContain(
      "Qualification watch",
    );
  });

  it("is settled by the organizer closing the feeder rounds, with no bracket result at all", async () => {
    /**
     * THE OTHER WAY OF BEING SETTLED, and the one that works before a knockout
     * has been played. `Stage.closedAt` is the organizer saying so, which is
     * what it was added for — every stored tournament predates it, which is
     * why the bracket test above exists as well.
     */
    await prisma.bracketWinner.deleteMany({ where: { eventId } });
    expect((await watchTitles()).settled, "the control: open again once the tie is removed").toBe(
      false,
    );

    await prisma.stage.update({ where: { id: rrStageId }, data: { closedAt: new Date() } });
    const { settled, titles } = await watchTitles();
    expect(settled).toBe(true);
    expect(titles).not.toContain("Qualification watch");
  });
});
