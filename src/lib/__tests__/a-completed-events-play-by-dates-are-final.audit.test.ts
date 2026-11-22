import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A COMPLETED EVENT'S DATES ARE FINAL, THE KNOCKOUT'S PLAY-BY DATES TOO.
 *
 * `setStageDeadline` asks `roundRefusal(…, { kind: "day" })`; `setKnockoutPlayBy`
 * asked only who the caller was, so a finished event's knockout dates could still
 * be rewritten. Same day, same rule. A live event still accepts them (the control).
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
import { setKnockoutPlayBy } from "@/app/actions/tournament";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-PLAYBY-FINAL";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();
let orgId = "";
let liveEvent = "";
let doneEvent = "";
let liveStage = "";
let doneStage = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: orgId || "none" } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function eventWith(name: string, status: string) {
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${name}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}-${Date.now()}`,
      capacity: 0,
      format: "stroke",
      status,
    },
  });
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Bracket Stage", format: "Match Play", holes: 18 },
  });
  await prisma.account.create({ data: { eventId: event.id, email: at("organizer"), name: `${TAG} Organizer`, role: "admin" } });
  return { eventId: event.id, stageId: stage.id };
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
  ({ eventId: liveEvent, stageId: liveStage } = await eventWith("live", "live"));
  ({ eventId: doneEvent, stageId: doneStage } = await eventWith("done", "completed"));
  const user = await prisma.user.create({ data: { email: at("organizer"), name: `${TAG} Organizer`, password: "x", emailVerifiedAt: new Date() } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "owner" } });
  jar.clear();
  await createSession(user.id);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const playBy = (stageId: string) => prisma.stage.findUniqueOrThrow({ where: { id: stageId }, select: { knockoutPlayBy: true } });

describe("setKnockoutPlayBy", () => {
  it("is accepted on a live event (the control)", async () => {
    await setActiveEvent(liveEvent);
    const res = await setKnockoutPlayBy(liveStage, { "0": "2026-11-14" });
    expect(res, JSON.stringify(res)).toEqual({ ok: true });
    expect((await playBy(liveStage)).knockoutPlayBy).toContain("2026-11-14");
  });

  it("is refused on a completed event, and its dates stay as they were", async () => {
    await setActiveEvent(doneEvent);
    const before = (await playBy(doneStage)).knockoutPlayBy;
    const res = await setKnockoutPlayBy(doneStage, { "0": "2026-11-14" });
    expect(res.ok).toBe(false);
    expect(res.error ?? "").not.toBe("");
    expect((await playBy(doneStage)).knockoutPlayBy).toBe(before);
  });
});
