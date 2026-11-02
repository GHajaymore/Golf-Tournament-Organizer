import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

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

/**
 * COMPLETING ASKS ABOUT ROUNDS NOBODY HAS PLAYED (2026-10-31).
 *
 * Found by the workflow review: completing closes every open round, so a two-day outing with
 * Round 2 untouched could be completed — Round 2 closed as not played — with one confirm, by
 * mistake. The panel (tournament director, golf professional, UX Writer) ruled: ASK when some
 * rounds have no scores, in their words; refuse only when nothing at all has been scored.
 *
 *   asked        Round 1 played, Round 2 untouched: refused WITH the question, nothing changes
 *   go-ahead     the same, confirmed: completed, and Round 2 closed as not played
 *   nothing      no round has a score: refused, there is no result
 *
 * Real rows in the development database, under a ZZ mark, deleted afterwards.
 */
import { createSession, setActiveEvent } from "@/lib/auth";
import { setEventStatus } from "@/app/actions/tournament";
import { NOTHING_SCORED } from "@/lib/domain/phase-gate";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-COMPLETE-ASKS";
const PARS = new Array(18).fill(4);

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
}

let orgId = "";
let userId = "";

async function outing(name: string, scoreRoundOne: boolean) {
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} ${name}`,
      organizationId: orgId,
      status: "live",
      format: "stroke",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}-share`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
    select: { id: true },
  });
  const rounds: string[] = [];
  for (const position of [0, 1]) {
    const st = await prisma.stage.create({
      data: { eventId: ev.id, position, description: `Round ${position + 1}`, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross" },
      select: { id: true },
    });
    rounds.push(st.id);
  }
  const player = await prisma.player.create({
    data: { eventId: ev.id, name: `${TAG} player`, email: `${TAG.toLowerCase()}-${name}-p@example.invalid`, status: "confirmed", handicap: 0, seed: 1 },
    select: { id: true },
  });
  if (scoreRoundOne) {
    await prisma.scorecard.create({ data: { eventId: ev.id, stageId: rounds[0], playerId: player.id, strokes: JSON.stringify(PARS) } });
  }
  await prisma.account.create({ data: { eventId: ev.id, name: `${TAG} Admin`, email: `${TAG.toLowerCase()}-admin@example.invalid`, role: "admin" } });
  return { eventId: ev.id, rounds };
}

const state = async (eventId: string, roundId: string) => ({
  status: (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status,
  roundClosed: (await prisma.stage.findUniqueOrThrow({ where: { id: roundId } })).closedAt !== null,
});

beforeAll(async () => {
  await cleanup();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } })).id;
  userId = (
    await prisma.user.create({
      data: { email: `${TAG.toLowerCase()}-admin@example.invalid`, name: `${TAG} Admin`, password: "x:unusable", emailVerifiedAt: new Date() },
      select: { id: true },
    })
  ).id;
  await createSession(userId);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("completing with a round nobody has played", () => {
  it("asks, in the panel's words, and changes nothing until it is answered", async () => {
    const { eventId, rounds } = await outing("asked", true);
    await setActiveEvent(eventId);
    expect(await setEventStatus("completed")).toEqual({
      ok: false,
      needsUnplayedConfirm: true,
      error: "Round 2 has no scores. Completing will close it as not played, and results will be decided on the rounds played.",
    });
    expect(await state(eventId, rounds[1]), "asking changed something").toEqual({ status: "live", roundClosed: false });
  });

  it("completes when the organizer says so, closing the unplayed round", async () => {
    const { eventId, rounds } = await outing("go-ahead", true);
    await setActiveEvent(eventId);
    expect(await setEventStatus("completed", false, true)).toEqual({ ok: true });
    expect(await state(eventId, rounds[1])).toEqual({ status: "completed", roundClosed: true });
  });

  it("refuses when nothing at all has been scored: there is no result", async () => {
    const { eventId, rounds } = await outing("nothing", false);
    await setActiveEvent(eventId);
    expect(await setEventStatus("completed", false, true)).toEqual({ ok: false, error: NOTHING_SCORED });
    expect(await state(eventId, rounds[0])).toEqual({ status: "live", roundClosed: false });
  });
});
