import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * CLOSING A ROUND TAKES A PLACE FROM WHOEVER DID NOT PLAY IT — ON STROKES.
 *
 * `parThru` is par for the holes a player actually played, so a stroke
 * aggregate measures each player over their own rounds and nobody else's. One
 * round at +4 then out-ranks two rounds at +6, which is the defect in
 * `docs/deferred-register.md` and the reason `Stage.closedAt` exists.
 *
 * POINTS AND STROKES GET OPPOSITE TREATMENT, and that is the half most likely
 * to be broken by a later tidy-up, so both are asserted here against the same
 * shape of fixture:
 *
 *   strokes   a missed round cannot be expressed — charging par with no
 *             strokes against it reads as 72 UNDER par — so the player is
 *             shown without a place, as a card that stopped short already is.
 *   points    a missed week already costs the points it was worth, via
 *             `chargedHoles`. The player stays on the board. Unranking them
 *             would be wrong: a league ranks everybody who turned up at all.
 *
 * AND THE BEFORE-STATE IS ASSERTED, not assumed. Every round is open until an
 * organizer closes one, so the same fixture with nothing closed must rank all
 * three — otherwise this cell could pass on an app that unranks absentees
 * whatever the organizer says, which is the thing Ajay's answer ruled out.
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

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CLOSED";
const HOLES = 18;
const PARS = Array.from({ length: HOLES }, () => 4);

/** Level par on every hole, so the arithmetic is never the interesting part. */
const evenCard = JSON.stringify(PARS);

type Built = { eventId: string; rounds: string[]; everyone: string[]; absentee: string };

async function buildEvent(name: string, format: string, basis: string): Promise<Built> {
  const org = await prisma.organization.create({
    data: { name: `${TAG} ${name} club`, kind: "club" },
    select: { id: true },
  });
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} ${name}`,
      organizationId: org.id,
      status: "live",
      shape: "series",
      format: "stroke",
      sideStyle: "individual",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}-share`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: HOLES }, (_, i) => i + 1)),
    },
    select: { id: true },
  });

  const rounds: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const s = await prisma.stage.create({
      data: {
        eventId: ev.id,
        position: i,
        description: `Round ${i + 1}`,
        type: "Stroke Play Round",
        format,
        scoringBasis: basis,
        holes: HOLES,
      },
      select: { id: true },
    });
    rounds.push(s.id);
  }

  const ids: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const p = await prisma.player.create({
      data: {
        eventId: ev.id,
        name: `${TAG} ${name} P${i + 1}`,
        email: `${TAG.toLowerCase()}-${name}-p${i + 1}@example.invalid`,
        seed: i + 1,
        status: "confirmed",
        handicap: 0,
      },
      select: { id: true },
    });
    ids.push(p.id);
  }

  // The first two play both rounds; the third plays only the first.
  for (const [i, playerId] of ids.entries()) {
    const plays = i === 2 ? rounds.slice(0, 1) : rounds;
    for (const stageId of plays) {
      await prisma.scorecard.create({
        data: { eventId: ev.id, stageId, playerId, strokes: evenCard, status: "certified" },
      });
    }
  }

  return { eventId: ev.id, rounds, everyone: ids, absentee: ids[2] };
}

let strokes: Built;
let points: Built;

beforeAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });

  strokes = await buildEvent("medal", "Stroke Play", "gross");
  points = await buildEvent("stableford", "Stableford", "net");

  const user = await prisma.user.create({
    data: {
      email: `${TAG.toLowerCase()}-admin@example.invalid`,
      name: `${TAG} Admin`,
      password: "x:unusable",
    },
    select: { id: true },
  });
  for (const ev of [strokes.eventId, points.eventId]) {
    await prisma.account.create({
      data: {
        eventId: ev,
        name: `${TAG} Admin`,
        email: `${TAG.toLowerCase()}-admin@example.invalid`,
        role: "admin",
      },
    });
  }
  await createSession(user.id);
  await setActiveEvent(strokes.eventId);
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.$disconnect();
});

const rankedIds = async (eventId: string) => {
  const state = await loadEventState(eventId);
  return state!.strokeStandings.filter((s) => s.ranked).map((s) => s.player.id);
};

describe("a closed round takes the place of whoever did not play it", () => {
  it("ranks everybody while the round is still open", async () => {
    // THE BEFORE-STATE, asserted rather than assumed: nothing is closed, so
    // the absentee still holds a position. Without this the cells below would
    // pass on an app that unranked absentees regardless.
    await prisma.stage.updateMany({
      where: { id: { in: strokes.rounds } },
      data: { closedAt: null },
    });
    expect((await rankedIds(strokes.eventId)).sort()).toEqual([...strokes.everyone].sort());
  });

  it("drops the absentee once the organizer closes the round they missed", async () => {
    await prisma.stage.update({
      where: { id: strokes.rounds[1] },
      data: { closedAt: new Date() },
    });

    const ranked = await rankedIds(strokes.eventId);
    expect(ranked, "the absentee still holds a place on a closed round").not.toContain(
      strokes.absentee,
    );
    // The control: the two who played both rounds are untouched. A rule that
    // unranked the whole field would satisfy the assertion above on its own.
    expect(ranked.sort()).toEqual(strokes.everyone.slice(0, 2).sort());
  });

  it("still shows them, because a player without a place is not a player who vanished", async () => {
    /**
     * Rule 3.2b's treatment, and the one `isRanked` already applies to a card
     * that stopped short: the round is on the sheet with no position against
     * it. Removing the row would hide a card the committee may need to see.
     */
    const state = await loadEventState(strokes.eventId);
    const row = state!.strokeStandings.find((s) => s.player.id === strokes.absentee);
    expect(row, "the absentee disappeared from the board entirely").toBeTruthy();
    expect(row!.ranked).toBe(false);
    expect(row!.rank).toBe(0);
  });

  it("leaves a POINTS board alone, where a missed round already costs its points", async () => {
    /**
     * The opposite treatment, on the same shape of fixture. `chargedHoles`
     * charges a settled week to everybody, so the absentee is behind by the
     * points it was worth and stays ON the board — a league ranks everybody
     * who turned up at all, and unranking them would be the #565 defect
     * wearing the other face.
     */
    await prisma.stage.update({
      where: { id: points.rounds[1] },
      data: { closedAt: new Date() },
    });
    await setActiveEvent(points.eventId);
    try {
      const ranked = await rankedIds(points.eventId);
      expect(ranked, "closing a week unranked a Stableford player").toContain(points.absentee);
      expect(ranked.sort()).toEqual([...points.everyone].sort());
    } finally {
      await setActiveEvent(strokes.eventId);
    }
  });
});
