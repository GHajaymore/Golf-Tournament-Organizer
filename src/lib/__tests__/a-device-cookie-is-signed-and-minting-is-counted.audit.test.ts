import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE DEVICE COOKIE IS SIGNED, AND MAKING ONE IS COUNTED (B96; Security Lead's finding on PR #1191).
 *
 *   - a bare well-formed `ng_device` (what a script sends), and one whose signature was altered, are NEW devices:
 *     each is counted in `guest-entry-cookieless`, so the eleventh from one address is refused and writes no row
 *   - a value WE signed is the device: it is not counted as cookieless
 *   - `startGuestEntry` mints a signed cookie; thirty phones on one wifi all mint while the platform alarm is quiet
 *   - with the alarm standing (300 mints an hour), a client gets twelve more, then the one limit sentence and NO cookie
 *   - a browser already holding a signed device mints nothing, alarm or not
 *
 * Break-its (seen red): accept an unsigned device (the forged cases are accepted); stop counting mints (the
 * thirteenth mint under the alarm succeeds).
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/a-device-cookie-is-signed-and-minting-is-counted.audit.test.ts
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

import { registerAsGuest, startGuestEntry } from "@/app/actions/guest-entry";
import { GUEST_WORDS } from "@/lib/domain/guest-entry";
import { clientKeyFor } from "@/lib/rate-limit";
import { RATE_LIMITS, windowFor } from "@/lib/domain/rate-limit";
import { signUnder, verifyUnder, sign } from "@/lib/auth";
import { openAnyCode } from "@/lib/services/code-door";
import { signedDeviceHere } from "@/lib/services/known-device";
import { arrive, deviceValue, dropClub, makeClub, newNonce, randomAddress, type Club } from "./guest-entry-fixture";

const prisma = new PrismaClient();
const MARK = "zz-guest-entry-b96";
let club: Club;

const enter = (name: string) => registerAsGuest(club.token, { name, handicap: "", invitedBy: "" }, newNonce());
const players = () => prisma.player.count({ where: { eventId: club.eventId } });

/** The platform alarm's own row, as `clientGuessGate("guest-mint-alarm", "guest-mint-platform")` keys it. */
function alarmKey(): string {
  return clientKeyFor("guest-mint-alarm", "guest-mint-platform", Date.now());
}
async function standTheAlarm(): Promise<void> {
  const expiresAt = new Date(windowFor(RATE_LIMITS["guest-mint-alarm"], Date.now()).endsAt);
  await prisma.rateLimitHit.upsert({ where: { key: alarmKey() }, create: { key: alarmKey(), count: 301, expiresAt }, update: { count: 301 } });
}
const lowerTheAlarm = () => prisma.rateLimitHit.deleteMany({ where: { key: alarmKey() } });

describe("the device cookie is signed and making one is counted", () => {
  beforeAll(async () => {
    await dropClub(prisma, MARK);
    club = await makeClub(prisma, MARK, { capacity: 144 });
  });
  afterAll(async () => {
    try {
      await lowerTheAlarm();
      await dropClub(prisma, MARK);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("a bare well-formed device value is a new device: ten are accepted, the eleventh is refused in words and writes no row", async () => {
    const address = randomAddress();
    for (let i = 0; i < 10; i += 1) {
      arrive(jar, head, { address, device: false });
      jar.set("ng_device", deviceValue()); // unsigned, as a script sends it
      const r = await enter(`Forged ${i + 1} Marlow`);
      expect(r.ok, `forged ${i + 1}: ${r.ok ? "" : r.error}`).toBe(true);
      expect(verifyUnder("ng_device", jar.get("ng_device"))).not.toBeNull(); // answered with a cookie WE signed
    }
    const before = await players();
    arrive(jar, head, { address, device: false });
    jar.set("ng_device", deviceValue());
    expect(await enter("Forged Eleven Marlow")).toEqual({ ok: false, error: GUEST_WORDS.limit });
    expect(await players()).toBe(before);
    // F1: the REFUSED request leaves with no signed device (a refusal never mints).
    expect(verifyUnder("ng_device", jar.get("ng_device"))).toBeNull();
  });

  it("a value signed under the app secret itself (not the device's own key) is not a device", async () => {
    arrive(jar, head, { address: randomAddress(), device: false });
    jar.set("ng_device", sign(deviceValue()));
    expect(await signedDeviceHere()).toBeNull();
    jar.set("ng_device", signUnder("ng_device", deviceValue()));
    expect(await signedDeviceHere()).not.toBeNull();
  });

  it("a refused cookieless request is the same whether it came first or last: ten more from one address never leave a signed device", async () => {
    const address = randomAddress();
    for (let i = 0; i < 10; i += 1) {
      arrive(jar, head, { address, device: false });
      await enter(`Cookieless ${i + 1} Pell`);
    }
    for (let i = 0; i < 3; i += 1) {
      arrive(jar, head, { address, device: false });
      expect(await enter(`Cookieless Over ${i + 1} Pell`)).toEqual({ ok: false, error: GUEST_WORDS.limit });
      expect(jar.get("ng_device"), `refused ${i + 1} must hold no cookie`).toBeUndefined();
    }
  });

  it("the code door mints a device only through the count: an open with no cookie is counted, and refused when the alarm and the slow bucket say so (F2)", async () => {
    await lowerTheAlarm();
    arrive(jar, head, { address: randomAddress() });
    const made = await enter("Door Holder Lindqvist");
    expect(made.ok && made.code).toBeTruthy();
    const code = made.ok ? (made.code as string) : "";
    const count = async () => (await prisma.rateLimitHit.findUnique({ where: { key: alarmKey() } }))?.count ?? 0;

    // Quiet alarm: a cookieless open mints, and the mint is counted.
    const quiet = randomAddress();
    arrive(jar, head, { address: quiet, device: false });
    const before = await count();
    const opened = await openAnyCode(code, quiet);
    expect(opened.ok, opened.ok ? "" : opened.error).toBe(true);
    expect(verifyUnder("ng_device", jar.get("ng_device"))).not.toBeNull();
    expect(await count()).toBe(before + 1);

    // Alarm standing, this network's twelve spent: the open still works, and no cookie is minted.
    await standTheAlarm();
    const busy = randomAddress();
    for (let i = 0; i < 12; i += 1) {
      arrive(jar, head, { address: busy, device: false });
      expect((await startGuestEntry()).ok, `mint ${i + 1}`).toBe(true);
    }
    arrive(jar, head, { address: busy, device: false });
    await openAnyCode(code, busy);
    expect(jar.get("ng_device")).toBeUndefined();
    await lowerTheAlarm();
  });

  it("a value whose signature was altered is counted the same way", async () => {
    const address = randomAddress();
    for (let i = 0; i < 10; i += 1) {
      arrive(jar, head, { address }); // signed
      const [value, mac] = jar.get("ng_device")!.split(".");
      jar.set("ng_device", `${value}.${mac!.slice(0, -1)}${mac!.endsWith("A") ? "B" : "A"}`);
      expect((await enter(`Tampered ${i + 1} Rowan`)).ok, `tampered ${i + 1}`).toBe(true);
    }
    arrive(jar, head, { address });
    const [value, mac] = jar.get("ng_device")!.split(".");
    jar.set("ng_device", `${value}.${mac!.slice(0, -1)}${mac!.endsWith("A") ? "B" : "A"}`);
    expect(await enter("Tampered Eleven Rowan")).toEqual({ ok: false, error: GUEST_WORDS.limit });
  });

  it("a signed device is not counted as cookieless", async () => {
    const address = randomAddress();
    for (let i = 0; i < 12; i += 1) {
      arrive(jar, head, { address });
      expect((await enter(`Signed ${i + 1} Hollis`)).ok, `signed ${i + 1}`).toBe(true);
    }
  });

  it("thirty phones on one wifi each mint a signed device while the alarm is quiet", async () => {
    await lowerTheAlarm();
    const address = randomAddress();
    for (let i = 0; i < 30; i += 1) {
      arrive(jar, head, { address, device: false });
      expect(await startGuestEntry(), `phone ${i + 1}`).toEqual({ ok: true });
      expect(verifyUnder("ng_device", jar.get("ng_device"))).not.toBeNull();
    }
  });

  it("with the alarm standing a client mints twelve, then is refused in words and gets no cookie", async () => {
    await standTheAlarm();
    const address = randomAddress();
    for (let i = 0; i < 12; i += 1) {
      arrive(jar, head, { address, device: false });
      expect((await startGuestEntry()).ok, `mint ${i + 1}`).toBe(true);
    }
    arrive(jar, head, { address, device: false });
    expect(await startGuestEntry()).toEqual({ ok: false, error: GUEST_WORDS.limit });
    expect(jar.get("ng_device")).toBeUndefined();
    // Another network is paced on its own; a browser holding a signed device mints nothing and is never refused.
    arrive(jar, head, { address, device: true });
    expect(await startGuestEntry()).toEqual({ ok: true });
  });
});
