import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A RETRY RETURNS THE SAME ENTRY (J39/J40 PR 3B; Security Lead C3.5, re-walk N1).
 *
 * "Ask to play" on a weak signal can lose its answer, and the guest presses again. The press carries a nonce of at
 * least 128 bits, made when the form is drawn; the server keeps its KEYED HASH with the pass, bound to the event and to
 * this browser's device, for fifteen minutes. So:
 *
 *   - the same nonce from the same device inside the window is the same entry: no second row, the same cookie again
 *   - the same nonce from ANOTHER device gains nothing of the first entry (it is ignored)
 *   - after the window the nonce is ignored and the normal rules apply
 *   - a retry is never matched on the NAME: two guests with one name are two entries
 *   - a nonce that is too short is refused (a 128-bit minimum)
 *
 * Break-it (seen red): match a retry on the name.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/a-retry-returns-the-same-entry.audit.test.ts
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
import { arrive, deviceValue, dropClub, makeClub, newNonce, randomAddress, type Club } from "./guest-entry-fixture";

const prisma = new PrismaClient();
const MARK = "zz-guest-entry-retry";
let club: Club;

const form = (name: string) => ({ name, handicap: "", invitedBy: "" });
const rows = () => prisma.player.count({ where: { eventId: club.eventId } });

describe("a retry returns the same entry", () => {
  beforeAll(async () => {
    await dropClub(prisma, MARK);
    club = await makeClub(prisma, MARK);
  });
  afterAll(async () => {
    try {
      await dropClub(prisma, MARK);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("the same nonce from the same device is the same entry, with the same code, and no second row", async () => {
    const address = randomAddress();
    const device = deviceValue();
    const nonce = newNonce();
    arrive(jar, head, { address, device });
    const first = await registerAsGuest(club.token, form("Robin Vale"), nonce);
    expect(first.ok).toBe(true);
    expect(await rows()).toBe(1);
    // The answer was lost: the browser has no cookie of the entry, tries again with the same nonce and device.
    arrive(jar, head, { address, device });
    const again = await registerAsGuest(club.token, form("Robin Vale"), nonce);
    expect(again).toMatchObject({ ok: true, status: "pending", already: true });
    expect(again.ok && first.ok && again.code).toBe(first.ok ? first.code : "");
    expect(await rows()).toBe(1);
    // And the cookie is set again, for the SAME pass.
    expect(jar.get("ng_guest")).toBeTruthy();
  });

  it("the same nonce from ANOTHER device gains nothing of the first entry", async () => {
    const nonce = newNonce();
    arrive(jar, head, { address: randomAddress(), device: deviceValue() });
    const first = await registerAsGuest(club.token, form("Tamsin Holloway"), nonce);
    expect(first.ok).toBe(true);
    const before = await rows();
    arrive(jar, head, { address: randomAddress(), device: deviceValue() });
    const other = await registerAsGuest(club.token, form("Idris Penmarch"), nonce);
    expect(other.ok).toBe(true);
    // A new entry of its own, with its own code: nothing of the first was returned.
    expect(other.ok && first.ok && other.code).not.toBe(first.ok ? first.code : "");
    expect(await rows()).toBe(before + 1);
  });

  it("after the window the nonce is ignored and the normal rules apply", async () => {
    const address = randomAddress();
    const device = deviceValue();
    const nonce = newNonce();
    arrive(jar, head, { address, device });
    expect((await registerAsGuest(club.token, form("Orla Brightwater"), nonce)).ok).toBe(true);
    // Sixteen minutes on.
    await prisma.playerPass.updateMany({ where: { eventId: club.eventId, player: { name: "Orla Brightwater" } }, data: { entryNonceAt: new Date(Date.now() - 16 * 60_000) } });
    const before = await rows();
    // The browser lost its cookie of the entry (a decline would have left it the same way): a new press, the same nonce.
    arrive(jar, head, { address, device });
    expect((await registerAsGuest(club.token, form("Orla Brightwater"), nonce)).ok).toBe(true);
    expect(await rows()).toBe(before + 1);
  });

  it("a retry is never matched on the name: two guests with one name are two entries", async () => {
    const before = await rows();
    arrive(jar, head, { address: randomAddress(), device: deviceValue() });
    expect((await registerAsGuest(club.token, form("Corwen Ashby"), newNonce())).ok).toBe(true);
    arrive(jar, head, { address: randomAddress(), device: deviceValue() });
    expect((await registerAsGuest(club.token, form("Corwen Ashby"), newNonce())).ok).toBe(true);
    expect(await rows()).toBe(before + 2);
  });

  it("a nonce shorter than 128 bits is refused, and writes nothing", async () => {
    const before = await rows();
    arrive(jar, head, { address: randomAddress(), device: deviceValue() });
    expect(await registerAsGuest(club.token, form("Short Nonce"), "abc123")).toEqual({ ok: false, error: GUEST_WORDS.noSend });
    expect(await registerAsGuest(club.token, form("Short Nonce"), undefined)).toEqual({ ok: false, error: GUEST_WORDS.noSend });
    expect(await rows()).toBe(before);
  });
});
