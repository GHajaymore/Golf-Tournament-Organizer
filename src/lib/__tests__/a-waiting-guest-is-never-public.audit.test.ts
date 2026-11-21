import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A WAITING GUEST IS NEVER PUBLIC (J39/J40 PR 3B; Security Lead C1.11).
 *
 * A guest who has asked to play and not yet been approved takes no place and is on no list a stranger can read: not
 * the sign-up page's "places left", and not the member's form. Their name is staff's to read on Entries, and nobody
 * else's. Measured on the public reader of the sign-up page: forty waiting guests leave its count of places unchanged.
 *
 * Break-it (seen red): count waiting guests in the public reader (drop its `status: "confirmed"` filter).
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/a-waiting-guest-is-never-public.audit.test.ts
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
import { openRegistrationView } from "@/lib/services/registration";
import { arrive, deviceValue, dropClub, makeClub, newNonce, randomAddress, type Club } from "./guest-entry-fixture";

const prisma = new PrismaClient();
const MARK = "zz-guest-entry-public";
let club: Club;

describe("a waiting guest is never public", () => {
  beforeAll(async () => {
    await dropClub(prisma, MARK);
    club = await makeClub(prisma, MARK, { capacity: 40 });
  });
  afterAll(async () => {
    try {
      await dropClub(prisma, MARK);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("forty waiting guests leave the public count of places where it was", async () => {
    const before = await openRegistrationView(club.token);
    expect(before?.spotsLeft).toBe(40);
    for (let i = 0; i < 40; i += 1) {
      arrive(jar, head, { address: randomAddress(), device: deviceValue() });
      expect((await registerAsGuest(club.token, { name: `Waiting ${i + 1} Vale`, handicap: "", invitedBy: "" }, newNonce())).ok).toBe(true);
    }
    const after = await openRegistrationView(club.token);
    expect(after?.spotsLeft).toBe(40);
    expect(after?.waitlistOnly).toBe(false);
    expect(JSON.stringify(after)).not.toContain("Waiting");
  });
});
