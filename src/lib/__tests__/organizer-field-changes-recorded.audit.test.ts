import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE ORGANIZER'S OWN FIELD CHANGES ARE ON THE RECORD — "Recent changes to the
 * field" on Registration (Ajay, 2026-09-27).
 *
 * #655 made the organizer's add and remove write a line, beside a member's own
 * entry and withdrawal, and tested only the member's half. This is the other
 * half, through the real actions and a real organizer session: adding a player,
 * removing one who never played, and withdrawing one who has — each read back
 * through `recentChanges`, the function the screen renders.
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
import { addSignup, removeSignup } from "@/app/actions/tournament";
import { recentChanges } from "@/lib/services/recent-changes";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-FIELD-LOG";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();
let orgId = "";
let eventId = "";
const ids: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: orgId || "none" } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
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
        name: `${TAG} medal`,
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-${Date.now()}`,
        capacity: 0,
        status: "draft",
      },
    })
  ).id;
  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
  });
  for (const [i, who] of ["never-played", "has-a-card"].entries()) {
    ids[who] = (
      await prisma.player.create({
        data: { eventId, name: `${TAG} ${who}`, email: at(who), seed: i + 1, status: "confirmed", handicap: 10 },
      })
    ).id;
  }
  await prisma.scorecard.create({
    data: { eventId, stageId: stage.id, playerId: ids["has-a-card"], strokes: JSON.stringify([4, 4, 4]) },
  });
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

describe("what the organizer does to the field is recorded", () => {
  it("adding a player writes a line naming them", async () => {
    // A free club needs a mobile from every entrant; Ofcom's drama range.
    const res = await addSignup({ name: `${TAG} Added`, email: at("added"), phone: "07700 900654", handicap: 12 });
    expect(res.ok, res.error).toBe(true);
    const [latest] = await recentChanges(eventId, { only: "field" });
    expect(latest.what).toBe(`${TAG} Added was added to the field (confirmed).`);
    expect(latest.actor).toBe(`${TAG} Organizer`);
  });

  it("removing one who never played says removed; one with a card says withdrawn, results kept", async () => {
    expect(await removeSignup(ids["never-played"])).toBe("deleted");
    expect(await removeSignup(ids["has-a-card"])).toBe("withdrawn");
    const [newest, next] = await recentChanges(eventId, { only: "field" });
    expect(newest.what).toBe(`${TAG} has-a-card was withdrawn from the field (their results are kept).`);
    expect(next.what).toBe(`${TAG} never-played was removed from the field.`);
  });

  it("files all three as Field, and nothing else is (the control)", async () => {
    const all = await recentChanges(eventId);
    expect(all).toHaveLength(3);
    expect(all.every((r) => r.kind === "Field")).toBe(true);
  });
});
