import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A TYPED CODE NEVER NAMES AN EVENT (J39/J40 PR 3B; Security Lead C4.1 to C4.4).
 *
 * Only the 114-bit TOKEN may name an event whose entries have closed ("Entries for ‹event› closed on ‹day›"): it is not
 * guessable, and its holder saw the name while entries were open. The 38-bit CODE can be walked to list events, so a
 * real code at a closed event gets the neutral sentence, counted, and is never redirected to a page that names it: the
 * openness check runs BEFORE any token leaves the server.
 *
 *   - a closed event's typed code: the neutral answer, holding neither the token nor the name
 *   - a closed event's TOKEN: names the event and the day, and nothing else
 *   - unknown, rotated, not-yet-open and archived-club tokens: nothing (today's neutral page)
 *
 * Break-it (seen red): move the closing check after the redirect (`openEntry` answers with the address first).
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/a-typed-code-never-names-an-event.audit.test.ts
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
import { guestEntryFor } from "@/app/actions/guest-entry";
import { CODE_WORDS } from "@/lib/domain/code-shape";
import { closedRegistrationFor, openRegistrationView } from "@/lib/services/registration";
import { ensureRegistrationCode } from "@/lib/services/guest-entry";
import { generateShareToken } from "@/lib/codes";
import { arrive, dropClub, makeClub, randomAddress, type Club } from "./guest-entry-fixture";

const prisma = new PrismaClient();
const MARK = "zz-guest-entry-names";
let byHand: Club;
let byDay: Club;
let notYet: Club;
let archived: Club;
let live: Club;

describe("a typed code never names an event", () => {
  beforeAll(async () => {
    for (const s of ["", "-day", "-notyet", "-archived", "-live"]) await dropClub(prisma, `${MARK}${s}`);
    byHand = await makeClub(prisma, MARK, { override: true });
    byDay = await makeClub(prisma, `${MARK}-day`, { regDeadline: "2020-01-02" });
    notYet = await makeClub(prisma, `${MARK}-notyet`);
    await prisma.event.update({ where: { id: notYet.eventId }, data: { regOpens: "2999-01-01" } });
    archived = await makeClub(prisma, `${MARK}-archived`, { override: true });
    await prisma.event.update({ where: { id: archived.eventId }, data: { archivedAt: new Date() } });
    live = await makeClub(prisma, `${MARK}-live`);
  });
  afterAll(async () => {
    try {
      for (const s of ["", "-day", "-notyet", "-archived", "-live"]) await dropClub(prisma, `${MARK}${s}`);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("a real code of a closed event gets the neutral sentence, holding neither the token nor the name", async () => {
    for (const c of [byHand, byDay]) {
      const code = (await ensureRegistrationCode(c.eventId)) ?? "";
      arrive(jar, head, { address: randomAddress(), device: false });
      const answer = await openCode(code);
      expect(answer).toEqual({ ok: false, error: CODE_WORDS.opensNothing });
      const text = JSON.stringify(answer);
      expect(text).not.toContain(c.token);
      expect(text).not.toContain("Spring Outing");
      expect(text).not.toContain("zz-guest-entry");
      // And the box that takes it from the sign-up page never redirects it.
      const f = new FormData();
      f.set("code", code);
      arrive(jar, head, { address: randomAddress(), device: false });
      const state = await guestEntryFor(null, f);
      expect(state.error).toBe(CODE_WORDS.opensNothing);
    }
  });

  it("the TOKEN of a closed event names it and the day, and nothing else (C4.1)", async () => {
    const byDays = await closedRegistrationFor(byDay.token);
    expect(byDays).toMatchObject({ eventName: `${MARK}-day Spring Outing`, organizer: expect.any(String) });
    expect(byDays?.day).not.toBe("");
    expect(Object.keys(byDays ?? {}).sort()).toEqual(["day", "eventName", "organizer"]);
    // Stopped by hand: the day is left out.
    const hand = await closedRegistrationFor(byHand.token);
    expect(hand).toMatchObject({ eventName: `${MARK} Spring Outing`, day: "" });
  });

  it("unknown, rotated, not-yet-open and archived-club tokens name nobody (C4.2)", async () => {
    expect(await closedRegistrationFor(generateShareToken())).toBeNull();
    expect(await closedRegistrationFor("")).toBeNull();
    expect(await closedRegistrationFor(notYet.token)).toBeNull();
    expect(await closedRegistrationFor(archived.token)).toBeNull();
    // A live event is the member page, never the closed one.
    expect(await closedRegistrationFor(live.token)).toBeNull();
    expect(await openRegistrationView(live.token)).not.toBeNull();
    // A rotated token: the old one is gone.
    const old = live.token;
    await prisma.event.update({ where: { id: live.eventId }, data: { registrationToken: generateShareToken() } });
    expect(await closedRegistrationFor(old)).toBeNull();
    expect(await openRegistrationView(old)).toBeNull();
  });
});
