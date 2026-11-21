import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * EVERY FAILED ENTRY CODE COSTS THE SAME (J39/J40 PR 3B; Security Lead C1.3).
 *
 * An unknown code, a real code at an event whose entries have closed, and a real code at a club in its archive each
 * count ONE failed lookup against the client's budget (`round-code-client`) and none gives it back; only a lookup that
 * OPENS the sign-up page gives its attempt back. If a closed code gave its attempt back and an unknown one did not,
 * the counter itself would be an oracle for which codes are real.
 *
 * Break-it (seen red): a closed code giving its attempt back (`gate.opened()` before the openness check).
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/entry-code-failures-cost-the-same.audit.test.ts
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

import { openCode } from "@/app/actions/code-box";
import { clientKeyFor } from "@/lib/rate-limit";
import { CODE_WORDS } from "@/lib/domain/code-shape";
import { generateAccessCode } from "@/lib/codes";
import { ensureRegistrationCode } from "@/lib/services/guest-entry";
import { arrive, dropClub, makeClub, randomAddress, type Club } from "./guest-entry-fixture";

const prisma = new PrismaClient();
const MARK = "zz-guest-entry-same-cost";
let open: Club;
let closed: Club;
let archived: Club;
let openCodeWord = "";
let closedCodeWord = "";
let archivedCodeWord = "";

async function countOf(address: string): Promise<number> {
  const row = await prisma.rateLimitHit.findUnique({ where: { key: clientKeyFor("round-code-client", address, Date.now()) } });
  return row?.count ?? 0;
}
async function unknownCode(): Promise<string> {
  for (;;) {
    const c = generateAccessCode();
    if ((await prisma.event.count({ where: { registrationCode: c } })) === 0 && (await prisma.stage.count({ where: { accessCode: c } })) === 0) return c;
  }
}

describe("every failed entry code costs the same", () => {
  beforeAll(async () => {
    for (const m of [MARK, `${MARK}-closed`, `${MARK}-archived`]) await dropClub(prisma, m);
    open = await makeClub(prisma, MARK);
    // Closed by the organizer's own press (`registrationOverride: true`): a real token, a real code, entries shut.
    closed = await makeClub(prisma, `${MARK}-closed`, { override: true });
    archived = await makeClub(prisma, `${MARK}-archived`);
    await prisma.event.update({ where: { id: archived.eventId }, data: { archivedAt: new Date() } });
    openCodeWord = (await ensureRegistrationCode(open.eventId)) ?? "";
    closedCodeWord = (await ensureRegistrationCode(closed.eventId)) ?? "";
    archivedCodeWord = (await ensureRegistrationCode(archived.eventId)) ?? "";
  });
  afterAll(async () => {
    try {
      for (const m of [MARK, `${MARK}-closed`, `${MARK}-archived`]) await dropClub(prisma, m);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("five closed-but-real codes, five archived ones and five unknown ones each cost five, and nothing is given back", async () => {
    const closedClient = randomAddress();
    const archivedClient = randomAddress();
    const unknownClient = randomAddress();
    for (let i = 0; i < 5; i += 1) {
      arrive(jar, head, { address: closedClient, device: false });
      expect(await openCode(closedCodeWord)).toEqual({ ok: false, error: CODE_WORDS.opensNothing });
      arrive(jar, head, { address: archivedClient, device: false });
      expect(await openCode(archivedCodeWord)).toEqual({ ok: false, error: CODE_WORDS.opensNothing });
      arrive(jar, head, { address: unknownClient, device: false });
      expect(await openCode(await unknownCode())).toEqual({ ok: false, error: CODE_WORDS.opensNothing });
    }
    expect(await countOf(closedClient)).toBe(5);
    expect(await countOf(archivedClient)).toBe(5);
    expect(await countOf(unknownClient)).toBe(5);
  });

  it("a code that OPENS the sign-up page gives its attempt back", async () => {
    const client = randomAddress();
    arrive(jar, head, { address: client, device: false });
    expect(await openCode(await unknownCode())).toMatchObject({ ok: false });
    expect(await countOf(client)).toBe(1);
    expect(await openCode(openCodeWord)).toMatchObject({ ok: true, kind: "entry" });
    expect(await countOf(client)).toBe(1);
  });
});
