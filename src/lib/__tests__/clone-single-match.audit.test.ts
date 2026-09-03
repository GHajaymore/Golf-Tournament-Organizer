import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { parseSingleMatchRule, resolveSingleMatch } from "@/lib/domain/single-match";

/**
 * A copied final waits on the copy's own rounds.
 *
 * `cloneEvent` built each round from `CLONED_STAGE_FIELDS` and wrote
 * `singleMatchRule` verbatim. Two of the three kinds of rule are made of ids
 * belonging to the tournament they were written in, so a club running last
 * year's championship again got:
 *
 *   stage-winners — a final naming two Stage ids from LAST year. Nothing in
 *                   the new tournament has those ids, so `winnerOfStage`
 *                   returned null for both and the round read "Waiting on the
 *                   earlier rounds — one hasn't finished" from the day it was
 *                   created. This year's rounds could be played to the last
 *                   putt and it never moved, because it was not waiting on
 *                   them.
 *
 *   named         — a final naming two Player ids from a field that is never
 *                   copied, so it read "One of the players chosen for this
 *                   round is no longer in the field": a withdrawal that had
 *                   not happened, sent to an organizer to go and find.
 *
 * Both look like the ordinary not-ready state a final shows for most of a
 * tournament, which is how they lasted.
 *
 * Real rows and the real action, because the fix is a second pass over stages
 * that only exists once they all have ids — nothing a unit test of the
 * translation can reach.
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
import { cloneEvent } from "@/app/actions/tournament";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CLONE-SM";
const COPY_NAME = `${TAG} championship 2027`;

let sourceId = "";
let copyId = "";
/** Last year's rounds, by the name this test knows them under. */
const src: Record<string, string> = {};
const players: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** The copy's rounds, in the order they were created. */
async function copyStages() {
  return prisma.stage.findMany({ where: { eventId: copyId }, orderBy: { position: "asc" } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });

  const source = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} championship`,
      dates: "12-14 June",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "1 June",
      shareToken: `${TAG}-src-${process.pid}`,
      format: "match",
    },
  });
  sourceId = source.id;

  for (const [i, who] of ["ann", "bea"].entries()) {
    const p = await prisma.player.create({
      data: {
        eventId: sourceId,
        name: `${TAG} ${who}`,
        email: `${TAG}.${who}@example.invalid`.toLowerCase(),
        seed: i + 1,
        status: "confirmed",
        handicap: 0,
      },
    });
    players[who] = p.id;
  }

  // Two qualifying rounds, then a final decided by their winners, then a
  // second decider between two named players. Both id-bearing kinds in one
  // tournament, because they fail differently and both had to be fixed.
  for (const [i, key] of ["r1", "r2"].entries()) {
    const s = await prisma.stage.create({
      data: { eventId: sourceId, position: i, type: "Round Robin", format: "Match Play", holes: 18 },
    });
    src[key] = s.id;
  }
  const final = await prisma.stage.create({
    data: {
      eventId: sourceId,
      position: 2,
      type: "Single Match Stage",
      format: "Match Play",
      holes: 18,
      description: "The final",
      singleMatchRule: JSON.stringify({ kind: "stage-winners", a: src.r1, b: src.r2 }),
    },
  });
  src.final = final.id;

  const exhibition = await prisma.stage.create({
    data: {
      eventId: sourceId,
      position: 3,
      type: "Single Match Stage",
      format: "Match Play",
      holes: 18,
      description: "The exhibition",
      singleMatchRule: JSON.stringify({ kind: "named", a: players.ann, b: players.bea }),
    },
  });
  src.exhibition = exhibition.id;

  const playoff = await prisma.stage.create({
    data: {
      eventId: sourceId,
      position: 4,
      type: "Single Match Stage",
      format: "Match Play",
      holes: 18,
      description: "The play-off",
      singleMatchRule: JSON.stringify({ kind: "seeds", a: 1, b: 2 }),
    },
  });
  src.playoff = playoff.id;

  const user = await prisma.user.create({
    data: { email: `${TAG}.boss@example.invalid`.toLowerCase(), name: "boss", password: "x" },
  });
  await prisma.account.create({
    data: { eventId: sourceId, email: `${TAG}.boss@example.invalid`.toLowerCase(), name: "boss", role: "admin" },
  });

  jar.clear();
  await createSession(user.id);
  await setActiveEvent(sourceId);

  const res = await cloneEvent(sourceId, COPY_NAME);
  expect(res.ok, res.error ?? "clone should succeed").toBe(true);

  const copy = await prisma.event.findFirstOrThrow({ where: { name: COPY_NAME } });
  copyId = copy.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the fixture really is a copy of a tournament with id-bearing rules", () => {
  it("copied all five rounds", async () => {
    const stages = await copyStages();
    expect(stages.map((s) => s.description)).toEqual(["", "", "The final", "The exhibition", "The play-off"]);
  });

  it("gave the copy's rounds different ids from the source's", async () => {
    // If the ids collided, every assertion below would pass for the wrong
    // reason — the whole defect is that they do not.
    const stages = await copyStages();
    const sourceIds = new Set(Object.values(src));
    expect(stages.some((s) => sourceIds.has(s.id))).toBe(false);
  });

  it("did not copy the field, which is why a named rule cannot survive", async () => {
    expect(await prisma.player.count({ where: { eventId: copyId } })).toBe(0);
  });
});

describe("a final decided by the winners of two rounds", () => {
  it("names the COPY's rounds", async () => {
    const stages = await copyStages();
    const final = stages.find((s) => s.description === "The final")!;
    const rule = parseSingleMatchRule(final.singleMatchRule);
    expect(rule).toEqual({
      kind: "stage-winners",
      a: stages[0].id,
      b: stages[1].id,
    });
  });

  it("resolves once the copy's own rounds produce winners", async () => {
    /**
     * The lived symptom, at the end it is felt. Read against last year's ids
     * this returned no pairing and said it was waiting on rounds that were
     * already finished.
     */
    const stages = await copyStages();
    const final = stages.find((s) => s.description === "The final")!;
    const winners: Record<string, string> = { [stages[0].id]: "ann", [stages[1].id]: "bea" };
    const res = resolveSingleMatch(parseSingleMatchRule(final.singleMatchRule), {
      standingIds: [],
      winnerOfStage: (id) => winners[id] ?? null,
      fieldIds: ["ann", "bea"],
    });
    expect(res.problem).toBe("");
    expect(res.pairing).toEqual({ playerAId: "ann", playerBId: "bea" });
  });
});

describe("a match between two named players", () => {
  it("comes back unset rather than pointing at last year's field", async () => {
    const stages = await copyStages();
    const exhibition = stages.find((s) => s.description === "The exhibition")!;
    expect(exhibition.singleMatchRule).toBe("");
  });

  it("asks to be set instead of blaming a withdrawal", async () => {
    // "One of the players chosen for this round is no longer in the field" is
    // not something an organizer can act on, because nobody withdrew.
    const stages = await copyStages();
    const exhibition = stages.find((s) => s.description === "The exhibition")!;
    const res = resolveSingleMatch(parseSingleMatchRule(exhibition.singleMatchRule), {
      standingIds: [],
      winnerOfStage: () => null,
      fieldIds: ["ann", "bea"],
    });
    expect(res.problem).toContain("no pairing rule set");
    expect(res.problem).not.toContain("no longer in the field");
  });
});

describe("a play-off between first and second", () => {
  it("carries across untouched", async () => {
    // It names positions in a standing, not ids, so there is nothing to
    // translate — and dropping it would lose a setting the copy can honour.
    const stages = await copyStages();
    const playoff = stages.find((s) => s.description === "The play-off")!;
    expect(parseSingleMatchRule(playoff.singleMatchRule)).toEqual({ kind: "seeds", a: 1, b: 2 });
  });
});
