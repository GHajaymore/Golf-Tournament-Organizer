import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A COMMITTEE CORRECTION IS ON THE RECORD (2026-10-08).
 *
 * Walked as grid cell T11: a closed round with $10 skins, and the committee
 * found Bea's 2nd was a 4, not the 5 on her card. They reopened her approved
 * card, corrected it and approved it again. The board, the public board and
 * the skins all moved — a skin and $15 changed hands — and Reports' "Recent
 * changes" read "Nothing recorded yet". Approving a stroke card, approving a
 * round, reopening a card and correcting one wrote no line at all, where the
 * match-play counterparts always had.
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
import { saveScorecard, approveScorecard, approveRound, reopenScorecard } from "@/app/actions/tournament";
import { recentChanges } from "@/lib/services/recent-changes";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CORRECTION";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();
const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
const AS_SIGNED = [...PARS];
const CORRECTED = PARS.map((p, i) => (i === 1 ? 4 : p));

let eventId = "";
let closedRound = "";
let openRound = "";
let beaId = "";
let organizerUser = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} medal`,
      status: "live",
      shape: "series",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  eventId = event.id;
  const base = { eventId, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross" };
  closedRound = (await prisma.stage.create({ data: { ...base, position: 0, closedAt: new Date() } })).id;
  openRound = (await prisma.stage.create({ data: { ...base, position: 1 } })).id;
  beaId = (
    await prisma.player.create({
      data: { eventId, name: `${TAG} Bea`, email: at("bea"), seed: 1, status: "confirmed" },
    })
  ).id;
  await prisma.scorecard.create({
    data: {
      eventId,
      stageId: closedRound,
      playerId: beaId,
      strokes: JSON.stringify(AS_SIGNED),
      status: "approved",
      approvedBy: at("organizer"),
      approvedAt: new Date(),
    },
  });
  organizerUser = (await prisma.user.create({ data: { email: at("organizer"), name: "Oona", password: "x" } })).id;
  await prisma.account.create({ data: { eventId, email: at("organizer"), name: "Oona", role: "admin" } });
  jar.clear();
  await createSession(organizerUser);
  await setActiveEvent(eventId);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const lines = async () => (await recentChanges(eventId, { take: 50 })).map((r) => `${r.kind} | ${r.what}`);

describe("the committee reopens, corrects and approves a card", () => {
  it("says each act, naming the player, the round and the hole that moved", async () => {
    await prisma.auditLog.deleteMany({ where: { eventId } });
    await reopenScorecard(closedRound, beaId);
    expect((await saveScorecard(closedRound, beaId, CORRECTED)).ok).toBe(true);
    await approveScorecard(closedRound, beaId);

    const said = await lines();
    expect(said, "reopening went unrecorded").toContain(`Scores & results | ${TAG} Bea's Round 1 card reopened for correction`);
    expect(said, "the correction went unrecorded").toContain(`Scores & results | ${TAG} Bea's Round 1 card corrected — hole 2: 5 → 4`);
    expect(said, "the approval went unrecorded").toContain(`Scores & results | ${TAG} Bea's Round 1 card approved`);
    // A round named by its id would have read as a departed player.
    expect(said.join("\n")).not.toMatch(/no longer in the field/);
  });

  it("approving a whole round says how many cards", async () => {
    await prisma.auditLog.deleteMany({ where: { eventId } });
    await prisma.scorecard.updateMany({ where: { stageId: closedRound, playerId: beaId }, data: { status: "certified" } });
    await approveRound(closedRound);
    expect(await lines()).toContain("Scores & results | 1 card approved for Round 1");
  });
});

describe("what is not a correction", () => {
  it("a first entry in an open round writes nothing — the day's typing is not a ruling", async () => {
    await prisma.auditLog.deleteMany({ where: { eventId } });
    expect((await saveScorecard(openRound, beaId, AS_SIGNED)).ok).toBe(true);
    expect((await saveScorecard(openRound, beaId, CORRECTED)).ok).toBe(true);
    expect(await lines()).toEqual([]);
  });

  it("re-saving a closed round's card unchanged writes nothing", async () => {
    await prisma.auditLog.deleteMany({ where: { eventId } });
    await reopenScorecard(closedRound, beaId);
    await prisma.auditLog.deleteMany({ where: { eventId } });
    const now = JSON.parse((await prisma.scorecard.findFirstOrThrow({ where: { stageId: closedRound, playerId: beaId } })).strokes);
    expect((await saveScorecard(closedRound, beaId, now)).ok).toBe(true);
    expect(await lines()).toEqual([]);
  });
});
