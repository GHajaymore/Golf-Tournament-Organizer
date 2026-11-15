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
 *   A10 on: a row at the current version; the toggle says on; the send
 *       reaches it. New link: skipped AND deleted. Turn off, withdrawal: the
 *       same. The new phone turns notices on at the new version and is reached.
 *   A11 one browser, two identities: the account's `PushSubscription` and the
 *       guest's `PlayerPassPush` on the SAME endpoint both survive, and
 *       the toggle answers per viewer (`pushFingerprintsForViewer`).
 *   SEC-1 (#1133 review) "Forget me on this phone" changes no version, so it
 *       deletes the held pass's row for this endpoint itself; nobody else's.
 *   F-3 (#1133 security review; was SEC-2) Turn off removes the caller's OWN
 *       row on the endpoint, nobody else's: the browser's unsubscribe stops the
 *       phone, and the next send's 410 deletes the rest.
 *   F-1 a link holds at most `GUEST_PUSH_ROWS` phones (the oldest goes).
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
import { savePushSubscription, removePushSubscription } from "@/app/actions/push";
import { forgetThisPhone } from "@/app/actions/player-link";
import { sendPushTo, noticesOffAmong, pushFingerprintsForViewer, pushDeviceBudgetKey, GUEST_PUSH_ROWS } from "@/lib/services/push";
import { clearRateLimit } from "@/lib/rate-limit";
import { getPlayerViewer } from "@/lib/player-viewer";
import { endpointFingerprint, pushToggleState } from "@/lib/domain/push-device";
import { guestWhoKey } from "@/lib/domain/messaging";

const prisma = new PrismaClient();
const MARK = "zz-guest-push";
const MEMBER = `${MARK}-member@example.invalid`;
const PHONE_A = `https://push.example.invalid/${MARK}-a`;
const PHONE_B = `https://push.example.invalid/${MARK}-b`;
const SHARED = `https://push.example.invalid/${MARK}-shared`;
const KEYS = { p256dh: "zz-p256dh", auth: "zz-auth" };
/** Forget ends in `redirect("/p")` (QA finding G638-1 #2): the action's own answer is that redirect. */
const SENT_TO_P = { digest: expect.stringMatching(/^NEXT_REDIRECT;\w+;\/p;/) };

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
/** What the alerts toggle on Today says for this browser's endpoint: the screen's own route (`PushToggle`). */
async function onHere(endpoint: string): Promise<boolean> {
  const mine = await pushFingerprintsForViewer(await getPlayerViewer());
  return pushToggleState({ browserFingerprint: await endpointFingerprint(endpoint), mine }) === "on";
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

  beforeEach(async () => {
    jar.clear();
    sent.length = 0;
    // A full `push-device` budget for every fixture identity (F-1): this file presses the switch more
    // often than a person would, and the counters outlive a run. The budget itself is pressed in
    // push-subscription.audit.test.ts.
    await clearRateLimit("push-device", pushDeviceBudgetKey({ email: MEMBER, guest: null }));
    for (const playerId of [guest, quietGuest]) {
      const pass = await prisma.playerPass.findUnique({ where: { playerId }, select: { id: true } });
      if (pass) await clearRateLimit("push-device", pushDeviceBudgetKey({ email: "", guest: { passId: pass.id } }));
    }
  });

  it("A10: on at the current version, reached; New link skips AND deletes it; the new phone is reached at the new version", async () => {
    await holdLink(guest);
    expect(await onHere(PHONE_A), "before: off").toBe(false);
    expect((await savePushSubscription({ endpoint: PHONE_A, keys: KEYS })).ok).toBe(true);
    const row = await prisma.playerPassPush.findFirstOrThrow({ where: { endpoint: PHONE_A } });
    expect(row.passVersion).toBe(1);
    expect(await onHere(PHONE_A)).toBe(true);
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
    expect(await onHere(SHARED), "the account's row is not the guest's").toBe(false);
    expect((await savePushSubscription({ endpoint: SHARED, keys: KEYS })).ok).toBe(true);
    expect(await prisma.pushSubscription.count({ where: { endpoint: SHARED, email: MEMBER } }), "the guest's subscribe overwrote the account's").toBe(1);
    expect(await prisma.playerPassPush.count({ where: { endpoint: SHARED } })).toBe(1);
    expect(await onHere(SHARED)).toBe(true);
    jar.clear();
    expect(await createSession(memberUser)).toBe(true);
    expect(await onHere(SHARED)).toBe(true);
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

    await expect(forgetThisPhone(SHARED)).rejects.toMatchObject(SENT_TO_P);
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
    await expect(forgetThisPhone("not-a-url")).rejects.toMatchObject(SENT_TO_P);
    expect(await prisma.playerPassPush.count({ where: { endpoint: SHARED, pass: { playerId: quietGuest } } })).toBe(1);
  });

  it("F-3 (#1133 security review): Turn off removes the caller's OWN row on its endpoint — never another identity's, never another endpoint's", async () => {
    // The phone holds the account's row and the second guest's; the second guest presses Turn off.
    jar.clear();
    await holdLink(quietGuest);
    expect((await savePushSubscription({ endpoint: SHARED, keys: KEYS })).ok).toBe(true);
    expect((await removePushSubscription(SHARED)).ok).toBe(true);
    expect(await prisma.playerPassPush.count({ where: { endpoint: SHARED, pass: { playerId: quietGuest } } }), "the caller's own row stayed").toBe(0);
    expect(await prisma.pushSubscription.count({ where: { endpoint: SHARED } }), "a guest deleted an account's row by naming its endpoint").toBe(1);
    expect(await prisma.playerPassPush.count({ where: { endpoint: PHONE_B } }), "another phone was silenced").toBe(1);
    // The phone still stops for the account: the browser unsubscribes, the push service answers 410,
    // and the sender deletes the account's row at the next notice.
    const { default: webpush } = await import("web-push");
    const gone = vi.spyOn(webpush, "sendNotification").mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }));
    await push([MEMBER]);
    gone.mockRestore();
    expect(await prisma.pushSubscription.count({ where: { endpoint: SHARED } }), "an unsubscribed phone's other row was never cleared").toBe(0);
    // Refused without a viewer: nobody can silence a phone from outside.
    jar.clear();
    expect((await removePushSubscription(PHONE_B)).ok).toBe(false);
    expect(await prisma.playerPassPush.count({ where: { endpoint: PHONE_B } })).toBe(1);
    // The account turns its alerts on again in that browser, for A12.
    expect(await createSession(memberUser)).toBe(true);
    expect((await savePushSubscription({ endpoint: SHARED, keys: KEYS })).ok).toBe(true);
  });

  it("F-1 (#1133 security review): a link holds at most five phones; the oldest goes, a refreshed phone is the newest", async () => {
    jar.clear();
    await holdLink(quietGuest);
    const pass = await prisma.playerPass.findUniqueOrThrow({ where: { playerId: quietGuest }, select: { id: true } });
    const phone = (n: number) => `https://push.example.invalid/${MARK}-cap-${n}`;
    for (let n = 1; n <= GUEST_PUSH_ROWS; n += 1) expect((await savePushSubscription({ endpoint: phone(n), keys: KEYS })).ok).toBe(true);
    // Phone 1 turns alerts on again (a refresh): it is now the newest, so phone 2 is the oldest.
    expect((await savePushSubscription({ endpoint: phone(1), keys: KEYS })).ok).toBe(true);
    expect((await savePushSubscription({ endpoint: phone(GUEST_PUSH_ROWS + 1), keys: KEYS })).ok).toBe(true);
    const held = (await prisma.playerPassPush.findMany({ where: { passId: pass.id }, select: { endpoint: true } })).map((r) => r.endpoint);
    expect(held, "a link filed phone after phone without end").toHaveLength(GUEST_PUSH_ROWS);
    expect(held, "the oldest phone was kept").not.toContain(phone(2));
    expect(held, "the phone in use was dropped").toContain(phone(1));
    expect(held, "the newest phone was refused").toContain(phone(GUEST_PUSH_ROWS + 1));
    expect(GUEST_PUSH_ROWS).toBeLessThanOrEqual(5);
    // Only this pass: the account's and the other guest's rows are untouched.
    expect(await prisma.playerPassPush.count({ where: { endpoint: PHONE_B, pass: { playerId: guest } } })).toBe(1);
    await prisma.playerPassPush.deleteMany({ where: { passId: pass.id } });
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
