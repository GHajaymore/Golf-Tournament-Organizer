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

import { enterThisTournament, withdrawMyEntry } from "@/app/actions/enter";
import { recentChanges } from "@/lib/services/recent-changes";

/**
 * THE AUDIT LOG ON SCREEN (Ajay, 2026-09-27).
 *
 * A member withdrawing took the field from 19 to 18 with nothing saying who or
 * when; the log recorded it and no screen read the log. Asserted against real
 * rows through the actions a member uses:
 *
 *   - entering and withdrawing both land in the FIELD list, newest first;
 *   - a line holding a player's id reads back with their NAME;
 *   - the field list leaves money out; the full list keeps it (the control).
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-recent-changes";
const WHO = `${TAG}-${randomBytes(4).toString("hex")}@example.invalid`;
let eventId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  const user = await prisma.user.create({ data: { email: WHO, name: `${TAG} Member` }, select: { id: true, email: true, name: true } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "member" } });
  session.email = user.email;
  session.name = user.name;
  session.id = user.id;
  // Ofcom drama range — a free club needs a mobile from every entrant.
  await prisma.member.create({
    data: { organizationId: org.id, name: `${TAG} Roster Name`, email: user.email, handicap: 9, phone: "07700 900321" },
  });
  eventId = (
    await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${TAG} medal`,
        status: "registration",
        shape: "single",
        format: "stroke",
        formationRule: "balanced",
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        capacity: 40,
        registrationOpen: true,
        registrationApproval: "auto",
        registrationToken: randomBytes(6).toString("hex"),
        shareToken: randomBytes(10).toString("hex"),
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the field's record", () => {
  it("shows a member entering and then withdrawing, newest first", async () => {
    expect((await enterThisTournament(eventId)).ok).toBe(true);
    // Money lines naming players by id, as some writers do: one who stays in
    // the field, and the member — who then withdraws with no history, so
    // their row is deleted.
    const member = await prisma.player.findFirst({ where: { eventId }, select: { id: true } });
    const stays = await prisma.player.create({
      data: { eventId, name: `${TAG} Stays`, email: `${TAG}-stays@example.invalid`, handicap: 12, seed: 9, status: "confirmed" },
      select: { id: true },
    });
    await prisma.auditLog.create({
      data: {
        eventId,
        actor: "zz Organizer",
        action: "expense.settle",
        detail: `${member!.id} → ${stays.id} £20.00`,
      },
    });
    expect((await withdrawMyEntry(eventId)).ok).toBe(true);

    const field = await recentChanges(eventId, { only: "field" });
    expect(field.map((r) => r.kind)).toEqual(["Field", "Field"]);
    expect(field[0].what).toContain("withdrew their own entry");
    expect(field[1].what).toContain("entered themselves");
  });

  it("reads a player's id back as their name — and a departed one in words, never raw", async () => {
    const all = await recentChanges(eventId);
    const money = all.find((r) => r.kind === "Money");
    expect(money?.what).toBe(`someone no longer in the field → ${TAG} Stays £20.00`);
    expect(money?.what, "a raw id reached the screen").not.toMatch(/\bc[a-z0-9]{20,}\b/);
  });

  it("keeps money out of the field list and in the full one (the control)", async () => {
    expect((await recentChanges(eventId, { only: "field" })).some((r) => r.kind === "Money")).toBe(false);
    expect((await recentChanges(eventId)).some((r) => r.kind === "Money")).toBe(true);
  });
});
