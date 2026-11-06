import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * BEFORE LAUNCH THE DEPLOY FREEZE GUARDS ONLY PILOT CLUBS — AGAINST REAL ROWS (Ajay, 2026-11-06:
 * "we can't waste time waiting this long. this kind of real tournament [freeze] we should do at
 * the last when we have all other foundations and basic issues fixed").
 *
 * `deploy-window.test.ts` proves the rule on plain data. THIS proves the service finds the pilot
 * clubs the way the app knows staff: somebody on `SIGNIN_ALLOW_EMAILS` who is a club's
 * Commissioner (`OrganizationMember` owner) or an Organizer on one of its tournaments (`Account`
 * admin) makes that club a pilot; an owner on `OWNER_EMAILS` does not, even when they are on the
 * allow-list too. Three invented clubs, `zz-` marked, deleted in `finally`. Read-only of everything
 * else: the service only reads, and the instant is a Saturday morning years ahead, so no real
 * tournament is on it.
 *
 * The launch state is the one answer every held page asks (`launchState()`); it is set here by
 * standing in for that answer, so the switch's row in this database is never written.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const launch = vi.hoisted(() => ({ state: "held" as "held" | "live" }));
vi.mock("@/lib/services/signins-switch", () => ({ launchState: async () => launch.state }));

import { currentDeployWindow, pilotClubIds } from "@/lib/services/deploy-window";
import { HELD_RULE, LIVE_RULE, FREEZE_RESUMES, FREEZE_OFF } from "@/lib/domain/deploy-window";

const prisma = new PrismaClient();
const TAG = `zz-deploy-pilot-${process.pid}`;
const COMMISSIONER = `${TAG}-commissioner@example.invalid`;
const ORGANIZER = `${TAG}-organizer@example.invalid`;
const OWNER = `${TAG}-owner@example.invalid`;

// Saturday 8 June 2030, 10:00 UTC: a weekend morning for a club on UTC, years from any real round.
const AT = new Date("2030-06-08T10:00:00Z");
const TODAY = "2030-06-08";
const LATER = "2030-06-20";

const saved: Record<string, string | undefined> = {};
const ids = { commissioner: "", organizer: "", owners: "" };
const stage = { commissioner: "", organizer: "", owners: "" };

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

/** A club on UTC with one tournament and one round, dated LATER until a test moves it. */
async function club(key: keyof typeof ids) {
  const org = await prisma.organization.create({ data: { name: `${TAG} ${key} club`, kind: "club", timeZone: "UTC" } });
  const event = await prisma.event.create({
    data: { name: `${TAG} ${key} medal`, organizationId: org.id, status: "live", dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-${key}` },
  });
  const round = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, playedOn: LATER },
  });
  ids[key] = org.id;
  stage[key] = round.id;
  return { org: org.id, event: event.id };
}

const playToday = async (...who: (keyof typeof stage)[]) => {
  await prisma.stage.updateMany({ where: { id: { in: Object.values(stage) } }, data: { playedOn: LATER } });
  await prisma.stage.updateMany({ where: { id: { in: who.map((k) => stage[k]) } }, data: { playedOn: TODAY } });
};

beforeAll(async () => {
  for (const k of ["SIGNIN_ALLOW_EMAILS", "OWNER_EMAILS"]) saved[k] = process.env[k];
  // The owner is on BOTH lists: their club must still not count.
  process.env.SIGNIN_ALLOW_EMAILS = `${COMMISSIONER.toUpperCase()}, ${ORGANIZER}, ${OWNER}`;
  process.env.OWNER_EMAILS = OWNER;
  await scrub();

  // A pilot club, run by its Commissioner (on the allow-list).
  const a = await club("commissioner");
  const commissioner = await prisma.user.create({ data: { email: COMMISSIONER, name: `${TAG} Commissioner`, password: "x" } });
  await prisma.organizationMember.create({ data: { organizationId: a.org, userId: commissioner.id, role: "owner" } });

  // A pilot club whose allow-listed person is an Organizer on its tournament, and nothing at the club.
  const b = await club("organizer");
  await prisma.account.create({ data: { eventId: b.event, name: `${TAG} Organizer`, email: ORGANIZER, role: "admin" } });

  // The owners' own club: its Commissioner is on OWNER_EMAILS (and on the allow-list).
  const c = await club("owners");
  const owner = await prisma.user.create({ data: { email: OWNER, name: `${TAG} Owner`, password: "x" } });
  await prisma.organizationMember.create({ data: { organizationId: c.org, userId: owner.id, role: "owner" } });
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await prisma.$disconnect();
  }
});

describe("the deploy freeze before launch, against real rows", () => {
  it("the pilot clubs are the allow-listed staff's clubs — Commissioner or Organizer — and never the owners'", async () => {
    expect(AT.getUTCDay(), "the instant is meant to be a Saturday").toBe(6);
    const pilots = await pilotClubIds();
    expect(pilots.has(ids.commissioner), "a Commissioner on the allow-list does not make a pilot club").toBe(true);
    expect(pilots.has(ids.organizer), "an Organizer on the allow-list does not make a pilot club").toBe(true);
    expect(pilots.has(ids.owners), "an owner's own club counted as a pilot club").toBe(false);
  });

  it("held, nothing on today: not frozen, though it is Saturday 10:00 at three clubs", async () => {
    launch.state = "held";
    await playToday();
    const w = await currentDeployWindow(AT);
    expect(w.frozen, w.reason).toBe(false);
    expect(w.reason.startsWith(HELD_RULE)).toBe(true);
    expect(w.reason).toContain("weekend mornings are not frozen before launch");
  });

  it("held, the owners' club playing today: not frozen", async () => {
    launch.state = "held";
    await playToday("owners");
    expect((await currentDeployWindow(AT)).frozen).toBe(false);
  });

  it("held, a pilot club playing today: frozen — by its Commissioner, and by its Organizer", async () => {
    launch.state = "held";
    for (const pilot of ["commissioner", "organizer"] as const) {
      await playToday(pilot);
      const w = await currentDeployWindow(AT);
      expect(w.frozen, `${pilot}: ${w.reason}`).toBe(true);
      expect(w.reason).toBe(`${HELD_RULE}, and 1 tournament is being played today in the club's own time (UTC) at a pilot club`);
    }
  });

  it("live: the owners' club playing today freezes, as every club does", async () => {
    launch.state = "live";
    await playToday("owners");
    const w = await currentDeployWindow(AT);
    expect(w.frozen).toBe(true);
    expect(w.reason.startsWith(LIVE_RULE)).toBe(true);
  });

  it("before 20 November 2026 nothing freezes, held or live — a pilot club playing included", async () => {
    const before = new Date(FREEZE_RESUMES.getTime() - 60_000);
    const day = before.toISOString().slice(0, 10);
    await prisma.stage.updateMany({ where: { id: { in: Object.values(stage) } }, data: { playedOn: day } });
    try {
      for (const state of ["held", "live"] as const) {
        launch.state = state;
        expect(await currentDeployWindow(before), state).toEqual({ frozen: false, reason: FREEZE_OFF });
      }
      // CONTROL: two minutes later the same rows freeze, held, by the pilot club.
      launch.state = "held";
      expect((await currentDeployWindow(new Date(FREEZE_RESUMES.getTime() + 60_000))).frozen).toBe(true);
    } finally {
      await playToday();
    }
  });

  it("the answer never names a club or a person", async () => {
    launch.state = "held";
    await playToday("commissioner", "organizer", "owners");
    const w = await currentDeployWindow(AT);
    expect(w.reason).not.toContain(TAG);
    expect(w.reason).not.toContain("example.invalid");
  });
});
