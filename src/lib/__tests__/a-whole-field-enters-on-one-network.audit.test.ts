import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A WHOLE FIELD ENTERS ON ONE NETWORK (J39/J40 PR 3B; Security Lead C1.7, D3, re-walk N2).
 *
 * A clubhouse is ONE network address. Guessing is a FAILED lookup; a real guest entering the real link is a SUCCESS,
 * and a success costs the network nothing. So:
 *
 *   - SIXTY browsers, each holding its device cookie, on ONE address are all accepted, and the cookieless bucket is
 *     untouched (proved below: the ten cookieless requests that follow are all accepted too)
 *   - the fourth entry from ONE browser is refused, in the one limit sentence
 *   - ten cookieless requests from one address are accepted; the eleventh is refused and writes no row
 *   - another event on the same address is untouched
 *   - the waiting cap holds: past `max(24, the field's limit)` the next is told the one sentence
 *
 * Break-its (seen red): count cookie-holding requests in the cookieless bucket (the sixty go red); delete the bucket
 * (the eleventh is accepted).
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/a-whole-field-enters-on-one-network.audit.test.ts
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

import { registerAsGuest } from "@/app/actions/guest-entry";
import { GUEST_WORDS } from "@/lib/domain/guest-entry";
import { arrive, dropClub, makeClub, newNonce, randomAddress, type Club } from "./guest-entry-fixture";

const prisma = new PrismaClient();
const MARK = "zz-guest-entry-network";
let club: Club;
let other: Club;

const enter = (c: Club, name: string) => registerAsGuest(c.token, { name, handicap: "", invitedBy: "" }, newNonce());

describe("a whole field enters on one network", () => {
  beforeAll(async () => {
    await dropClub(prisma, MARK);
    await dropClub(prisma, `${MARK}-b`);
    club = await makeClub(prisma, MARK, { capacity: 144 });
    other = await makeClub(prisma, `${MARK}-b`, { capacity: 64 });
  });
  afterAll(async () => {
    try {
      await dropClub(prisma, MARK);
      await dropClub(prisma, `${MARK}-b`);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("sixty browsers holding cookies on ONE address are all accepted, and the cookieless bucket is untouched", async () => {
    const address = randomAddress();
    for (let i = 0; i < 60; i += 1) {
      arrive(jar, head, { address });
      const r = await enter(club, `Guest ${i + 1} Vale`);
      expect(r.ok, `browser ${i + 1}: ${r.ok ? "" : r.error}`).toBe(true);
    }
    expect(await prisma.player.count({ where: { eventId: club.eventId, status: "pending", standing: "guest" } })).toBe(60);
    // The cookieless bucket reads 0: ten requests with no cookie, from the SAME address, are still all accepted.
    for (let i = 0; i < 10; i += 1) {
      arrive(jar, head, { address, device: false });
      const r = await enter(club, `Bare ${i + 1} Penmarch`);
      expect(r.ok, `cookieless ${i + 1}: ${r.ok ? "" : r.error}`).toBe(true);
    }
    // The eleventh cookieless request is refused in the one sentence, and writes no row.
    const before = await prisma.player.count({ where: { eventId: club.eventId } });
    arrive(jar, head, { address, device: false });
    const eleventh = await enter(club, "Bare Eleven Penmarch");
    expect(eleventh).toEqual({ ok: false, error: GUEST_WORDS.limit });
    expect(await prisma.player.count({ where: { eventId: club.eventId } })).toBe(before);
    // Another event on the same network is untouched by it.
    arrive(jar, head, { address, device: false });
    expect((await enter(other, "Elsewhere Holloway")).ok).toBe(true);
  });

  it("the fourth entry from ONE browser is refused (three an hour), in the one limit sentence", async () => {
    const address = randomAddress();
    const device = `${"x".repeat(42)}A`;
    let refused: unknown = null;
    for (let i = 0; i < 4; i += 1) {
      // A browser is one device: the same cookie each time. A decline between entries leaves it holding no pass.
      arrive(jar, head, { address, device });
      const r = await enter(club, `Repeat ${i + 1} Ashby`);
      if (i < 3) expect(r.ok, `entry ${i + 1}`).toBe(true);
      else refused = r;
    }
    expect(refused).toEqual({ ok: false, error: GUEST_WORDS.limit });
  });

  it("the waiting cap holds: past it the next is told the one sentence and no row is written", async () => {
    // A small field: the cap is max(24, the field's limit) = 24.
    const small = await makeClub(prisma, `${MARK}-c`, { capacity: 4 });
    try {
      const address = randomAddress();
      for (let i = 0; i < 24; i += 1) {
        arrive(jar, head, { address });
        expect((await enter(small, `Cap ${i + 1} Brightwater`)).ok, `waiting ${i + 1}`).toBe(true);
      }
      arrive(jar, head, { address });
      const over = await enter(small, "Cap Over Brightwater");
      expect(over).toEqual({ ok: false, error: GUEST_WORDS.limit });
      expect(await prisma.player.count({ where: { eventId: small.eventId } })).toBe(24);
    } finally {
      await dropClub(prisma, `${MARK}-c`);
    }
  });
});
