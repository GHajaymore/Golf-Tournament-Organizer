import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

const session = { email: "", name: "", id: "" };
vi.mock("@/lib/auth", () => ({
  getSession: async () => (session.email ? { ...session } : null),
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { enterThisTournament } from "@/app/actions/enter";

/**
 * A DOUBLE TAP ENTERS A PLAYER ONCE (J46).
 *
 * `enterThisTournament` used to ask "is this person already down?" BEFORE it took
 * the event's intake lock, and create the row inside it. Two submissions arriving
 * together (a busy entry opening, a double tap on a slow phone) both found nobody,
 * both queued for the lock, and both created a row. The check now runs under the
 * lock, so the second request sees the first's row and gets the usual answer.
 *
 * Mutation: move the `already` lookup in `enter.ts` back above `withEventIntakeLock`
 * and this goes red (two rows, two successes). The overlap is a matter of
 * scheduling, so several pairs are fired, each on its own tournament.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-double-tap";
/** A fresh address every run: the entry limiter lives in Postgres and outlives this file's rows. */
const WHO = `${TAG}-${randomBytes(4).toString("hex")}`;
const PAIRS = 5;
const ALREADY = "Your name is already down for this one.";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

const events: string[] = [];

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: { email: `${WHO}@example.invalid`, name: `${TAG} Member Account` },
    select: { id: true, email: true, name: true },
  });
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: user.id, role: "member" },
  });
  session.email = user.email;
  session.name = user.name;
  session.id = user.id;
  await prisma.member.create({
    data: {
      organizationId: org.id,
      name: `${TAG} Roster Name`,
      email: user.email,
      handicap: 11.4,
      handicapType: "18",
      handicapSource: "manual",
      phone: "07700 900123",
    },
  });
  for (let i = 0; i < PAIRS; i++) {
    const ev = await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${TAG} tournament ${i}`,
        status: "registration",
        shape: "single",
        format: "stroke",
        formationRule: "balanced",
        dates: "",
        course: `${TAG} Course`,
        city: `${TAG} Town`,
        address: "",
        regDeadline: "",
        capacity: 40,
        registrationOpen: true,
        registrationApproval: "auto",
        registrationToken: randomBytes(6).toString("hex"),
        shareToken: randomBytes(10).toString("hex"),
      },
      select: { id: true },
    });
    events.push(ev.id);
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("one person's two entries at the same moment", () => {
  it("leaves exactly one row, and the second gets the already-entered answer", async () => {
    // The limiter allows six an hour per address and tournament; each pair is
    // its own tournament, so it never stands in the way of the rule under test.
    for (const eventId of events) {
      const [a, b] = await Promise.all([enterThisTournament(eventId), enterThisTournament(eventId)]);

      const rows = await prisma.player.findMany({ where: { eventId }, select: { status: true } });
      expect(rows, "a double tap created two players").toHaveLength(1);

      const wins = [a, b].filter((r) => r.ok);
      const losses = [a, b].filter((r) => !r.ok);
      expect(wins).toHaveLength(1);
      expect(wins[0].status).toBe("confirmed");
      expect(losses).toHaveLength(1);
      expect(losses[0].error).toBe(ALREADY);
      expect(losses[0].status).toBe("confirmed");
    }
  });
});
