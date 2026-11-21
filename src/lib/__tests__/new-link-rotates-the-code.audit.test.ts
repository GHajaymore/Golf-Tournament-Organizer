import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * NEW LINK ROTATES THE CODE TOO (J39/J40 PR 3B; Security Lead C2.1 to C2.3).
 *
 * The code is the link's typed form, so one press replaces both: ONE `event.update` writes the new token and, where the
 * event already has a code, a new code (a partial rotation, new link and old code, cannot exist). With no code it writes
 * none (the code is lazy). The old code stops at once, counted as any failure; the old link is the neutral page; and
 * every guest's pass (version, lookup, sealed) and every waiting entry is untouched, because passes belong to entries,
 * not to the door.
 *
 * Break-its (seen red): rotate the token in one write and the code in a second; leave the old code live; bump pass
 * versions on rotate.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/new-link-rotates-the-code.audit.test.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());
const head = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => ({ get: (name: string) => head.get(name.toLowerCase()) ?? null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

import { createSession } from "@/lib/auth";
import { prisma as appPrisma } from "@/lib/db";
import { openCode } from "@/app/actions/code-box";
import { registerAsGuest } from "@/app/actions/guest-entry";
import { rotatePublicToken } from "@/app/actions/tournament";
import { openRegistrationView, closedRegistrationFor } from "@/lib/services/registration";
import { ensureRegistrationCode } from "@/lib/services/guest-entry";
import { CODE_WORDS } from "@/lib/domain/code-shape";
import { arrive, dropClub, makeClub, newNonce, randomAddress, type Club } from "./guest-entry-fixture";

const prisma = new PrismaClient();
const MARK = "zz-guest-entry-rotate";
let club: Club;
let lazy: Club;

describe("New link rotates the code too", () => {
  beforeAll(async () => {
    for (const s of ["", "-lazy"]) await dropClub(prisma, `${MARK}${s}`);
    club = await makeClub(prisma, MARK);
    lazy = await makeClub(prisma, `${MARK}-lazy`);
  });
  afterAll(async () => {
    try {
      for (const s of ["", "-lazy"]) await dropClub(prisma, `${MARK}${s}`);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("one write replaces the link and the code; the old code and the old link stop; passes and waiting entries are untouched", async () => {
    const oldCode = (await ensureRegistrationCode(club.eventId)) ?? "";
    arrive(jar, head, { address: randomAddress() });
    const entered = await registerAsGuest(club.token, { name: "Robin Vale", handicap: "", invitedBy: "Corin" }, newNonce());
    expect(entered.ok).toBe(true);
    const passBefore = await prisma.playerPass.findFirstOrThrow({ where: { eventId: club.eventId } });
    const playerBefore = await prisma.player.findFirstOrThrow({ where: { eventId: club.eventId } });

    expect(await createSession(club.staffUserId)).toBe(true);
    const update = vi.spyOn(appPrisma.event, "update");
    const rotated = await rotatePublicToken("registration");
    const writes = update.mock.calls.filter(([a]) => (a as { where: { id: string } }).where.id === club.eventId);
    update.mockRestore();
    expect(rotated.ok).toBe(true);
    // ONE write carrying BOTH secrets (C2.1).
    expect(writes).toHaveLength(1);
    const data = (writes[0][0] as { data: Record<string, unknown> }).data;
    expect(Object.keys(data).sort()).toEqual(["registrationCode", "registrationToken"]);

    const after = await prisma.event.findUniqueOrThrow({ where: { id: club.eventId } });
    expect(after.registrationToken).not.toBe(club.token);
    expect(after.registrationCode).not.toBe(oldCode);
    expect(after.registrationCode).toHaveLength(8);

    // The old code is dead at once, neutral and counted; the new code opens; the old link is the neutral page (C2.2).
    arrive(jar, head, { address: randomAddress(), device: false });
    expect(await openCode(oldCode)).toEqual({ ok: false, error: CODE_WORDS.opensNothing });
    expect(await openCode(after.registrationCode)).toEqual({ ok: true, kind: "entry", href: `/register/${after.registrationToken}` });
    expect(await openRegistrationView(club.token)).toBeNull();
    expect(await closedRegistrationFor(club.token)).toBeNull();

    // Every pass and every waiting entry is untouched (C2.3).
    const passAfter = await prisma.playerPass.findFirstOrThrow({ where: { eventId: club.eventId } });
    expect({ id: passAfter.id, version: passAfter.version, lookup: passAfter.lookup, sealed: passAfter.sealed, nonce: passAfter.entryNonceHash }).toEqual({
      id: passBefore.id,
      version: passBefore.version,
      lookup: passBefore.lookup,
      sealed: passBefore.sealed,
      nonce: passBefore.entryNonceHash,
    });
    const playerAfter = await prisma.player.findFirstOrThrow({ where: { eventId: club.eventId } });
    expect({ id: playerAfter.id, status: playerAfter.status, name: playerAfter.name }).toEqual({ id: playerBefore.id, status: "pending", name: "Robin Vale" });

    // One audit line, holding neither secret.
    const line = await prisma.auditLog.findFirstOrThrow({ where: { eventId: club.eventId, action: "rotate-registration-token" } });
    for (const secret of [club.token, after.registrationToken, oldCode, after.registrationCode]) expect(line.detail).not.toContain(secret);
  });

  it("an event with no code yet gets none from a rotation (the code is lazy)", async () => {
    expect(await createSession(lazy.staffUserId)).toBe(true);
    const rotated = await rotatePublicToken("registration");
    expect(rotated.ok).toBe(true);
    const after = await prisma.event.findUniqueOrThrow({ where: { id: lazy.eventId } });
    expect(after.registrationToken).not.toBe(lazy.token);
    expect(after.registrationCode).toBe("");
  });
});
