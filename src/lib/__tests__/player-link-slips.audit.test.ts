import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * PLAYER LINK SLIPS, AGAINST REAL ROWS (J39/J40 PR 3; design §3.1 and its abuse
 * cases). One club, two events. In the slips' event: two confirmed guests, a
 * waitlisted guest, a member with no email, a guest whose link is turned off; a
 * guest of the OTHER event. Every case is something the desk, a lost sheet or a
 * forged request would do:
 *
 *   - slips go to confirmed guests only, by name; members and waiting guests get none (D12)
 *   - a turned-off link gets no slip and is counted; an expired one likewise
 *   - each slip's code opens ITS guest's link, and the pass is stamped at that version
 *   - "only new" after printing is empty; after New link the slip is out of date and new again
 *   - a lost sheet's new links replace only this event's guests: a member's id and another
 *     event's guest's id make nothing
 *   - the code is never in the record
 *   - staff only, and never in a lapsed club's archive
 *
 * Fixtures: a `zz-link-slips-audit` club, invented names, `@example.invalid`, deleted in `finally`.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/player-link-slips.audit.test.ts
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
import { ensurePass, revokePass, rotatePass, passForCode } from "@/lib/services/player-link";
import { newLinksFor, printSlips, slipStateFor, slipSummary } from "@/lib/services/player-link-slips";
import { newPlayerLinksFor, playerLinkSlipState, printPlayerLinkSlips } from "@/app/actions/player-link-slips";

const prisma = new PrismaClient();
const MARK = "zz-link-slips-audit";
const STAFF_EMAIL = `${MARK}-staff@example.invalid`;

let eventId = "";
let otherEventId = "";
let robin = "";
let tamsin = "";
let waiting = "";
let member = "";
let off = "";
let otherGuest = "";
let staffUserId = "";

let seed = 1;
async function entry(ev: string, name: string, extra: { standing?: string; status?: string } = {}) {
  const p = await prisma.player.create({
    data: { eventId: ev, name, email: "", standing: extra.standing ?? "", status: extra.status ?? "confirmed", handicap: 12, seed: seed++ },
    select: { id: true },
  });
  return p.id;
}

async function event(orgId: string, name: string) {
  const ev = await prisma.event.create({
    data: {
      name: `${MARK} ${name}`,
      organizationId: orgId,
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

const refusedWith = async (p: Promise<unknown>) => {
  try {
    await p;
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

describe("player link slips", () => {
  beforeAll(async () => {
    await cleanUp();
    const org = await prisma.organization.create({ data: { name: `${MARK} Larkfield Golf Society`, kind: "club", timeZone: "UTC" }, select: { id: true } });
    eventId = await event(org.id, "Spring Outing");
    otherEventId = await event(org.id, "Summer Medal");
    robin = await entry(eventId, "Robin Vale", { standing: "guest" });
    tamsin = await entry(eventId, "Tamsin Holloway", { standing: "guest" });
    waiting = await entry(eventId, "Idris Penmarch", { standing: "guest", status: "waitlisted" });
    member = await entry(eventId, "Esme Fairholt");
    off = await entry(eventId, "Orla Brightwater", { standing: "guest" });
    otherGuest = await entry(otherEventId, "Corwen Ashby", { standing: "guest" });
    await ensurePass(eventId, off, "fixture");
    await revokePass(eventId, off, "fixture");
    const staff = await prisma.user.create({ data: { email: STAFF_EMAIL, name: "Corin Abernethy", password: "x:unusable", emailVerifiedAt: new Date() } });
    staffUserId = staff.id;
    await prisma.account.create({ data: { eventId, name: "Corin Abernethy", email: STAFF_EMAIL, role: "admin" } });
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
    await prisma.event.update({ where: { id: eventId }, data: { endOn: "", archivedAt: null } });
  });

  it("slips go to confirmed guests of the event, by name; a turned-off link is counted, not printed", async () => {
    const before = await slipSummary(eventId);
    expect(before).toMatchObject({ all: 2, fresh: 2, printedAny: false, printedIds: [] });
    const printed = await printSlips(eventId, "Corin Abernethy", false);
    expect(printed.slips.map((s) => s.name)).toEqual(["Robin Vale", "Tamsin Holloway"]);
    expect(printed.turnedOff).toBe(1);
    expect(printed.expired).toBe(0);
    // The member, the waiting guest and the other event's guest were given no link at all.
    expect(await prisma.playerPass.count({ where: { playerId: { in: [member, waiting, otherGuest] } } })).toBe(0);
    // Each slip's code opens ITS guest's link, and the pass is stamped at that version.
    for (const s of printed.slips) {
      const pass = await passForCode(s.code);
      const id = s.name === "Robin Vale" ? robin : tamsin;
      expect(pass?.playerId).toBe(id);
      const row = await prisma.playerPass.findUniqueOrThrow({ where: { playerId: id } });
      expect(row.slipPrintedVersion).toBe(row.version);
      expect(row.slipPrintedAt).not.toBeNull();
    }
  });

  it("a second print of only the new slips is empty; New link makes one out of date and new again", async () => {
    expect((await printSlips(eventId, "x", true)).slips).toEqual([]);
    const summary = await slipSummary(eventId);
    expect(summary).toMatchObject({ all: 2, fresh: 0, printedAny: true });
    expect([...summary.printedIds].sort()).toEqual([robin, tamsin].sort());
    const oldCode = (await printSlips(eventId, "x", false)).slips.find((s) => s.name === "Robin Vale")!.code;
    const rotated = await rotatePass(eventId, robin, "x");
    expect(rotated.ok).toBe(true);
    expect(await slipStateFor(eventId, robin)).toMatchObject({ printed: true, outOfDate: true });
    expect(await passForCode(oldCode), "the old slip no longer opens").toBeNull();
    const fresh = await printSlips(eventId, "x", true);
    expect(fresh.slips.map((s) => s.name)).toEqual(["Robin Vale"]);
    expect(await slipStateFor(eventId, robin)).toMatchObject({ printed: true, outOfDate: false });
  });

  it("an expired link gets no slip (90 club days after the last round)", async () => {
    await prisma.event.update({ where: { id: eventId }, data: { endOn: "2020-01-01" } });
    const printed = await printSlips(eventId, "x", false);
    expect(printed.slips).toEqual([]);
    expect(printed.expired).toBe(2);
  });

  it("a lost sheet's new links replace this event's guests only: a member's or another event's id makes nothing", async () => {
    expect(await newLinksFor(eventId, [member, otherGuest, "not-an-id"], "x")).toBe(0);
    expect(await prisma.playerPass.count({ where: { playerId: { in: [member, otherGuest] } } })).toBe(0);
    const before = await prisma.playerPass.findUniqueOrThrow({ where: { playerId: tamsin }, select: { version: true } });
    expect(await newLinksFor(eventId, [tamsin], "x")).toBe(1);
    const after = await prisma.playerPass.findUniqueOrThrow({ where: { playerId: tamsin }, select: { version: true } });
    expect(after.version).toBe(before.version + 1);
    expect(await slipStateFor(eventId, member), "a member has no slip line").toBeNull();
    expect(await slipStateFor(otherEventId, tamsin), "another event's id for the guest").toBeNull();
  });

  it("the actions are staff's, refused in an archive, and never put a code on the record", async () => {
    expect(await refusedWith(printPlayerLinkSlips(false))).toBe("Not authenticated");
    expect(await refusedWith(newPlayerLinksFor([robin]))).toBe("Not authenticated");
    expect(await refusedWith(playerLinkSlipState(robin))).toBe("Not authenticated");
    expect(await createSession(staffUserId)).toBe(true);
    const r = await printPlayerLinkSlips(false);
    expect(r.ok).toBe(true);
    const codes = r.ok ? r.slips.map((s) => s.code) : [];
    expect(codes).toHaveLength(2);
    const lines = await prisma.auditLog.findMany({ where: { eventId, action: { startsWith: "player-link." } }, select: { detail: true } });
    for (const code of codes) expect(JSON.stringify(lines)).not.toContain(code);
    expect(lines.some((l) => l.detail === "Player link slips printed by Corin Abernethy (2)")).toBe(true);
    // A forged list with another event's guest in it makes nothing for them.
    expect(await newPlayerLinksFor([otherGuest])).toEqual({ ok: true, made: 0 });
    expect(await newPlayerLinksFor("not a list")).toMatchObject({ ok: false });
    expect(await playerLinkSlipState(robin)).toMatchObject({ ok: true, outOfDate: false });
    await prisma.event.update({ where: { id: eventId }, data: { archivedAt: new Date() } });
    expect(await refusedWith(printPlayerLinkSlips(false)), "an archived event prints no slips").not.toBe("");
  });
});
