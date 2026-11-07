import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

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
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { createSession, setActiveEvent } from "@/lib/auth";
import { registerForEvent } from "@/app/actions/register";
import { addSignup } from "@/app/actions/tournament";

/**
 * A DOUBLE TAP ENTERS A PLAYER ONCE, AT THE OTHER TWO DOORS (J46).
 *
 * `a-double-tap-enters-once.audit.test.ts` holds the signed-in door
 * (`enterThisTournament`). The same gap was at the public entry link
 * (`registerForEvent`) and at the organizer's Add player (`addSignup`): each
 * asked "already entered?" before the intake lock and created inside it (the
 * organizer's door took no lock at all), so two presses at once both found
 * nobody. Both now ask again under `withEventIntakeLock`.
 *
 * Mutation: remove the in-lock duplicate check from `register.ts`, or from
 * `addSignup`, and the matching case goes red with two rows.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-double-tap-doors";
const RUN = randomBytes(4).toString("hex");
const PAIRS = 5;
const at = (who: string) => `${TAG}-${who}-${RUN}@example.invalid`;

let orgId = "";
let organizerId = "";
const events: { id: string; token: string }[] = [];

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { email: { startsWith: TAG } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: orgId || "none" } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  orgId = org.id;
  const organizer = await prisma.user.create({
    data: { email: at("organizer"), name: `${TAG} Organizer`, password: "x", emailVerifiedAt: new Date() },
    select: { id: true },
  });
  organizerId = organizer.id;
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: organizer.id, role: "owner" } });
  for (let i = 0; i < PAIRS; i++) {
    const token = randomBytes(6).toString("hex");
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
        registrationToken: token,
        shareToken: randomBytes(10).toString("hex"),
      },
      select: { id: true },
    });
    events.push({ id: ev.id, token });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the public entry link, pressed twice at once", () => {
  it("leaves one row, and the second is told they are already registered", async () => {
    for (const [i, ev] of events.entries()) {
      const form = {
        name: `${TAG} Link Person ${i}`,
        email: at(`link${i}`),
        handicap: "12",
        handicapType: "18",
        phone: "15551234567",
        preferredTee: "White",
      };
      const [a, b] = await Promise.all([registerForEvent(ev.token, form), registerForEvent(ev.token, form)]);
      expect(a.ok, a.error).toBe(true);
      expect(b.ok, b.error).toBe(true);
      expect([a, b].filter((r) => r.already), "exactly one press is told 'already'").toHaveLength(1);

      const rows = await prisma.player.count({ where: { eventId: ev.id } });
      expect(rows, "a double tap on the entry link created two players").toBe(1);
    }
  });
});

describe("the organizer's Add player, pressed twice at once", () => {
  it("leaves one row, and the second is refused as already in the field", async () => {
    for (const [i, ev] of events.entries()) {
      jar.clear();
      await createSession(organizerId);
      await setActiveEvent(ev.id);
      const input = { name: `${TAG} Added Person ${i}`, email: at(`added${i}`), handicap: 14 };
      const [a, b] = await Promise.all([addSignup(input), addSignup(input)]);

      const rows = await prisma.player.count({ where: { eventId: ev.id, email: at(`added${i}`) } });
      expect(rows, "a double press on Add player created two players").toBe(1);

      const wins = [a, b].filter((r) => r.ok);
      const losses = [a, b].filter((r) => !r.ok);
      expect(wins, JSON.stringify([a, b])).toHaveLength(1);
      expect(losses).toHaveLength(1);
      expect(losses[0].error).toBe(`${TAG} Added Person ${i} is already in the field with that email.`);
    }
  });
});
