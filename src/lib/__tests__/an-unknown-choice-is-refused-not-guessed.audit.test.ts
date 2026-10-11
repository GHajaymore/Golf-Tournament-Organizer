import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * AN UNKNOWN CHOICE IS REFUSED, NOT GUESSED AT (sweep 1, section e, 2026-10-10).
 *
 * A `"use server"` export is called with whatever the caller likes, and two of
 * them answered a value they did not recognise by picking one for the caller:
 *
 *   setStageFormat   anything unrecognised  ->  "Match Play"
 *   addStage         anything unrecognised  ->  "Round Robin"
 *
 * So a format name that had drifted between two versions of the app — or one
 * typo — silently turned a medal round into match play, re-reading every card
 * in it as holes won, and reported success. The same shape as the tournament
 * status that read any unknown word as "draft" (`statusMove`).
 *
 * Coercing to the safest-LOOKING value is how a mistake becomes an action.
 * Both refuse now, and change nothing.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-UNKNOWNCHOICE";
const EMAIL = `${TAG}.sec@example.invalid`.toLowerCase();
const session = { email: EMAIL, name: `${TAG} secretary`, eventId: "", role: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { setStageFormat, addStage } = await import("@/app/actions/tournament");

let eventId = "";
let stageId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id, name: `${TAG} medal`, dates: "", course: "", city: "", address: "", regDeadline: "",
      shareToken: `${TAG}-${process.pid}`, format: "stroke", configUnlocked: true,
    },
  });
  eventId = event.id;
  session.eventId = eventId;
  await prisma.account.create({ data: { eventId, email: EMAIL, name: `${TAG} secretary`, role: "admin" } });
  stageId = (
    await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Stableford", holes: 18, scoringBasis: "net" } })
  ).id;
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

const round = () => prisma.stage.findUnique({ where: { id: stageId }, select: { format: true, scoringBasis: true } });
const rounds = () => prisma.stage.count({ where: { eventId } });

describe("a round's format", () => {
  for (const sent of ["Stablefrod", "stableford", "", "constructor", "Matchplay"]) {
    it(`"${sent}" is refused and the round stays Stableford`, async () => {
      const res = await setStageFormat(stageId, sent, true);
      expect(res.ok).toBe(false);
      expect(await round()).toEqual({ format: "Stableford", scoringBasis: "net" });
    });
  }

  it("CONTROL: a real format is still set", async () => {
    expect((await setStageFormat(stageId, "Stroke Play", true)).ok).toBe(true);
    expect((await round())?.format).toBe("Stroke Play");
    expect((await setStageFormat(stageId, "Stableford", true)).ok).toBe(true);
    expect(await round()).toEqual({ format: "Stableford", scoringBasis: "net" });
  });
});

describe("the kind of round being added", () => {
  for (const sent of ["Stroke Play", "round robin", "", "constructor"]) {
    it(`"${sent}" is refused and no round is added`, async () => {
      const before = await rounds();
      const res = await addStage(sent, { format: "Stroke Play" });
      expect(res.error ?? "", "an unknown kind of round was added as something else").not.toBe("");
      expect(res.id).toBeUndefined();
      expect(await rounds()).toBe(before);
    });
  }

  it("CONTROL: a real kind of round is still added", async () => {
    const before = await rounds();
    const res = await addStage("Stroke Play Round", { format: "Stroke Play" });
    expect(res.error).toBeUndefined();
    expect(await rounds()).toBe(before + 1);
  });
});
