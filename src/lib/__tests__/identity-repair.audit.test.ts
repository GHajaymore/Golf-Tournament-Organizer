import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { loadRepair, applyRepair } from "@/lib/services/identity-repair";

/**
 * WHAT THE REPAIR DOES TO REAL ROWS.
 *
 * The decision is unit-tested in `domain/__tests__/identity-repair.test.ts`.
 * What cannot be tested there is the half that matters when this is pointed at
 * a club's live database: that a created member carries the entry's handicap
 * rather than a zero, that an entry it refuses to decide is genuinely left
 * untouched, that scorecards are not disturbed, and that a second pass changes
 * nothing.
 *
 * Run against a throwaway organization, never against Demo Cup. Demo Cup is
 * the marketing-screenshot fixture and the only populated tournament in the
 * development database; a test that repairs it would be a test that changes
 * the thing every other check reads.
 */

const MARK = "zz-idrepair";
const made: { orgs: string[]; events: string[] } = { orgs: [], events: [] };

async function makeOrg(label: string) {
  const user = await prisma.user.create({
    data: { email: `${MARK}-${Math.random().toString(36).slice(2, 8)}@example.invalid`, name: `${MARK} Owner` },
  });
  const org = await prisma.organization.create({
    data: { name: `${MARK} ${label}`, kind: "club", members: { create: { userId: user.id, role: "owner" } } },
  });
  made.orgs.push(org.id);
  const ev = await prisma.event.create({
    data: {
      name: `${MARK} ${label} Cup`,
      organizationId: org.id,
      dates: "2026-07-01",
      course: `${MARK} course`,
      city: "Nowhere",
      address: "1 Nowhere Lane",
      regDeadline: "2026-06-01",
      shareToken: `${MARK}-${Math.random().toString(36).slice(2, 10)}`,
    },
  });
  made.events.push(ev.id);
  return { org, ev };
}

let seed = 0;
const enter = (eventId: string, data: Record<string, unknown>) =>
  prisma.player.create({
    data: { eventId, name: "", email: "", seed: (seed += 1), status: "confirmed", ...data } as never,
  });

afterAll(async () => {
  // By the mark, per audit-guards: no row may depend on another to be found.
  const marked = await prisma.organization.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } });
  const ids = [...new Set([...marked.map((o) => o.id), ...made.orgs])];
  const evs = await prisma.event.findMany({ where: { organizationId: { in: ids } }, select: { id: true } });
  const evIds = [...new Set([...evs.map((e) => e.id), ...made.events])];
  await prisma.player.deleteMany({ where: { eventId: { in: evIds } } });
  await prisma.event.deleteMany({ where: { id: { in: evIds } } });
  await prisma.member.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.subscription.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
});

describe("repairing entries against a real roster", () => {
  it("links, creates and refuses — and leaves the refusal alone", async () => {
    const { org, ev } = await makeOrg("Mixed");

    const known = await prisma.member.create({
      data: { organizationId: org.id, name: `${MARK} Ada Finch`, email: `${MARK}-ada@example.invalid` },
    });
    // Two members of one name with no address between them: not separable.
    await prisma.member.create({ data: { organizationId: org.id, name: `${MARK} Dev Naru`, email: "" } });
    await prisma.member.create({ data: { organizationId: org.id, name: `${MARK} Dev Naru`, email: "" } });

    const byEmail = await enter(ev.id, { name: `${MARK} Ada Finch`, email: `${MARK}-ADA@example.invalid` });
    const stranger = await enter(ev.id, {
      name: `${MARK} Bram Cole`,
      email: `${MARK}-bram@example.invalid`,
      handicap: 12.4,
      handicapType: "9",
      handicapSource: "manual",
      phone: "+447700900123",
    });
    const ambiguous = await enter(ev.id, { name: `${MARK} Dev Naru`, email: "" });

    const summary = await applyRepair(await loadRepair(org.id));
    expect(summary.linked).toBe(1);
    expect(summary.created).toBe(1);
    expect(summary.ambiguous).toBe(1);

    // Linked to the member that already existed — not a second copy of them.
    expect((await prisma.player.findUnique({ where: { id: byEmail.id } }))!.memberId).toBe(known.id);

    /**
     * The created member carries what the organizer actually typed. A repair
     * that invented a member at handicap 0 would be worse than no repair: the
     * roster would then hold a scratch index for a 12.4 player, and the next
     * tournament they enter would be built from it.
     */
    const after = await prisma.player.findUnique({ where: { id: stranger.id } });
    expect(after!.memberId).not.toBeNull();
    const invented = await prisma.member.findUnique({ where: { id: after!.memberId! } });
    expect(invented!.handicap).toBe(12.4);
    expect(invented!.handicapType).toBe("9");
    expect(invented!.phone).toBe("+447700900123");
    expect(invented!.organizationId).toBe(org.id);

    // The one it could not decide is exactly as it was.
    expect((await prisma.player.findUnique({ where: { id: ambiguous.id } }))!.memberId).toBeNull();
  });

  it("changes nothing on a second pass", async () => {
    /**
     * The property the script's `--apply` depends on. If a repeat run did any
     * work, re-running the repair — which the script tells you to do — would
     * duplicate roster members on every pass.
     */
    const { org, ev } = await makeOrg("Twice");
    await enter(ev.id, { name: `${MARK} Elin Roche`, email: `${MARK}-elin@example.invalid` });
    await enter(ev.id, { name: `${MARK} Finn Abara`, email: "" });

    const first = await applyRepair(await loadRepair(org.id));
    expect(first.created).toBe(2);
    const membersAfterFirst = await prisma.member.count({ where: { organizationId: org.id } });

    const second = await applyRepair(await loadRepair(org.id));
    expect(second.linked).toBe(0);
    expect(second.created).toBe(0);
    expect(second.ok).toBe(2);
    expect(await prisma.member.count({ where: { organizationId: org.id } })).toBe(membersAfterFirst);
  });

  it("finishes an address-less pair on the second pass, rather than doubling it", async () => {
    /**
     * Two entries for one person nobody has on the roster. The planner cannot
     * see a member the same plan is about to create, so pass one creates two.
     * Pass two must then LINK rather than create again — which is what stops
     * the count growing every time somebody runs the script.
     *
     * This is the honest cost of that design, measured rather than asserted:
     * one duplicate roster row for a repeated name, visible to the organizer,
     * instead of an outcome that depends on database row order.
     */
    const { org, ev } = await makeOrg("Pair");
    await enter(ev.id, { name: `${MARK} Gita Moss`, email: "" });
    await enter(ev.id, { name: `${MARK} Gita Moss`, email: "" });

    const first = await applyRepair(await loadRepair(org.id));
    expect(first.created).toBe(2);

    const second = await applyRepair(await loadRepair(org.id));
    expect(second.created).toBe(0);
    expect(second.linked).toBe(0);
    expect(second.ok).toBe(2);
  });

  it("never reaches into another club's roster", async () => {
    // The correctness boundary: two clubs commonly share a member, and
    // matching across them would file an entry under the wrong tenant.
    const mine = await makeOrg("Mine");
    const theirs = await makeOrg("Theirs");
    await prisma.member.create({
      data: { organizationId: theirs.org.id, name: `${MARK} Hal Dreyer`, email: `${MARK}-hal@example.invalid` },
    });
    const entry = await enter(mine.ev.id, { name: `${MARK} Hal Dreyer`, email: `${MARK}-hal@example.invalid` });

    await applyRepair(await loadRepair(mine.org.id));

    const linked = await prisma.player.findUnique({ where: { id: entry.id } });
    const member = await prisma.member.findUnique({ where: { id: linked!.memberId! } });
    expect(member!.organizationId).toBe(mine.org.id);
    // And the other club gained nothing.
    expect(await prisma.member.count({ where: { organizationId: theirs.org.id } })).toBe(1);
  });

  it("does not touch scorecards, or anything but the link", async () => {
    /**
     * The reassurance a club needs before this is run on their live database.
     * A repair that moved a result would be unforgivable, and "it only sets
     * memberId" is worth asserting rather than reading off the source.
     */
    const { org, ev } = await makeOrg("Cards");
    const p = await enter(ev.id, { name: `${MARK} Ivy Nolan`, email: "", handicap: 7.7, status: "waitlisted" });
    const before = await prisma.player.findUnique({ where: { id: p.id } });

    await applyRepair(await loadRepair(org.id));

    const after = await prisma.player.findUnique({ where: { id: p.id } });
    expect(after!.memberId).not.toBeNull();
    for (const field of ["name", "email", "handicap", "status", "seed", "teeId", "groupId"] as const) {
      expect(after![field], field).toEqual(before![field]);
    }
  });
});
