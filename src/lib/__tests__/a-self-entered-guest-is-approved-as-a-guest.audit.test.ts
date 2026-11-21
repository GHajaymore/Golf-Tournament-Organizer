import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A SELF-ENTERED GUEST IS A WAITING GUEST, AND IS APPROVED AS A GUEST (J39/J40 PR 3B; design §3.3, Security Lead C1.8,
 * the Golf Pro's D1).
 *
 * Entering makes a WAITING entry and a pass, in `auto` approval mode too, and nothing else: no email, no phone, no tee,
 * no roster member, no account. Approval is the only way on, and:
 *
 *   - a guest named like a no-email roster MEMBER is approved as a guest of their own: that member's row (index, email,
 *     history) is unchanged and the guest holds a roster row of their own (`upsertMember(…, { guest: true })`)
 *   - in an event where ANY round is net, no figure is no approval: refused in words, nothing written; the committee's
 *     figure is stored as the entry's index; the course handicap is worked from it as for any player (a decimal index)
 *   - in a gross-only event no figure is asked: approved with none, stored as "none", never a scratch golfer
 *   - the figure is a payload validated at the boundary: NaN, Infinity, a string and out of range are refused
 *   - two approvals racing for the last place confirm ONE (counted and placed under the event's intake lock)
 *   - a waiting guest can do nothing: the entry holds no `teeId`, and approval is staff only
 *
 * Break-it (seen red): approval with `guest: false` (the stranger attaches to the member's row and history).
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/a-self-entered-guest-is-approved-as-a-guest.audit.test.ts
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
import { registerAsGuest } from "@/app/actions/guest-entry";
import { approveSignup } from "@/app/actions/tournament";
import { roundHandicapsFor } from "@/lib/services/round-handicap";
import { resolveRoundHandicap } from "@/lib/domain/round-handicap";
import { arrive, deviceValue, dropClub, makeClub, newNonce, randomAddress, type Club } from "./guest-entry-fixture";

const prisma = new PrismaClient();
const MARK = "zz-guest-entry-approve";
let net: Club;
let gross: Club;
let tiny: Club;
let rated: Club;

async function ask(club: Club, name: string, handicap = ""): Promise<string> {
  arrive(jar, head, { address: randomAddress(), device: deviceValue() });
  const r = await registerAsGuest(club.token, { name, handicap, invitedBy: "Corin" }, newNonce());
  expect(r.ok, `${name}: ${r.ok ? "" : r.error}`).toBe(true);
  const row = await prisma.player.findFirstOrThrow({ where: { eventId: club.eventId, name }, select: { id: true } });
  return row.id;
}
const asStaff = async (club: Club) => {
  jar.clear();
  expect(await createSession(club.staffUserId)).toBe(true);
};

describe("a self-entered guest is approved as a guest", () => {
  beforeAll(async () => {
    for (const s of ["-net", "-gross", "-tiny", "-rated"]) await dropClub(prisma, `${MARK}${s}`);
    net = await makeClub(prisma, `${MARK}-net`, { scoringBasis: "net" });
    gross = await makeClub(prisma, `${MARK}-gross`, { scoringBasis: "gross" });
    tiny = await makeClub(prisma, `${MARK}-tiny`, { scoringBasis: "gross", capacity: 1 });
    rated = await makeClub(prisma, `${MARK}-rated`, { scoringBasis: "net" });
    // Rated tees whose course rating is NOT their par: slope 130, rating 71.8, par 72 (the fixture's one tee).
    const course = await prisma.course.create({
      data: { organizationId: rated.orgId, name: `${MARK} Larkfield`, pars: JSON.stringify(new Array(18).fill(4)), yards: JSON.stringify(new Array(18).fill(380)), strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)) },
      select: { id: true },
    });
    const tee = await prisma.tee.create({ data: { courseId: course.id, name: "White", courseRating: 71.8, slopeRating: 130, par: 72 }, select: { id: true } });
    await prisma.event.update({ where: { id: rated.eventId }, data: { courseId: course.id, defaultTeeId: tee.id } });
    await prisma.stage.updateMany({ where: { eventId: rated.eventId }, data: { courseId: course.id, teeId: tee.id } });
  });
  afterAll(async () => {
    try {
      for (const s of ["-net", "-gross", "-tiny", "-rated"]) await dropClub(prisma, `${MARK}${s}`);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("entering makes a waiting entry with no email, no tee, no roster row and no account, in auto mode too", async () => {
    await prisma.event.update({ where: { id: gross.eventId }, data: { registrationApproval: "auto" } });
    const id = await ask(gross, "Robin Vale", "14.2");
    const p = await prisma.player.findUniqueOrThrow({ where: { id } });
    expect(p).toMatchObject({ status: "pending", standing: "guest", email: "", phone: "", teeId: null, memberId: null, handicap: 14.2 });
    expect(await prisma.member.count({ where: { organizationId: gross.orgId } })).toBe(0);
    expect(await prisma.account.count({ where: { eventId: gross.eventId, email: { not: gross.staffEmail } } })).toBe(0);
    expect(await prisma.playerPass.count({ where: { playerId: id } })).toBe(1);
    const note = await prisma.playerPass.findUniqueOrThrow({ where: { playerId: id }, select: { entryNote: true } });
    expect(note.entryNote).toBe("Corin");
  });

  it("a guest named like a no-email member is approved as a guest of their own; the member's row is unchanged (C1.8)", async () => {
    const member = await prisma.member.create({ data: { organizationId: net.orgId, name: "Esme Fairholt", email: "", handicap: 9.4, handicapSource: "manual" } });
    const id = await ask(net, "Esme Fairholt", "20");
    await asStaff(net);
    const approved = await approveSignup(id, 16.0);
    expect(approved).toEqual({ ok: true });
    const guest = await prisma.player.findUniqueOrThrow({ where: { id } });
    expect(guest.status).toBe("confirmed");
    // A roster row of their own, never the member's.
    expect(guest.memberId).not.toBeNull();
    expect(guest.memberId).not.toBe(member.id);
    const after = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    expect({ handicap: after.handicap, email: after.email, name: after.name }).toEqual({ handicap: 9.4, email: "", name: "Esme Fairholt" });
    expect(await prisma.member.count({ where: { organizationId: net.orgId, name: "Esme Fairholt" } })).toBe(2);
    // The committee's figure is the entry's index, stored as typed, and the audit line records both.
    expect(guest).toMatchObject({ handicap: 16, handicapSource: "manual" });
    const line = await prisma.auditLog.findFirstOrThrow({ where: { eventId: net.eventId, action: "approved" }, orderBy: { createdAt: "desc" } });
    expect(line.detail).toContain("declared 20, committee gave 16");
  });

  it("in an event with a net round, no figure is no approval: refused in words, nothing written", async () => {
    const id = await ask(net, "Tamsin Holloway");
    await asStaff(net);
    const refused = await approveSignup(id);
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/Type the handicap the committee gives Tamsin Holloway/);
    expect(await prisma.player.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "pending", memberId: null });
    // Typed: stored as an index, to a decimal, never read as strokes.
    expect(await approveSignup(id, 18.4)).toEqual({ ok: true });
    expect(await prisma.player.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "confirmed", handicap: 18.4, handicapSource: "manual" });
  });

  it("the committee's figure reaches the handicap resolution like any player's: the allowance is taken of the EXACT course handicap", async () => {
    /**
     * Worked from the Rules of Handicapping by hand, with decimal indexes (a route the code does not take):
     *   Course Handicap (exact) = Index x Slope / 113 + (Course Rating - Par) = 18.0 x 130 / 113 + (71.8 - 72)
     *                           = 2340 / 113 - 0.2 = 20.70796 - 0.2 = 20.50796   (a Course Handicap of 21 on the card)
     *   Playing Handicap        = allowance x EXACT Course Handicap, rounded ONCE, .5 up (6.2a): 95% of a stroke play
     *                             net round: 0.95 x 20.50796 = 19.4826, so 19.
     *   Taking the allowance of the ROUNDED 21 instead would give 0.95 x 21 = 19.95 = 20: the one-stroke error this
     *   figure is chosen to expose. Par difference: the round's one tee is the lowest par in the field, so none.
     */
    const id = await ask(rated, "Maelor Quince", "9");
    await asStaff(rated);
    expect(await approveSignup(id, 18.0)).toEqual({ ok: true });
    const stage = await prisma.stage.findFirstOrThrow({ where: { eventId: rated.eventId }, select: { id: true } });
    const row = (await roundHandicapsFor(rated.eventId, stage.id)).find((r) => r.playerId === id);
    expect(row, "the approved guest is in the round's field").toBeDefined();
    const resolved = resolveRoundHandicap({ member: row!.member, memberExact: row!.exact });
    expect(row!.exact).toBeCloseTo(20.50796, 4);
    expect(resolved.exact).toBeCloseTo(20.50796, 4);
    expect(row!.handicap).toBe(21);
    expect(row!.allowance).toBe(95);
    expect(row!.playing).toBe(19);
  });

  it("in a gross-only event no figure is asked: approved with none, never a scratch golfer", async () => {
    const id = await ask(gross, "Idris Penmarch");
    await asStaff(gross);
    expect(await approveSignup(id)).toEqual({ ok: true });
    expect(await prisma.player.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "confirmed", handicapSource: "none" });
  });

  it("the figure is validated at the boundary: NaN, Infinity, a string and out of range are refused, and nothing is written", async () => {
    const id = await ask(net, "Orla Brightwater");
    await asStaff(net);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "12", 99, -40, {}]) {
      const r = await approveSignup(id, bad);
      expect(r.ok, String(bad)).toBe(false);
      expect(await prisma.player.findUniqueOrThrow({ where: { id }, select: { status: true } })).toMatchObject({ status: "pending" });
    }
  });

  it("two approvals racing for the last place confirm one; the other waits on the list (counted under the lock)", async () => {
    const a = await ask(tiny, "Corwen Ashby");
    const b = await ask(tiny, "Brannoc Teague");
    await asStaff(tiny);
    const [x, y] = await Promise.all([approveSignup(a), approveSignup(b)]);
    expect(x.ok && y.ok).toBe(true);
    const states = (await prisma.player.findMany({ where: { id: { in: [a, b] } }, select: { status: true } })).map((p) => p.status).sort();
    expect(states).toEqual(["confirmed", "waitlisted"]);
  });

  it("only staff approve: a stranger, signed out, is refused and nothing moves", async () => {
    const id = await ask(gross, "Lowri Penhallow");
    jar.clear();
    await expect(approveSignup(id)).rejects.toThrow("Not authenticated");
    expect(await prisma.player.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "pending" });
  });
});
