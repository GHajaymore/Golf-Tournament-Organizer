import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A MOVED ROUND TELLS THE FIELD — ACCOUNTS AND GUESTS (J39/J40 PR 2; the test
 * plan's A13, against real rows; proposal P2).
 *
 * The organizer moves a round's day with `setStagePlayedOn`, pressed as the
 * organizer. The send is proved through the real sender (`sendPushTo`) with
 * `web-push` stubbed, never a test-only door:
 *
 *   after launch, a move    one notice per reachable entry, an account and a
 *                           guest's link alike, in the club's words, tag
 *                           `moved-<stageId>`, a tap opens Today; and the
 *                           organizer's confirmation says how many cannot be reached
 *   clearing the day        tells ("no longer on")
 *   a first dating          tells nobody
 *   before launch           tells nobody
 *   the demo club           tells nobody
 *   a sender that throws    still saves the move
 *
 * Fixtures: `zz-round-moved`, invented names, `@example.invalid`, deleted in `finally`.
 */

const jar = vi.hoisted(() => new Map<string, string>());
const sent = vi.hoisted(() => ({ list: [] as { endpoint: string; body: string }[], fail: false }));

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
      if (sent.fail) throw new Error("push service down");
      sent.list.push({ endpoint: sub.endpoint, body });
      return {};
    },
  },
}));

process.env.VAPID_PUBLIC_KEY = "zz-public";
process.env.VAPID_PRIVATE_KEY = "zz-private";

import { createSession } from "@/lib/auth";
import { ensurePass } from "@/lib/services/player-link";
import { setStagePlayedOn } from "@/app/actions/tournament";

const prisma = new PrismaClient();
const MARK = "zz-round-moved";
const STAFF = `${MARK}-staff@example.invalid`;
const MEMBER = `${MARK}-member@example.invalid`;
const MEMBER_PHONE = `https://push.example.invalid/${MARK}-member`;
const GUEST_PHONE = `https://push.example.invalid/${MARK}-guest`;
const KEYS = { p256dh: "zz-p256dh", auth: "zz-auth" };

let orgId = "";
let eventId = "";
let stageId = "";
let staffUser = "";

/** Two weeks and three weeks from today, as club days (the club is in UTC). */
const dayAhead = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const D1 = dayAhead(14);
const D2 = dayAhead(21);

async function cleanUp() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
  await prisma.pushSubscription.deleteMany({ where: { endpoint: { contains: MARK } } });
}

const titles = () => sent.list.map((s) => JSON.parse(s.body) as { title: string; tag: string; url: string });

describe("a moved round tells the field", () => {
  beforeAll(async () => {
    await cleanUp();
    const org = await prisma.organization.create({ data: { name: `${MARK} Larkfield`, kind: "club", timeZone: "UTC", country: "GB" }, select: { id: true } });
    orgId = org.id;
    const ev = await prisma.event.create({
      data: {
        name: `${MARK} Autumn Medal`,
        organizationId: orgId,
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
    stageId = (await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross" }, select: { id: true } })).id;
    await prisma.stage.create({ data: { eventId, position: 1, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross" } });
    staffUser = (await prisma.user.create({ data: { email: STAFF, name: "Corin Abernethy", password: "x:unusable", emailVerifiedAt: new Date() } })).id;
    await prisma.account.create({ data: { eventId, name: "Corin Abernethy", email: STAFF, role: "admin" } });
    await prisma.player.create({ data: { eventId, name: "Esme Fairholt", email: MEMBER, status: "confirmed", handicap: 10, seed: 1 } });
    const guest = await prisma.player.create({ data: { eventId, name: "Robin Vale", email: "", standing: "guest", status: "confirmed", handicap: 12, seed: 2 }, select: { id: true } });
    await prisma.player.create({ data: { eventId, name: "Alder Pennick", email: "", status: "confirmed", handicap: 14, seed: 3 } });
    const shown = await ensurePass(eventId, guest.id, "Corin Abernethy");
    if (!shown.ok) throw new Error("no link");
    const pass = await prisma.playerPass.findUniqueOrThrow({ where: { playerId: guest.id } });
    await prisma.playerPassPush.create({ data: { passId: pass.id, passVersion: pass.version, endpoint: GUEST_PHONE, ...KEYS } });
    await prisma.pushSubscription.create({ data: { endpoint: MEMBER_PHONE, email: MEMBER, ...KEYS } });
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
    sent.list.length = 0;
    sent.fail = false;
    expect(await createSession(staffUser)).toBe(true);
    await prisma.event.update({ where: { id: eventId }, data: { status: "live" } });
    await prisma.organization.update({ where: { id: orgId }, data: { isDemo: false } });
  });

  it("a first dating tells nobody: nobody planned around a day that was not there", async () => {
    await prisma.stage.update({ where: { id: stageId }, data: { playedOn: "" } });
    expect((await setStagePlayedOn(stageId, D1)).ok).toBe(true);
    expect(sent.list).toEqual([]);
  });

  it("after launch, a move tells every reachable entry — the member and the guest's link — in the club's words", async () => {
    await prisma.stage.update({ where: { id: stageId }, data: { playedOn: D1 } });
    const res = await setStagePlayedOn(stageId, D2);
    expect(res.ok).toBe(true);
    expect(new Set(sent.list.map((s) => s.endpoint))).toEqual(new Set([MEMBER_PHONE, GUEST_PHONE]));
    for (const t of titles()) {
      expect(t.title).toMatch(/^Round 1 has moved to /);
      expect(t.tag, "a quick correction must replace the first notice").toBe(`moved-${stageId}`);
      expect(t.url).toBe("/me");
    }
    // The organizer is told how many could not be reached: the member with no email.
    expect(res.said).toContain("1 player has notices off. Tell them in person.");
    expect((await prisma.stage.findUniqueOrThrow({ where: { id: stageId } })).playedOn).toBe(D2);
  });

  it("clearing the day tells: no longer on it", async () => {
    await prisma.stage.update({ where: { id: stageId }, data: { playedOn: D2 } });
    expect((await setStagePlayedOn(stageId, "")).ok).toBe(true);
    expect(titles().map((t) => t.title)).toEqual(expect.arrayContaining([expect.stringMatching(/^Round 1 is no longer on /)]));
  });

  it("before launch, nobody is told", async () => {
    await prisma.event.update({ where: { id: eventId }, data: { status: "draft" } });
    await prisma.stage.update({ where: { id: stageId }, data: { playedOn: D1 } });
    await setStagePlayedOn(stageId, D2);
    expect(sent.list).toEqual([]);
  });

  it("the demo club tells nobody", async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { isDemo: true } });
    await prisma.stage.update({ where: { id: stageId }, data: { playedOn: D1 } });
    await setStagePlayedOn(stageId, D2);
    expect(sent.list).toEqual([]);
  });

  it("a push service that fails still saves the move", async () => {
    sent.fail = true;
    await prisma.stage.update({ where: { id: stageId }, data: { playedOn: D1 } });
    expect((await setStagePlayedOn(stageId, D2)).ok).toBe(true);
    expect((await prisma.stage.findUniqueOrThrow({ where: { id: stageId } })).playedOn).toBe(D2);
  });
});
