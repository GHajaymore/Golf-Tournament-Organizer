import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * ADDING A PLAYER TO A LOCKED TOURNAMENT IS REFUSED IN A SENTENCE.
 *
 * `addSignup` threw on a locked tournament, and the Add form was the one
 * control on Registration still offered while locked — so the organizer of a
 * live medal pressed Add and got the whole-page "Application error" (walked
 * 2026-09-27). Through the real action and a real organizer session: a locked
 * tournament answers `{ ok: false }` with a reason, writes no player, and the
 * same call on the same tournament unlocked succeeds — the control, so the
 * refusal is the lock and not something else about the fixture.
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
import { addSignup, importCsvSignups } from "@/app/actions/tournament";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-LOCKED-ADD";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();
let orgId = "";
let eventId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: orgId || "none" } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const entrant = (who: string) => ({
  name: `${TAG} ${who}`,
  email: at(who),
  // A free club needs a mobile from every entrant; Ofcom's drama range.
  phone: "07700 900656",
  handicap: 12,
});

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
        status: "live",
        configUnlocked: false,
      },
    })
  ).id;
  await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
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

describe("adding a player while setup is locked", () => {
  it("is refused with a reason, and writes nobody", async () => {
    const res = await addSignup(entrant("Late"));
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Configuration is locked. Unlock the tournament to change the field.");
    expect(await prisma.player.count({ where: { eventId } })).toBe(0);
  });

  it("a CSV import is refused the same way, and imports nobody", async () => {
    const csv = `name,email,phone,handicap\n${TAG} Csv,${at("csv")},07700 900657,10\n`;
    const res = await importCsvSignups(csv);
    expect(res.error).toBe("Configuration is locked. Unlock the tournament to change the field.");
    expect(res.imported).toBe(0);
    expect(await prisma.player.count({ where: { eventId } })).toBe(0);
  });

  it("goes through once setup is unlocked (the control)", async () => {
    await prisma.event.update({ where: { id: eventId }, data: { configUnlocked: true } });
    const res = await addSignup(entrant("Unlocked"));
    expect(res.ok, res.error).toBe(true);
    expect(await prisma.player.count({ where: { eventId } })).toBe(1);
    const csv = `name,email,phone,handicap\n${TAG} Csv,${at("csv")},07700 900657,10\n`;
    const imported = await importCsvSignups(csv);
    expect(imported.error, "the import's control").toBeFalsy();
    expect(imported.imported).toBe(1);
  });
});
