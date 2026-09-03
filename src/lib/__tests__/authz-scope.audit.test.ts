import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { smsAudienceFor } from "@/lib/services/messaging";
import type { MembershipContext } from "@/lib/domain/messaging";

/**
 * Two authorization holes, proved across a real second club.
 *
 * Both are the same shape: a check that proves the caller is *an* organizer,
 * standing in for one that proves they organize THIS. A single-club fixture
 * cannot show either — the ids all belong to the caller — so everything here
 * is set up as two clubs and asks the first for the second's things.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-AUTHZ";

let session: { eventId: string; email: string; viewRole: string; name: string; role: string } | null =
  null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { setOrgMoneyMode } = await import("@/app/actions/money-setup");

interface Club {
  orgId: string;
  eventId: string;
  teamId: string;
  playerName: string;
}

/** A club with one event, one team, and one player on it. */
async function makeClub(label: string): Promise<Club> {
  const org = await prisma.organization.create({
    data: { name: `${TAG} ${label}`, kind: "club" },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} ${label} cup`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      status: "active",
      shape: "series",
      formationRule: "balanced",
      shareToken: `audit-authz-${label}-${Date.now()}-${Math.random()}`,
    },
  });
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Round Robin", format: "Four-Ball", holes: 18 },
  });
  const playerName = `${TAG} ${label} player`;
  const player = await prisma.player.create({
    data: {
      eventId: event.id,
      name: playerName,
      email: `${TAG.toLowerCase()}-${label}-${Date.now()}-${Math.random()}@example.invalid`,
      handicap: 10,
      seed: 1,
      status: "confirmed",
    },
  });
  const team = await prisma.team.create({
    data: { eventId: event.id, stageId: stage.id, name: `${TAG} ${label} side` },
  });
  await prisma.teamMember.create({ data: { teamId: team.id, playerId: player.id } });
  return { orgId: org.id, eventId: event.id, teamId: team.id, playerName };
}

let mine: Club;
let theirs: Club;

const ctxFor = (club: Club): MembershipContext => ({
  email: `${TAG.toLowerCase()}-staff@example.invalid`,
  role: "admin",
  organizationId: club.orgId,
  eventId: club.eventId,
  playerId: null,
  onRoster: true,
  groupIds: [],
  stageIds: [],
  teamIds: [],
  matchIds: [],
  foursomeIds: [],
  directThreadIds: [],
});

beforeAll(async () => {
  // Users are not owned by the organization, so they survive its delete — and
  // a leftover from a failed run collides on the unique email next time.
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { name: { startsWith: TAG } } });
  mine = await makeClub("mine");
  theirs = await makeClub("theirs");
});

afterAll(async () => {
  // Users are not owned by the organization, so they survive its delete — and
  // a leftover from a failed run collides on the unique email next time.
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

/**
 * A text preview must not name another club's players.
 *
 * `smsAudienceFor` scoped every branch to the caller's own event — the field,
 * a flight, the club roster — except the TEAM branch, which selected on the
 * `teamId` alone. A scope key is a string off the wire, so an organizer of one
 * event could ask for a side in another club's tournament and get its players
 * back. The phone numbers stayed private, because those are looked up against
 * the caller's own roster; the names came back regardless, listed in the
 * preview as "skipped — no mobile number".
 */
describe("the SMS preview only sees the caller's own tournament", () => {
  it("names the caller's own team", async () => {
    // The fixture has to be able to find somebody, or the test below passes
    // because the query returns nothing for any id at all.
    const audience = await smsAudienceFor(ctxFor(mine), `team:${mine.teamId}`);
    expect(audience.map((r) => r.name)).toContain(mine.playerName);
  });

  it("returns nothing for a team in another club's event", async () => {
    const audience = await smsAudienceFor(ctxFor(mine), `team:${theirs.teamId}`);
    expect(audience).toEqual([]);
  });

  it("does not name the other club's player under any reason", async () => {
    // Including as "skipped", which is where the names actually surfaced: the
    // preview lists everyone it could not text, by name.
    const audience = await smsAudienceFor(ctxFor(mine), `team:${theirs.teamId}`);
    expect(audience.map((r) => r.name)).not.toContain(theirs.playerName);
  });
});

/**
 * A club-wide default needs club-wide authority.
 *
 * `setOrgMoneyMode` writes `Organization.moneyMode`, which every other
 * tournament in the club inherits — and it was reached through an EVENT role.
 * So a guest brought in to run one Saturday medal, an assistant at that, could
 * hide the expense ledger and settle-up across tournaments they cannot open.
 */
describe("the club's money default", () => {
  /**
   * A club that somebody OWNS. That matters: an organization with no members
   * at all is the deliberate bootstrap case — `canAdministerOrganization`
   * returns "ownerless" and lets the organizer through, because a club nobody
   * holds cannot be taken from anyone. Testing the refusal against an empty
   * club would prove nothing.
   */
  const ownerEmail = `${TAG.toLowerCase()}-owner@example.invalid`;
  const guestEmail = `${TAG.toLowerCase()}-guest@example.invalid`;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: ownerEmail, name: `${TAG} owner`, password: "x" },
    });
    await prisma.organizationMember.create({
      data: { organizationId: mine.orgId, userId: user.id, role: "owner" },
    });
    await prisma.organization.update({
      where: { id: mine.orgId },
      data: { moneyMode: "none" },
    });
  });

  const sessionAs = (email: string, role: string) => ({
    eventId: mine.eventId,
    email,
    viewRole: role,
    name: `${TAG} ${role}`,
    role,
  });

  const modeNow = async () =>
    (await prisma.organization.findUniqueOrThrow({ where: { id: mine.orgId } })).moneyMode;

  it("refuses a guest organizer who holds no role in the club", async () => {
    session = sessionAs(guestEmail, "admin");

    // A REAL mode, so the refusal cannot come from validation. The first
    // version of this test used "off", which `isMoneyMode` rejects — it passed
    // on "Unknown money setting" and proved nothing about authorization.
    const res = await setOrgMoneyMode("split");

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/owner or admin/i);
    expect(await modeNow()).toBe("none");
  });

  it("refuses an assistant just the same", async () => {
    session = sessionAs(guestEmail, "assistant");
    const res = await setOrgMoneyMode("split");
    expect(res.ok).toBe(false);
    expect(await modeNow()).toBe("none");
  });

  it("allows an owner of the club", async () => {
    /**
     * The guard against the guard. A club that genuinely holds its tournaments
     * must still be able to set its own default, or the setting is unreachable
     * and the fix is worse than the fault.
     */
    session = sessionAs(ownerEmail, "admin");

    const res = await setOrgMoneyMode("split");

    expect(res.ok).toBe(true);
    expect(await modeNow()).toBe("split");
  });
});
