import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A GUEST'S NOTICES DIE WITH THEIR LINK (J39/J40 PR 2; the test plan's A10,
 * A11 and A12, against real rows).
 *
 * A guest turns notices on in a browser: a `PlayerPassPush` row bound to the
 * pass's VERSION. Then each way a link ends must stop the send at once — a
 * forwarded phone that turned notices on must not go on getting tee times
 * after the organizer pressed New link. The send is proved through the real
 * sender with `web-push` stubbed (never a test-only door in the app).
 *
 *   A10 on: a row at the current version; `pushIsOnHere` says on; the send
 *       reaches it. New link: skipped AND deleted. Turn off, withdrawal: the
 *       same. The new phone turns notices on at the new version and is reached.
 *   A11 one browser, two identities: the account's `PushSubscription` and the
 *       guest's `PlayerPassPush` on the SAME endpoint both survive, and
 *       `pushIsOnHere` answers per viewer.
 *   SEC-1 (#1133 review) "Forget me on this phone" changes no version, so it
 *       deletes the held pass's row for this endpoint itself; nobody else's.
 *   SEC-2 (#1133 review) Turn off is about the PHONE: every identity's row on
 *       the endpoint goes (a handed-on phone's previous holder's included), and
 *       no other endpoint's.
 *   A12 `noticesOffAmong` counts exactly the entries the sender would skip.
 *
 * Fixtures: `zz-guest-push`, invented names, `@example.invalid`, deleted in `finally`.
 */

const jar = vi.hoisted(() => new Map<string, string>());
const sent = vi.hoisted(() => [] as { endpoint: string; body: string }[]);

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
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async (sub: { endpoint: string }, body: string) => {
      sent.push({ endpoint: sub.endpoint, body });
      return {};
    },
  },
}));

process.env.VAPID_PUBLIC_KEY = "zz-public";
process.env.VAPID_PRIVATE_KEY = "zz-private";

import { createSession } from "@/lib/auth";
import { ensurePass, rotatePass, revokePass } from "@/lib/services/player-link";
import { getGuestSession, setGuestCookie } from "@/lib/guest-auth";
import { savePushSubscription, removePushSubscription, pushIsOnHere } from "@/app/actions/push";
import { forgetThisPhone } from "@/app/actions/player-link";
import { sendPushTo, noticesOffAmong } from "@/lib/services/push";
import { guestWhoKey } from "@/lib/domain/messaging";

const prisma = new PrismaClient();
const MARK = "zz-guest-push";
const MEMBER = `${MARK}-member@example.invalid`;
const PHONE_A = `https://push.example.invalid/${MARK}-a`;
const PHONE_B = `https://push.example.invalid/${MARK}-b`;
const SHARED = `https://push.example.invalid/${MARK}-shared`;
const KEYS = { p256dh: "zz-p256dh", auth: "zz-auth" };

let eventId = "";
let guest = "";
let quietGuest = "";
let member = "";
let noEmail = "";
let memberUser = "";

async function holdLink(playerId: string) {
  const pass = await prisma.playerPass.findUniqueOrThrow({ where: { playerId }, select: { id: true, version: true } });
  await setGuestCookie(pass.id, pass.version);
}
const endpointsSent = () => sent.map((s) => s.endpoint);
const push = (keys: string[]) => sendPushTo(keys, { title: "zz Tee time", body: "8:10", url: "/me", tag: "zz" }, { eventId });

async function cleanUp() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
  await prisma.pushSubscription.deleteMany({ where: { endpoint: { contains: MARK } } });
}

describe("a guest's notices die with their link", () => {
  beforeAll(async () => {
    await cleanUp();
    const org = await prisma.organization.create({ data: { name: `${MARK} Larkfield`, kind: "club", timeZone: "UTC" }, select: { id: true } });
    const ev = await prisma.event.create({
      data: {
        name: `${MARK} Spring Outing`,
        organizationId: org.id,
        status: "live",
        shape: "single",
        format: "stroke",
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${MARK}-${Date.now()}`,
      },
      select: { id: true },
    });
    eventId = ev.id;
    const mk = async (name: string, extra: { email?: string; standing?: string }, seed: number) =>
      (await prisma.player.create({ data: { eventId, name, email: extra.email ?? "", standing: extra.standing ?? "", status: "confirmed", handicap: 10, seed }, select: { id: true } })).id;
    guest = await mk("Robin Vale", { standing: "guest" }, 1);
    quietGuest = await mk("Tobin Quarrie", { standing: "guest" }, 2);
    member = await mk("Esme Fairholt", { email: MEMBER }, 3);
    noEmail = await mk("Alder Pennick", {}, 4);
    memberUser = (await prisma.user.create({ data: { email: MEMBER, name: "Esme Fairholt", password: "x:unusable", emailVerifiedAt: new Date() } })).id;
    await prisma.account.create({ data: { eventId, name: "Esme Fairholt", email: MEMBER, role: "player" } });
    for (const id of [guest, quietGuest]) {
      const shown = await ensurePass(eventId, id, "Corin Abernethy");
      if (!shown.ok) throw new Error("the fixture's guest got no link");
    }
  });

  afterAll(async () => {
    try {
      await cleanUp();
    } finally {
      await prisma.$disconnect();
    }
  });

  beforeEach(() => {
    jar.clear();
    sent.length = 0;
  });

  it("A10: on at the current version, reached; New link skips AND deletes it; the new phone is reached at the new version", async () => {
    await holdLink(guest);
    expect(await pushIsOnHere(PHONE_A), "before: off").toBe(false);
    expect((await savePushSubscription({ endpoint: PHONE_A, keys: KEYS })).ok).toBe(true);
    const row = await prisma.playerPassPush.findFirstOrThrow({ where: { endpoint: PHONE_A } });
    expect(row.passVersion).toBe(1);
    expect(await pushIsOnHere(PHONE_A)).toBe(true);
    await push([guestWhoKey(guest)]);
    expect(endpointsSent()).toEqual([PHONE_A]);
    // New link: the forwarded phone is out.
    sent.length = 0;
    expect((await rotatePass(eventId, guest, "Corin Abernethy")).ok).toBe(true);
    await push([guestWhoKey(guest)]);
    expect(endpointsSent(), "the old link's phone still buzzed after New link").toEqual([]);
    expect(await prisma.playerPassPush.count({ where: { endpoint: PHONE_A } }), "the old row is gone").toBe(0);
    // The new phone turns notices on at the new version, and is reached.
    jar.clear();
    await holdLink(guest);
    expect((await savePushSubscription({ endpoint: PHONE_B, keys: KEYS })).ok).toBe(true);
    expect((await prisma.playerPassPush.findFirstOrThrow({ where: { endpoint: PHONE_B } })).passVersion).toBe(2);
    await push([guestWhoKey(guest)]);
    expect(endpointsSent()).toEqual([PHONE_B]);
  });

  it("A10: a stale row the hygiene missed is still skipped by the sender's version check, and deleted", async () => {
    const pass = await prisma.playerPass.findUniqueOrThrow({ where: { playerId: guest } });
    await prisma.playerPassPush.create({ data: { passId: pass.id, passVersion: pass.version - 1, endpoint: `${PHONE_A}-stale`, ...KEYS } });
    await push([guestWhoKey(guest)]);
    expect(endpointsSent()).not.toContain(`${PHONE_A}-stale`);
    expect(await prisma.playerPassPush.count({ where: { endpoint: `${PHONE_A}-stale` } })).toBe(0);
  });

  it("A10: Turn off and withdrawal stop the send too", async () => {
    await push([guestWhoKey(guest)]);
    expect(endpointsSent()).toEqual([PHONE_B]);
    sent.length = 0;
    await prisma.player.update({ where: { id: guest }, data: { status: "withdrawn" } });
    await push([guestWhoKey(guest)]);
    expect(endpointsSent(), "a withdrawn guest's phone buzzed").toEqual([]);
    await prisma.player.update({ where: { id: guest }, data: { status: "confirmed" } });
    jar.clear();
    await holdLink(guest);
    expect((await savePushSubscription({ endpoint: PHONE_B, keys: KEYS })).ok).toBe(true);
    expect(await revokePass(eventId, guest, "Corin Abernethy")).toBe(true);
    await push([guestWhoKey(guest)]);
    expect(endpointsSent(), "a turned-off link's phone buzzed").toEqual([]);
    expect(await prisma.playerPassPush.count({ where: { pass: { playerId: guest } } })).toBe(0);
    await rotatePass(eventId, guest, "Corin Abernethy");
  });

  it("A11: one browser, two identities — both rows survive on one endpoint, and each viewer sees only its own", async () => {
    expect(await createSession(memberUser)).toBe(true);
    expect((await savePushSubscription({ endpoint: SHARED, keys: KEYS })).ok).toBe(true);
    jar.clear();
    await holdLink(guest);
    expect(await pushIsOnHere(SHARED), "the account's row is not the guest's").toBe(false);
    expect((await savePushSubscription({ endpoint: SHARED, keys: KEYS })).ok).toBe(true);
    expect(await prisma.pushSubscription.count({ where: { endpoint: SHARED, email: MEMBER } }), "the guest's subscribe overwrote the account's").toBe(1);
    expect(await prisma.playerPassPush.count({ where: { endpoint: SHARED } })).toBe(1);
    expect(await pushIsOnHere(SHARED)).toBe(true);
    jar.clear();
    expect(await createSession(memberUser)).toBe(true);
    expect(await pushIsOnHere(SHARED)).toBe(true);
  });

  it("SEC-1 (#1133 review): Forget me on this phone removes the held pass's row for THIS endpoint, and only it", async () => {
    // The phone from A11 holds the account's row and the guest's. A second guest's link was also
    // turned on in it, and the guest's own other phone is on too.
    jar.clear();
    await holdLink(quietGuest);
    expect((await savePushSubscription({ endpoint: SHARED, keys: KEYS })).ok).toBe(true);
    jar.clear();
    await holdLink(guest);
    expect((await savePushSubscription({ endpoint: PHONE_B, keys: KEYS })).ok).toBe(true);
    const version = (await prisma.playerPass.findUniqueOrThrow({ where: { playerId: guest } })).version;

    expect(await forgetThisPhone(SHARED)).toEqual({ ok: true });
    expect(await getGuestSession(), "the link is still held here").toBeNull();
    expect(await prisma.playerPassPush.count({ where: { endpoint: SHARED, pass: { playerId: guest } } }), "a forgotten phone kept the guest's notices").toBe(0);
    // Only this pass, only this endpoint: the other guest's row, the account's, and the guest's other phone stay.
    expect(await prisma.playerPassPush.count({ where: { endpoint: SHARED, pass: { playerId: quietGuest } } })).toBe(1);
    expect(await prisma.pushSubscription.count({ where: { endpoint: SHARED, email: MEMBER } })).toBe(1);
    expect(await prisma.playerPassPush.count({ where: { endpoint: PHONE_B, pass: { playerId: guest } } })).toBe(1);
    // Forget revokes nothing, so the version is unchanged and the sender would still pass `livePass`:
    // the row going is what stops the send.
    expect((await prisma.playerPass.findUniqueOrThrow({ where: { playerId: guest } })).version).toBe(version);
    await push([guestWhoKey(guest)]);
    expect(endpointsSent(), "the forgotten phone was still reached").toEqual([PHONE_B]);
    // A crafted endpoint is no endpoint: nothing else goes.
    await holdLink(quietGuest);
    expect(await forgetThisPhone("not-a-url")).toEqual({ ok: true });
    expect(await prisma.playerPassPush.count({ where: { endpoint: SHARED, pass: { playerId: quietGuest } } })).toBe(1);
  });

  it("SEC-2 (#1133 review): Turn off silences THIS PHONE — every identity's row on its endpoint, and no other endpoint", async () => {
    // The phone holds the account's row and the second guest's; the second guest presses Turn off.
    jar.clear();
    await holdLink(quietGuest);
    expect((await savePushSubscription({ endpoint: SHARED, keys: KEYS })).ok).toBe(true);
    expect((await removePushSubscription(SHARED)).ok).toBe(true);
    expect(await prisma.playerPassPush.count({ where: { endpoint: SHARED } })).toBe(0);
    expect(await prisma.pushSubscription.count({ where: { endpoint: SHARED } }), "a row nobody on this phone can see kept it buzzing").toBe(0);
    expect(await prisma.playerPassPush.count({ where: { endpoint: PHONE_B } }), "another phone was silenced").toBe(1);
    // Refused without a viewer: nobody can silence a phone from outside.
    jar.clear();
    expect((await removePushSubscription(PHONE_B)).ok).toBe(false);
    expect(await prisma.playerPassPush.count({ where: { endpoint: PHONE_B } })).toBe(1);
    // The account turns its alerts on again in that browser, for A12.
    expect(await createSession(memberUser)).toBe(true);
    expect((await savePushSubscription({ endpoint: SHARED, keys: KEYS })).ok).toBe(true);
  });

  it("A11: a push payload is a code-free notice that opens Today", async () => {
    await push([guestWhoKey(guest), MEMBER]);
    for (const s of sent) expect(JSON.parse(s.body).url).toBe("/me");
  });

  it("A12: the notices-off count is exactly the entries the sender skips", async () => {
    const all = [guest, quietGuest, member, noEmail];
    // guest: a live phone (PHONE_B at the current version, re-made); member: the shared endpoint; quietGuest and noEmail: none.
    jar.clear();
    await holdLink(guest);
    await savePushSubscription({ endpoint: PHONE_B, keys: KEYS });
    expect(await noticesOffAmong(eventId, all)).toBe(2);
    sent.length = 0;
    await push([guestWhoKey(guest), guestWhoKey(quietGuest), MEMBER]);
    expect(new Set(endpointsSent())).toEqual(new Set([PHONE_B, SHARED]));
    // The guest's phone goes stale (New link): the count rises by one, as the sender now skips it.
    await rotatePass(eventId, guest, "Corin Abernethy");
    expect(await noticesOffAmong(eventId, all)).toBe(3);
  });
});
