import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE ENTRY CODE IS REDEEMED IN ONE PLACE (J39/J40 PR 3B; Security Lead C1.1, C1.2).
 *
 * The 8-character code under a sign-up poster is the typed form of the link, and only the one door for a typed code
 * redeems it. `registerAsGuest` takes the 114-bit TOKEN only: handed a valid entry code it gives the one neutral
 * refusal and writes no row (a second place to guess codes would not be guarded by the failed-lookup budget). A
 * successful typed code answers with the redirect to the sign-up page and nothing else: no name, no event fields, and
 * the code is never in the address.
 *
 * Break-it (seen red): let `registerAsGuest` accept a code (look the event up by `registrationCode` too).
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/entry-code-is-redeemed-in-one-place.audit.test.ts
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

import { guestEntryFor, registerAsGuest } from "@/app/actions/guest-entry";
import { openCode } from "@/app/actions/code-box";
import { GUEST_WORDS } from "@/lib/domain/guest-entry";
import { ensureRegistrationCode } from "@/lib/services/guest-entry";
import { arrive, dropClub, makeClub, newNonce, randomAddress, type Club } from "./guest-entry-fixture";

const prisma = new PrismaClient();
const MARK = "zz-guest-entry-one-place";
let club: Club;
let code = "";

const form = (code: string) => {
  const f = new FormData();
  f.set("code", code);
  return f;
};

describe("the entry code is redeemed in one place", () => {
  beforeAll(async () => {
    await dropClub(prisma, MARK);
    club = await makeClub(prisma, MARK);
    code = (await ensureRegistrationCode(club.eventId)) ?? "";
    expect(code).toHaveLength(8);
  });
  afterAll(async () => {
    try {
      await dropClub(prisma, MARK);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("registerAsGuest handed a valid entry code gets the neutral refusal and writes no row", async () => {
    arrive(jar, head, { address: randomAddress() });
    const r = await registerAsGuest(code, { name: "Robin Vale", handicap: "", invitedBy: "" }, newNonce());
    expect(r).toEqual({ ok: false, error: GUEST_WORDS.codeOpensNothing });
    expect(await prisma.player.count({ where: { eventId: club.eventId } })).toBe(0);
    // Nor with the code spelled as the poster prints it, nor padded out to token length.
    arrive(jar, head, { address: randomAddress() });
    const dashed = await registerAsGuest(`${code.slice(0, 4)}-${code.slice(4)}`, { name: "Robin Vale", handicap: "", invitedBy: "" }, newNonce());
    expect(dashed.ok).toBe(false);
    expect(await prisma.player.count({ where: { eventId: club.eventId } })).toBe(0);
  });

  it("a typed code answers with the redirect to the sign-up page and nothing else (C1.2)", async () => {
    arrive(jar, head, { address: randomAddress() });
    const opened = await openCode(code);
    expect(opened).toEqual({ ok: true, kind: "entry", href: `/register/${club.token}` });
    // The press that follows it, from a POST: a redirect, and the code is nowhere in it.
    arrive(jar, head, { address: randomAddress() });
    let digest = "";
    try {
      await guestEntryFor(null, form(code));
    } catch (e) {
      digest = String((e as { digest?: string }).digest ?? "");
    }
    expect(digest).toContain("NEXT_REDIRECT");
    expect(digest).toContain(`/register/${club.token}`);
    expect(digest).not.toContain(code);
    expect(JSON.stringify(opened)).not.toContain("zz-guest-entry");
  });
});
