import "dotenv/config";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A PHONE THAT CHANGES HANDS STOPS CARRYING THE FIRST PERSON'S ALERTS
 * (2026-11-14, safety sweep G-4 — a Security Lead hole as much as a safety one).
 *
 * Signing out left the push subscription stamped with the first person's
 * address, so their "play is suspended" and tee times went on landing on a
 * phone they no longer held, and the toggle told the next person "alerts are
 * on" when nothing of theirs would ever arrive. Against real rows:
 *
 *   Sign out             forgets THIS device for the person signing out — as the
 *                        sign-out button sends it, and as a plain form posts it
 *   a stranger's device  sent by somebody else's sign-out: matches nothing
 *   nobody signed in     forgets nothing, whatever is sent
 *   Sign out everywhere  forgets every device of theirs, and nobody else's
 *   the toggle's list    the signed-in person's own devices, as fingerprints:
 *                        the next person on the handed-on phone is told "off"
 *
 * Fixtures: `zz-alerts-leave` users with `@example.invalid` addresses and
 * `push.example.invalid` endpoints, deleted in `finally`.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/signing-out-takes-this-phones-alerts.audit.test.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());
const went = vi.hoisted(() => ({ to: "" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => ({ get: () => null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    went.to = to;
  },
}));

import { sign } from "@/lib/auth";
import { sessionValue } from "@/lib/domain/session-token";
import { signOutAction, signOutEverywhereAction } from "@/app/actions/auth";
import { pushFingerprintsFor } from "@/lib/services/push";
import { endpointFingerprint, pushToggleState } from "@/lib/domain/push-device";

const prisma = new PrismaClient();
const MARK = `zz-alerts-leave-${process.pid}`;
const FIRST = `${MARK}-first@example.invalid`;
const SECOND = `${MARK}-second@example.invalid`;
/** The shared phone, a second phone of the first person's, and the second person's own phone. */
const SHARED = `https://push.example.invalid/${MARK}/shared`;
const FIRSTS_OTHER = `https://push.example.invalid/${MARK}/firsts-other`;
const SECONDS_OWN = `https://push.example.invalid/${MARK}/seconds-own`;

let firstCookie = "";

const as = (cookie: string) => {
  jar.clear();
  if (cookie) jar.set("ng_session", cookie);
  went.to = "";
};
const holders = async () =>
  Object.fromEntries(
    (await prisma.pushSubscription.findMany({ where: { endpoint: { contains: MARK } }, select: { endpoint: true, email: true } })).map((r) => [
      r.endpoint,
      r.email,
    ]),
  );
async function subscribeAll() {
  // Signing out everywhere ends every earlier cookie; each test starts from both people signed in.
  await prisma.user.updateMany({ where: { email: { startsWith: MARK } }, data: { sessionsValidFrom: null } });
  await prisma.pushSubscription.deleteMany({ where: { endpoint: { contains: MARK } } });
  await prisma.pushSubscription.createMany({
    data: [
      { endpoint: SHARED, p256dh: "k", auth: "a", email: FIRST },
      { endpoint: FIRSTS_OTHER, p256dh: "k", auth: "a", email: FIRST },
      { endpoint: SECONDS_OWN, p256dh: "k", auth: "a", email: SECOND },
    ],
  });
}

beforeAll(async () => {
  const first = await prisma.user.create({ data: { email: FIRST, name: "Orla Fenwright", password: "x:unusable", emailVerifiedAt: new Date() } });
  await prisma.user.create({ data: { email: SECOND, name: "Bram Ellery", password: "x:unusable", emailVerifiedAt: new Date() } });
  firstCookie = sign(sessionValue(first.id, new Date(Date.now() - 60_000)));
});

beforeEach(subscribeAll);

afterAll(async () => {
  try {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: { contains: MARK } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("Sign out takes this phone's alerts with the person signing out", () => {
  it("CONTROL: before anybody signs out, each device is somebody's", async () => {
    expect(await holders()).toEqual({ [SHARED]: FIRST, [FIRSTS_OTHER]: FIRST, [SECONDS_OWN]: SECOND });
  });

  it("from the sign-out button: this device is forgotten, their other phone and nobody else's are not", async () => {
    as(firstCookie);
    await signOutAction(SHARED);
    expect(went.to).toBe("/");
    expect(jar.get("ng_session"), "the cookie is still in this browser").toBeUndefined();
    expect(await holders(), "the first person's alerts stayed on the phone they handed on").toEqual({ [FIRSTS_OTHER]: FIRST, [SECONDS_OWN]: SECOND });
  });

  it("from a plain form, before or without the page's script: the same", async () => {
    as(firstCookie);
    const form = new FormData();
    form.set("pushEndpoint", SHARED);
    await signOutAction(form);
    expect(await holders()).toEqual({ [FIRSTS_OTHER]: FIRST, [SECONDS_OWN]: SECOND });
  });

  it("somebody else's device, sent by another person's sign-out, matches nothing", async () => {
    as(firstCookie);
    await signOutAction(SECONDS_OWN);
    expect(await holders(), "one person's sign-out silenced another person's phone").toEqual({ [SHARED]: FIRST, [FIRSTS_OTHER]: FIRST, [SECONDS_OWN]: SECOND });
  });

  it("nobody signed in forgets nothing, whatever is sent", async () => {
    as("");
    for (const sent of [SHARED, SECONDS_OWN, { pushEndpoint: SHARED }, 42]) await signOutAction(sent);
    expect(await holders()).toEqual({ [SHARED]: FIRST, [FIRSTS_OTHER]: FIRST, [SECONDS_OWN]: SECOND });
  });

  it("with no device sent (no alerts on this browser), nothing is forgotten", async () => {
    as(firstCookie);
    await signOutAction();
    expect(await holders()).toEqual({ [SHARED]: FIRST, [FIRSTS_OTHER]: FIRST, [SECONDS_OWN]: SECOND });
  });
});

describe("Sign out everywhere", () => {
  it("forgets every device of theirs — the phone they no longer hold included — and nobody else's", async () => {
    as(firstCookie);
    await signOutEverywhereAction();
    expect(await holders(), "the first person's alerts survived signing out everywhere").toEqual({ [SECONDS_OWN]: SECOND });
  });
});

describe("the toggle on the handed-on phone", () => {
  it("is told 'on' for the person whose device it is, and 'off' for the next person", async () => {
    const browserFingerprint = await endpointFingerprint(SHARED);
    const firsts = await pushFingerprintsFor(FIRST);
    const seconds = await pushFingerprintsFor(SECOND);
    expect(firsts.sort()).toEqual([await endpointFingerprint(SHARED), await endpointFingerprint(FIRSTS_OTHER)].sort());
    expect(pushToggleState({ browserFingerprint, mine: firsts })).toBe("on");
    expect(pushToggleState({ browserFingerprint, mine: seconds }), "the next person was told the first person's alerts are theirs").toBe("off");
    // And once the first person has signed out of it, not even they are.
    as(firstCookie);
    await signOutAction(SHARED);
    expect(pushToggleState({ browserFingerprint, mine: await pushFingerprintsFor(FIRST) })).toBe("off");
    expect(await pushFingerprintsFor(null)).toEqual([]);
  });

  it("never hands the page an endpoint, only fingerprints", async () => {
    const all = (await pushFingerprintsFor(FIRST)).join(" ");
    expect(all).not.toContain("push.example.invalid");
    expect(all).not.toContain(MARK);
  });
});
