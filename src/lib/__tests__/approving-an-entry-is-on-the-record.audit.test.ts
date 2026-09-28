import "dotenv/config";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * APPROVING AN ENTRY IS ON THE RECORD.
 *
 * 2026-09-28: Recent changes to the field listed entries, withdrawals and
 * removals — and nothing when an organizer approved an entry, which is the act
 * that decides whether somebody plays at all. One line, under Field, saying
 * whether the approval gave them a place or put them on the waiting list,
 * against the name of the organizer who approved it.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-APPROVE";

const session = { email: `${TAG.toLowerCase()}-sec@example.invalid`, name: `${TAG} Secretary`, eventId: "", role: "admin", viewRole: "admin" };
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  setActiveEvent: async () => {},
  requireStaff: async () => session.eventId,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { approveSignup, removeSignup } = await import("@/app/actions/tournament");

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** An approve-mode event with `confirmed` in a field of `capacity`, and one entry awaiting approval. */
async function eventWith(capacity: number, confirmed: number) {
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} medal`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}-${org.id.slice(-6)}`,
      format: "stroke",
      status: "registration",
      capacity,
      registrationApproval: "approve",
    },
  });
  session.eventId = event.id;
  for (let i = 0; i < confirmed; i += 1) {
    await prisma.player.create({
      data: { eventId: event.id, name: `${TAG} in${i}`, email: `${TAG}.in${i}@example.invalid`.toLowerCase(), seed: i + 1, status: "confirmed", handicap: 10 },
    });
  }
  return prisma.player.create({
    data: { eventId: event.id, name: `${TAG} Applicant`, email: `${TAG}.applicant@example.invalid`.toLowerCase(), seed: 99, status: "pending", handicap: 10 },
  });
}

const lines = () => prisma.auditLog.findMany({ where: { eventId: session.eventId, action: "approved" }, select: { actor: true, detail: true } });

beforeEach(scrub);
afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("approving an entry is on the record", () => {
  it("says the approval gave them a place, against the organizer's name", async () => {
    const p = await eventWith(8, 2);
    expect((await approveSignup(p.id)).ok).toBe(true);
    expect(await lines()).toEqual([{ actor: `${TAG} Secretary`, detail: `${TAG} Applicant's entry was approved.` }]);
  });

  it("says so when a full field puts the approved entry on the waiting list", async () => {
    const p = await eventWith(2, 2);
    await approveSignup(p.id);
    expect((await prisma.player.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("waitlisted");
    expect((await lines())[0]?.detail).toMatch(/field is full, so they are on the waiting list/);
  });

  it("turning an entry away says it was declined, not removed from a field it was never in", async () => {
    const p = await eventWith(8, 0);
    await removeSignup(p.id);
    const removed = await prisma.auditLog.findMany({ where: { eventId: session.eventId, action: "removed" }, select: { detail: true } });
    expect(removed.map((r) => r.detail)).toEqual([`${TAG} Applicant's entry was declined.`]);
  });

  it("CONTROL: removing a confirmed entrant still says they left the field", async () => {
    const p = await eventWith(8, 0);
    await prisma.player.update({ where: { id: p.id }, data: { status: "confirmed" } });
    await removeSignup(p.id);
    const removed = await prisma.auditLog.findMany({ where: { eventId: session.eventId, action: "removed" }, select: { detail: true } });
    expect(removed.map((r) => r.detail)).toEqual([`${TAG} Applicant was removed from the field.`]);
  });

  it("CONTROL: approving an entry that is not pending writes nothing", async () => {
    const p = await eventWith(8, 0);
    await prisma.player.update({ where: { id: p.id }, data: { status: "confirmed" } });
    await approveSignup(p.id);
    expect(await lines()).toEqual([]);
  });
});
