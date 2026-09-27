import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * RUNNING AN EVENT IS NOT SETTING IT UP (Ajay, 2026-09-27: "go with what a
 * golf pro would decide").
 *
 * Setup locks at launch to protect what the field entered — the format, the
 * scoring, the field. It used to lock the running of the competition too, so a
 * committee had to unlock a live tournament's whole setup to draw round 2, add
 * next week's league round, move a deadline or close scoring early. Those are
 * now open on a locked tournament, through the real actions here, with the one
 * guard the lock had been providing by accident: `generateCutRound` DELETES a
 * round before drawing it, so a round that already has scores is refused in
 * words, and its scores are still there afterwards.
 *
 * And the control: a real SETUP change is still refused on the same
 * tournament, so this is not "the lock stopped working".
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
import {
  addStage,
  generateNextRound,
  setStageDeadline,
  setStageDeadlineOverride,
  setStageCarry,
} from "@/app/actions/tournament";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-LIVE-OPS";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();
let orgId = "";
let eventId = "";
let round1 = "";
let round2 = "";
const players: string[] = [];

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: orgId || "none" } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
  eventId = (
    await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${TAG} championship`,
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-${Date.now()}`,
        capacity: 0,
        format: "stroke",
        // LIVE AND LOCKED — the state every case below is about.
        status: "live",
        configUnlocked: false,
      },
    })
  ).id;
  round1 = (
    await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } })
  ).id;
  round2 = (
    await prisma.stage.create({ data: { eventId, position: 1, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } })
  ).id;
  for (const who of ["ann", "bo", "cy"]) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: at(who), seed: players.length + 1, status: "confirmed", handicap: 10 },
    });
    players.push(p.id);
    await prisma.scorecard.create({
      data: { eventId, stageId: round1, playerId: p.id, strokes: JSON.stringify(new Array(18).fill(4)) },
    });
  }
  const user = await prisma.user.create({ data: { email: at("organizer"), name: `${TAG} Organizer`, password: "x" } });
  await prisma.account.create({ data: { eventId, email: at("organizer"), name: `${TAG} Organizer`, role: "admin" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "owner" } });
  jar.clear();
  await createSession(user.id);
  await setActiveEvent(eventId);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("on a live tournament whose setup is locked", () => {
  it("the committee can draw the next round — every player gets a card", async () => {
    const res = await generateNextRound(round2);
    expect(res.ok, "error" in res ? res.error : "").toBe(true);
    expect(await prisma.scorecard.count({ where: { stageId: round2 } })).toBe(3);
  });

  it("but not redraw it once it has scores — refused in words, and the scores survive", async () => {
    const card = await prisma.scorecard.findFirstOrThrow({ where: { stageId: round2, playerId: players[0] } });
    const played = [5, 4, 3, ...new Array(15).fill(null)];
    await prisma.scorecard.update({ where: { id: card.id }, data: { strokes: JSON.stringify(played) } });

    const res = await generateNextRound(round2);
    expect(res.ok).toBe(false);
    expect("error" in res ? res.error : "").toMatch(/already has scores/);
    const after = await prisma.scorecard.findUniqueOrThrow({ where: { id: card.id } });
    expect(JSON.parse(after.strokes)).toEqual(played);
  });

  it("can add next week's round", async () => {
    const before = await prisma.stage.count({ where: { eventId } });
    await addStage("Stroke Play Round", { count: 1, format: "Stroke Play", holes: 18 });
    expect(await prisma.stage.count({ where: { eventId } })).toBe(before + 1);
  });

  it("can move a deadline and close scoring early", async () => {
    await setStageDeadline(round2, "2026-10-04");
    await setStageDeadlineOverride(round2, false);
    const s = await prisma.stage.findUniqueOrThrow({ where: { id: round2 }, select: { deadline: true, deadlineOverride: true } });
    expect(s).toEqual({ deadline: "2026-10-04", deadlineOverride: false });
  });

  it("still refuses a real SETUP change (the control)", async () => {
    await expect(setStageCarry(round2, true, 100)).rejects.toThrow(/Configuration is locked/);
  });
});
