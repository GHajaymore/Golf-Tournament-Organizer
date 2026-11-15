import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE SUSPENSION SIREN SOUNDS FOR A GUEST (J39/J40 PR 2, G1; Rule 5.7).
 *
 * The player layout mounts `SuspensionAlarm` for every viewer, a guest's link
 * included, and the alarm polls `currentPlayStatus` every 20 seconds. That
 * action asked `getSession()`, which never answers for a link: a guest whose
 * screen was open when the committee stopped play heard nothing, and a member
 * looking through a link for another club's outing was asked about their own
 * club's event. Against real rows:
 *
 *   - a guest-only browser: suspended, then resumed, in the LINK's event
 *   - a browser signed in to club A holding a link for club B's outing: the
 *     siren follows the screen (B, as the guest), never A
 *   - having chosen "Your own account": A, as the screen then shows
 *   - an account alone: its own event, as before
 *   - nobody: never suspended
 *
 * Fixtures: `zz-siren` clubs, invented names, `@example.invalid`, deleted in
 * `finally`.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/the-siren-sounds-for-a-guest.audit.test.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());

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

import { createSession } from "@/lib/auth";
import { ensurePass } from "@/lib/services/player-link";
import { setGuestCookie, choosePlayerViewCookie } from "@/lib/guest-auth";
import { currentPlayStatus } from "@/app/actions/play-status";

const prisma = new PrismaClient();
const MARK = "zz-siren";
const MEMBER_EMAIL = `${MARK}-member@example.invalid`;

let aEvent = "";
let bEvent = "";
let guest = "";
let memberUserId = "";

async function clubWithEvent(name: string) {
  const org = await prisma.organization.create({ data: { name: `${MARK} ${name}`, kind: "club", timeZone: "UTC" }, select: { id: true } });
  const ev = await prisma.event.create({
    data: {
      name: `${MARK} ${name} Medal`,
      organizationId: org.id,
      status: "live",
      shape: "single",
      format: "stroke",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${MARK}-${name.replace(/\W/g, "")}-${Date.now()}`,
    },
    select: { id: true },
  });
  await prisma.stage.create({ data: { eventId: ev.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross" } });
  return ev.id;
}

async function cleanUp() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
}

async function holdLink() {
  const pass = await prisma.playerPass.findUniqueOrThrow({ where: { playerId: guest }, select: { id: true, version: true } });
  await setGuestCookie(pass.id, pass.version);
}

const suspend = (eventId: string, note: string) =>
  prisma.event.update({ where: { id: eventId }, data: { playSuspendedAt: new Date(), playSuspendedNote: note } });
const resume = (eventId: string) => prisma.event.update({ where: { id: eventId }, data: { playSuspendedAt: null, playSuspendedNote: "" } });

describe("the suspension siren follows the player screen's own event (G1)", () => {
  beforeAll(async () => {
    await cleanUp();
    aEvent = await clubWithEvent("Larkfield");
    bEvent = await clubWithEvent("Brackenmoor");
    const member = await prisma.user.create({ data: { email: MEMBER_EMAIL, name: "Wren Calloway", password: "x:unusable", emailVerifiedAt: new Date() } });
    memberUserId = member.id;
    await prisma.account.create({ data: { eventId: aEvent, name: "Wren Calloway", email: MEMBER_EMAIL, role: "player" } });
    await prisma.player.create({ data: { eventId: aEvent, name: "Wren Calloway", email: MEMBER_EMAIL, status: "confirmed", handicap: 10, seed: 1 } });
    const g = await prisma.player.create({
      data: { eventId: bEvent, name: "Robin Vale", email: "", standing: "guest", status: "confirmed", handicap: 12, seed: 1 },
      select: { id: true },
    });
    guest = g.id;
    const shown = await ensurePass(bEvent, guest, "Corin Abernethy");
    if (!shown.ok) throw new Error("the fixture's guest got no link");
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
    await resume(aEvent);
    await resume(bEvent);
  });

  it("nobody at all: never suspended", async () => {
    await suspend(bEvent, "Lightning");
    expect(await currentPlayStatus()).toEqual({ suspended: false, note: "" });
  });

  it("a guest's link alone: the siren sounds when play stops in its event, and stops when play resumes", async () => {
    await holdLink();
    expect((await currentPlayStatus()).suspended, "before: play is on").toBe(false);
    await suspend(bEvent, "Lightning on the course");
    expect(await currentPlayStatus(), "a guest heard nothing: the poll asked getSession(), which a link never answers").toEqual({
      suspended: true,
      note: "Lightning on the course",
    });
    await resume(bEvent);
    expect((await currentPlayStatus()).suspended, "after: play resumed").toBe(false);
  });

  it("signed in to club A and holding a link for club B's outing: the siren follows the screen (B, as the guest), never A", async () => {
    expect(await createSession(memberUserId)).toBe(true);
    await holdLink();
    await suspend(bEvent, "Fog");
    expect((await currentPlayStatus()).suspended, "B is suspended and the screen is B's").toBe(true);
    await resume(bEvent);
    await suspend(aEvent, "Club A only");
    expect((await currentPlayStatus()).suspended, "A's suspension sounded on B's screen").toBe(false);
  });

  it("having chosen 'Your own account': A, which the screen then shows", async () => {
    expect(await createSession(memberUserId)).toBe(true);
    await holdLink();
    await choosePlayerViewCookie("account");
    await suspend(aEvent, "Club A only");
    expect((await currentPlayStatus()).suspended).toBe(true);
    await resume(aEvent);
    await suspend(bEvent, "Fog");
    expect((await currentPlayStatus()).suspended, "the link's event sounded on the account's screen").toBe(false);
  });

  /**
   * WHEN THE LINK STOPS SPEAKING (#1132 review, PE-2 and SEC-1). The poll must keep asking the LIVE
   * pass: a "cheaper" resolver for a 20-second poll is exactly how a dead link would start answering.
   */
  describe("a link that no longer speaks", () => {
    afterEach(async () => {
      await prisma.playerPass.updateMany({ where: { playerId: guest }, data: { revokedAt: null, revokedBy: "" } });
      await prisma.player.update({ where: { id: guest }, data: { status: "confirmed" } });
    });

    it("turned off: a guest alone hears nothing of B; beside an account, the siren follows A", async () => {
      await holdLink();
      await prisma.playerPass.updateMany({ where: { playerId: guest }, data: { revokedAt: new Date(), revokedBy: "zz" } });
      await suspend(bEvent, "Fog");
      expect((await currentPlayStatus()).suspended, "a turned-off link still answered the siren").toBe(false);
      expect(await createSession(memberUserId)).toBe(true);
      await suspend(aEvent, "Club A only");
      expect((await currentPlayStatus()).suspended, "the account's own event").toBe(true);
      await resume(aEvent);
      expect((await currentPlayStatus()).suspended, "B's suspension through a dead link").toBe(false);
    });

    it("replaced by New link: the old version answers nothing", async () => {
      await holdLink();
      const pass = await prisma.playerPass.findUniqueOrThrow({ where: { playerId: guest }, select: { version: true } });
      await prisma.playerPass.updateMany({ where: { playerId: guest }, data: { version: pass.version + 1 } });
      try {
        await suspend(bEvent, "Fog");
        expect((await currentPlayStatus()).suspended, "a replaced link still answered the siren").toBe(false);
      } finally {
        await prisma.playerPass.updateMany({ where: { playerId: guest }, data: { version: pass.version } });
      }
    });

    it("a waiting guest's link answers only for its own event, never another's", async () => {
      await prisma.player.update({ where: { id: guest }, data: { status: "pending" } });
      await holdLink();
      await suspend(aEvent, "Club A only");
      expect((await currentPlayStatus()).suspended, "another club's suspension reached a waiting guest").toBe(false);
      await suspend(bEvent, "Fog");
      expect((await currentPlayStatus()).suspended, "its own event's fact, as its waiting card's layout would show").toBe(true);
    });

    it("D-1: an account that reaches the link's event acts as itself, so the siren follows the account's own event", async () => {
      const { organizationId } = await prisma.event.findUniqueOrThrow({ where: { id: bEvent }, select: { organizationId: true } });
      await prisma.organizationMember.create({ data: { organizationId: organizationId!, userId: memberUserId, role: "member" } });
      try {
        expect(await createSession(memberUserId)).toBe(true);
        await holdLink();
        await suspend(bEvent, "Fog");
        expect((await currentPlayStatus()).suspended, "the link spoke beside an account that reaches its event").toBe(false);
        await suspend(aEvent, "Club A only");
        expect((await currentPlayStatus()).suspended).toBe(true);
      } finally {
        await prisma.organizationMember.deleteMany({ where: { organizationId: organizationId!, userId: memberUserId } });
      }
    });
  });

  it("an account alone: its own event, as before", async () => {
    expect(await createSession(memberUserId)).toBe(true);
    await suspend(aEvent, "Heavy rain");
    expect(await currentPlayStatus()).toEqual({ suspended: true, note: "Heavy rain" });
  });
});
