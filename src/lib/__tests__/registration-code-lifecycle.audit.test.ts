import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE ENTRY CODE'S ONE LIFECYCLE, AND A CLASH THAT FAILS CLOSED (J39/J40 PR 3B; Security Lead C1.4, C1.5).
 *
 * The code is the sign-up LINK's typed form (`Event.registrationCode`), named for the link and not for guests:
 *
 *   - minted LAZILY by a staff press only, never on a public read, and only while a token exists
 *   - made once: the same code every press after
 *   - NOT ended by turning the guest switch off: the code still opens the email-proved member form, and only the guest
 *     button and `registerAsGuest` go (`guestEntryRefusal`)
 *   - drawn against BOTH tables (a round's `accessCode` and an event's code); a string held by both fails closed
 *
 * Break-its (seen red): mint at entries-open (a public read of the page mints one); end the code with the guest switch.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/registration-code-lifecycle.audit.test.ts
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
import { openCode } from "@/app/actions/code-box";
import { registerAsGuest } from "@/app/actions/guest-entry";
import { setGuestEntry, showRegistrationCode } from "@/app/actions/tournament";
import { openRegistrationView, closedRegistrationFor } from "@/lib/services/registration";
import { ensureRegistrationCode, drawRegistrationCode } from "@/lib/services/guest-entry";
import { CODE_WORDS } from "@/lib/domain/code-shape";
import { GUEST_WORDS } from "@/lib/domain/guest-entry";
import { formatAccessCode } from "@/lib/code-format";
import { arrive, dropClub, makeClub, newNonce, randomAddress, type Club } from "./guest-entry-fixture";

const prisma = new PrismaClient();
const MARK = "zz-guest-entry-life";
let club: Club;
let noToken: Club;
const codeOf = async (id: string) => (await prisma.event.findUnique({ where: { id }, select: { registrationCode: true } }))?.registrationCode ?? "";

describe("the entry code's one lifecycle", () => {
  beforeAll(async () => {
    for (const s of ["", "-bare"]) await dropClub(prisma, `${MARK}${s}`);
    club = await makeClub(prisma, MARK, { guestOpen: false });
    noToken = await makeClub(prisma, `${MARK}-bare`);
    await prisma.event.update({ where: { id: noToken.eventId }, data: { registrationToken: "", registrationOpen: false } });
  });
  afterAll(async () => {
    try {
      for (const s of ["", "-bare"]) await dropClub(prisma, `${MARK}${s}`);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("a public read of an event with a token and no code mints none", async () => {
    expect(await codeOf(club.eventId)).toBe("");
    expect(await openRegistrationView(club.token)).not.toBeNull();
    await closedRegistrationFor(club.token);
    arrive(jar, head, { address: randomAddress() });
    await registerAsGuest(club.token, { name: "Robin Vale", handicap: "", invitedBy: "" }, newNonce());
    expect(await codeOf(club.eventId), "no public door makes the code").toBe("");
  });

  it("it is made by a staff press only, once, and only while a token exists", async () => {
    // No token: nothing to be the short form of.
    expect(await ensureRegistrationCode(noToken.eventId)).toBeNull();
    expect(await codeOf(noToken.eventId)).toBe("");
    // Show code, as staff: made on the press, the same every press after.
    expect(await createSession(club.staffUserId)).toBe(true);
    const shown = await showRegistrationCode();
    expect(shown.ok).toBe(true);
    const stored = await codeOf(club.eventId);
    expect(stored).toHaveLength(8);
    expect(shown.code).toBe(formatAccessCode(stored));
    expect((await showRegistrationCode()).code).toBe(shown.code);
    expect(await ensureRegistrationCode(club.eventId)).toBe(stored);
  });

  it("turning the guest switch ON makes one if there is none; turning it OFF does not end the code", async () => {
    await prisma.event.update({ where: { id: club.eventId }, data: { registrationCode: "" } });
    expect(await createSession(club.staffUserId)).toBe(true);
    expect((await setGuestEntry(true)).ok).toBe(true);
    const code = await codeOf(club.eventId);
    expect(code).toHaveLength(8);
    expect((await setGuestEntry(false)).ok).toBe(true);
    // The code stays, and still opens the (email-proved) member form...
    expect(await codeOf(club.eventId)).toBe(code);
    arrive(jar, head, { address: randomAddress(), device: false });
    expect(await openCode(code)).toEqual({ ok: true, kind: "entry", href: `/register/${club.token}` });
    // ...while the guest door itself is shut, in words, and writes nothing.
    arrive(jar, head, { address: randomAddress() });
    const guest = await registerAsGuest(club.token, { name: "Tamsin Holloway", handicap: "", invitedBy: "" }, newNonce());
    expect(guest).toEqual({ ok: false, error: GUEST_WORDS.notOpen });
    expect((await openRegistrationView(club.token))?.guestEntry).toBe(false);
    expect(await prisma.player.count({ where: { eventId: club.eventId } })).toBe(0);
  });

  it("a string held by a round and by an event fails closed (C1.5), and a minted code clashes with neither", async () => {
    const code = await codeOf(club.eventId);
    const stage = await prisma.stage.findFirstOrThrow({ where: { eventId: club.eventId }, select: { id: true } });
    await prisma.stage.update({ where: { id: stage.id }, data: { accessCode: code } });
    // The round's own settings must allow codes for the round half to match, so turn them on if the event has a switch.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      arrive(jar, head, { address: randomAddress(), device: false });
      expect(await openCode(code)).toEqual({ ok: false, error: CODE_WORDS.opensNothing });
      expect(spy.mock.calls.flat().join(" ")).toContain("matched both");
    } finally {
      spy.mockRestore();
      await prisma.stage.update({ where: { id: stage.id }, data: { accessCode: "" } });
    }
    // A drawn code is clear of both tables, however many draws it takes.
    for (let i = 0; i < 20; i += 1) {
      const drawn = await drawRegistrationCode();
      expect(await prisma.stage.count({ where: { accessCode: drawn } })).toBe(0);
      expect(await prisma.event.count({ where: { registrationCode: drawn } })).toBe(0);
    }
  });
});
