import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A PAR TOURNAMENT CLOSES ON ITS OWN (Ajay, 2026-09-29) — the half of the Par
 * terms that holds whether or not anybody presses Complete.
 *
 *   - the daily sweep stamps `closesAt` the first time it sees golf, fourteen
 *     days on, and never moves it — the loophole Ajay spotted in the first
 *     draft was a clock that activity could keep pushing back;
 *   - on the day, the tournament is deleted — unless, at that moment, the club
 *     has upgraded, predates the terms, or holds it;
 *   - a Par tournament's rounds fall within seven days.
 *
 * Against real rows, with a keeping control for every deleting assertion.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-PAR-CLOSES";
const session = { email: "", name: `${TAG} organizer`, eventId: "", role: "admin", viewRole: "admin", userId: "", accountId: "" };

vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { stampParClocks, sweepClosedPar } = await import("@/lib/services/par-sweep");
const { setStagePlayedOn } = await import("@/app/actions/tournament");
const { drainWaitlist } = await import("@/lib/services/waitlist");
const { keepRound } = await import("@/app/actions/round-expiry");
const { peopleOwningSeveralParClubs } = await import("@/lib/services/close-terms");

const DAY = 24 * 3600 * 1000;
const NOW = new Date();
const iso = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * DAY).toISOString().slice(0, 10);
const emailFor = (who: string) => `zz-audit-par-closes-${who}@example.invalid`;
const WHO = ["par", "old", "birdie", "window", "window-old", "casual", "casual-old", "multi"];

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { in: WHO.map(emailFor) } } });
}

const orgs: Record<string, string> = {};

async function club(who: string, plan: string, termsApply: boolean) {
  const user = await prisma.user.create({ data: { email: emailFor(who), name: `${TAG} ${who}` } });
  const org = await prisma.organization.create({
    data: {
      name: `${TAG} ${who}`,
      kind: "personal",
      subscription: { create: { plan, planTermsApply: termsApply } },
      members: { create: { userId: user.id, role: "owner" } },
    },
  });
  orgs[who] = org.id;
  return org.id;
}

/** A live tournament with one round on each date given. */
async function tournament(orgId: string, name: string, dates: string[]) {
  return prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${name}`,
      dates: "", course: "", city: "", address: "", regDeadline: "",
      status: "live",
      shape: "series",
      shareToken: `${TAG}-${name}-${Date.now()}`.replace(/\s+/g, "-"),
      stages: {
        create: dates.map((d, i) => ({ position: i, type: "Stroke Play Round", format: "Stroke Play", playedOn: d })),
      },
    },
    include: { stages: true },
  });
}

const closesAt = async (id: string) => (await prisma.event.findUnique({ where: { id } }))?.closesAt ?? null;
const exists = async (id: string) => (await prisma.event.count({ where: { id } })) === 1;

beforeAll(async () => {
  await scrub();
  await club("par", "free", true);
  await club("old", "free", false);
  await club("birdie", "society", true);
});
afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

describe("the clock starts at the first golf, once", () => {
  it("stamps fourteen days after the first round whose day has come", async () => {
    const ev = await tournament(orgs.par, "dated", [iso(-3)]);
    await stampParClocks(NOW);
    const at = await closesAt(ev.id);
    expect(at?.toISOString().slice(0, 10)).toBe(new Date(new Date(`${iso(-3)}T00:00:00Z`).getTime() + 14 * DAY).toISOString().slice(0, 10));
  });

  it("stamps from the first result seen when no round is dated", async () => {
    const ev = await tournament(orgs.par, "undated", [""]);
    const player = await prisma.player.create({ data: { eventId: ev.id, name: `${TAG} Ann`, handicap: 10, seed: 1, status: "confirmed" } });
    await prisma.scorecard.create({ data: { eventId: ev.id, stageId: ev.stages[0].id, playerId: player.id, strokes: "[4,5,null]" } });
    await stampParClocks(NOW);
    expect((await closesAt(ev.id))?.getTime()).toBe(NOW.getTime() + 14 * DAY);
  });

  it("does not start a clock on nothing played — a round dated next week, an empty card", async () => {
    const ev = await tournament(orgs.par, "future", [iso(5)]);
    const player = await prisma.player.create({ data: { eventId: ev.id, name: `${TAG} Bo`, handicap: 10, seed: 1, status: "confirmed" } });
    await prisma.scorecard.create({ data: { eventId: ev.id, stageId: ev.stages[0].id, playerId: player.id, strokes: "[null,null]" } });
    await stampParClocks(NOW);
    expect(await closesAt(ev.id)).toBeNull();
  });

  it("NEVER MOVES IT: a score a week later buys nothing", async () => {
    const ev = await tournament(orgs.par, "stamped", [iso(-2)]);
    await stampParClocks(NOW);
    const first = await closesAt(ev.id);
    expect(first).not.toBeNull();
    // A week of activity later, including a round moved forward.
    await prisma.stage.update({ where: { id: ev.stages[0].id }, data: { playedOn: iso(3) } });
    await stampParClocks(new Date(NOW.getTime() + 7 * DAY));
    expect(await closesAt(ev.id)).toEqual(first);
  });

  it("CONTROL: a club that predates the terms never gets a clock", async () => {
    const ev = await tournament(orgs.old, "old dated", [iso(-3)]);
    await stampParClocks(NOW);
    expect(await closesAt(ev.id)).toBeNull();
  });
});

describe("on the day it is deleted — unless something has changed", () => {
  const due = async (orgId: string, name: string) => {
    const ev = await tournament(orgId, name, [iso(-20)]);
    await prisma.event.update({ where: { id: ev.id }, data: { closesAt: new Date(NOW.getTime() - DAY) } });
    return ev.id;
  };

  it("deletes a Par tournament whose day has passed, and keeps every one that must be kept", async () => {
    const par = await due(orgs.par, "due par");
    const old = await due(orgs.old, "due old"); // predates the terms
    const upgraded = await due(orgs.birdie, "due birdie"); // stamped as Par, upgraded since
    const held = await due(orgs.par, "due held");
    await prisma.event.update({ where: { id: held }, data: { retainUntil: new Date(NOW.getTime() + 30 * DAY) } });
    const notYet = (await tournament(orgs.par, "not yet", [iso(-1)])).id;
    await prisma.event.update({ where: { id: notYet }, data: { closesAt: new Date(NOW.getTime() + DAY) } });

    const r = await sweepClosedPar(NOW);
    expect(r.deleted).toBeGreaterThanOrEqual(1);
    expect(await exists(par), "a due Par tournament survived").toBe(false);
    expect(await exists(old), "a grandfathered club's tournament was deleted").toBe(true);
    expect(await exists(upgraded), "an upgraded club's tournament was deleted").toBe(true);
    expect(await exists(held), "a held tournament was deleted").toBe(true);
    expect(await exists(notYet), "a tournament was deleted before its day").toBe(true);
  });
});

describe("the loopholes found in the sweep of 2026-09-29", () => {
  it("a match-play result starts the clock — holes are letters, not numbers", async () => {
    const ev = await tournament(orgs.par, "match only", [""]);
    const [a, b] = await Promise.all(
      ["Cy", "Di"].map((n, i) =>
        prisma.player.create({ data: { eventId: ev.id, name: `${TAG} ${n}`, handicap: 10, seed: i + 1, status: "confirmed" } }),
      ),
    );
    const group = await prisma.group.create({ data: { eventId: ev.id, stageId: ev.stages[0].id, name: `${TAG} group`, position: 0 } });
    await prisma.match.create({
      data: { eventId: ev.id, stageId: ev.stages[0].id, groupId: group.id, round: 1, playerAId: a.id, playerBId: b.id, holes: '["A","H",null]' },
    });
    await stampParClocks(NOW);
    expect(await closesAt(ev.id), "a match-play Par tournament never started its clock").not.toBeNull();
  });

  it("a manual player count cannot promote a Par waiting list past ten", async () => {
    const ev = await tournament(orgs.par, "manual count", []);
    // What a Par organizer gets by switching to a manual count in settings:
    // the schema's default of 32, never clamped.
    await prisma.event.update({ where: { id: ev.id }, data: { capacity: 10, playerCountMode: "manual", manualPlayerCount: 32 } });
    for (let i = 0; i < 14; i += 1) {
      await prisma.player.create({ data: { eventId: ev.id, name: `${TAG} W${i}`, handicap: 10, seed: i + 1, status: "waitlisted" } });
    }
    await drainWaitlist(ev.id);
    expect(await prisma.player.count({ where: { eventId: ev.id, status: "confirmed" } })).toBe(10);
  });

  it("CONTROL: a club that predates the terms takes its manual count", async () => {
    const ev = await tournament(orgs.old, "old manual", []);
    await prisma.event.update({ where: { id: ev.id }, data: { playerCountMode: "manual", manualPlayerCount: 12 } });
    for (let i = 0; i < 14; i += 1) {
      await prisma.player.create({ data: { eventId: ev.id, name: `${TAG} O${i}`, handicap: 10, seed: i + 1, status: "waitlisted" } });
    }
    await drainWaitlist(ev.id);
    expect(await prisma.player.count({ where: { eventId: ev.id, status: "confirmed" } })).toBe(12);
  });

  /** A casual round, as `createMatch` makes one: shape match, 24 hours to live. */
  async function casual(who: string, termsApply: boolean) {
    session.email = emailFor(who);
    const orgId = await club(who, "free", termsApply);
    const ev = await prisma.event.create({
      data: {
        organizationId: orgId, name: `${TAG} ${who} round`, dates: "", course: "", city: "", address: "", regDeadline: "",
        status: "live", shape: "match", shareToken: `${TAG}-${who}-${Date.now()}`, expiresAt: new Date(NOW.getTime() + DAY),
      },
    });
    session.eventId = ev.id;
    session.role = "admin";
    return ev.id;
  }

  it("a Par casual round cannot be kept for ever — its 24 hours stand", async () => {
    const id = await casual("casual", true);
    const res = await keepRound();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/kept for 24 hours/);
    expect((await prisma.event.findUnique({ where: { id } }))?.expiresAt).not.toBeNull();
  });

  it("CONTROL: a club that predates the terms keeps its casual round", async () => {
    const id = await casual("casual-old", false);
    expect((await keepRound()).ok).toBe(true);
    expect((await prisma.event.findUnique({ where: { id } }))?.expiresAt).toBeNull();
  });

  it("the owner console counts a person who owns two Par clubs", async () => {
    const before = await peopleOwningSeveralParClubs();
    const user = await prisma.user.create({ data: { email: emailFor("multi"), name: `${TAG} multi` } });
    for (const n of ["one", "two"]) {
      await prisma.organization.create({
        data: {
          name: `${TAG} multi ${n}`,
          subscription: { create: { plan: "free", planTermsApply: true } },
          members: { create: { userId: user.id, role: "owner" } },
        },
      });
    }
    expect(await peopleOwningSeveralParClubs()).toBe(before + 1);
  });
});

describe("a Par tournament's rounds fall within seven days", () => {
  it("refuses a date eight days from the others, and keeps the old one", async () => {
    session.email = emailFor("window");
    const orgId = await club("window", "free", true);
    const ev = await tournament(orgId, "window", [iso(1), iso(2)]);
    session.eventId = ev.id;
    const res = await setStagePlayedOn(ev.stages[1].id, iso(10));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/within 7 days/);
    const stage = await prisma.stage.findUnique({ where: { id: ev.stages[1].id } });
    expect(stage?.playedOn).toBe(iso(2));
    // And the rain-out inside the window is fine.
    expect((await setStagePlayedOn(ev.stages[1].id, iso(4))).ok).toBe(true);
  });

  it("CONTROL: a club that predates the terms dates its rounds as it likes", async () => {
    session.email = emailFor("window-old");
    const orgId = await club("window-old", "free", false);
    const ev = await tournament(orgId, "window old", [iso(1), iso(2)]);
    session.eventId = ev.id;
    expect((await setStagePlayedOn(ev.stages[1].id, iso(30))).ok).toBe(true);
  });
});
