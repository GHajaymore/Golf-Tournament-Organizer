import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A CLUB ALREADY ON "SERVICE ONLY" HAS ITS INDEXES TYPED BY THE CLUB, UNTIL A
 * FEDERATION LINK IS LIVE (the team's ruling, 2026-10-24).
 *
 * "GHIN only" told a club that nobody may type an index — while no adapter
 * fetches one (`integrations/ghin.ts` reports `unconfigured`, and so does every
 * body in `bodies.ts`). The choice is hidden, and a club that STORED it before
 * reads as the club's own record. Nothing is rewritten in the database: the
 * stored value waits for the day `federationLinkLive()` says yes.
 *
 * Real rows, because the readers are database reads: a US club with
 * `handicapPolicy: "ghin"` stored directly (as an older save would have left
 * it), its owner signed in, and
 *   - Club settings' view of it (`integrationSetup`) reads "club";
 *   - the roster takes a TYPED index for a member who has a GHIN number;
 *   - `saveHandicapPolicy("ghin")` is refused and stores nothing;
 * and the CONTROL, with the predicate forced true: the same row reads "ghin",
 * the same typed index is refused, and the choice may be stored — so the three
 * checks above cannot pass on a reader that ignores the setting altogether.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-serviceonly";

const link = vi.hoisted(() => ({ live: false }));
vi.mock("@/lib/integrations/federation-link", () => ({ federationLinkLive: () => link.live }));

const session = { email: "", name: "", eventId: "", role: "admin", viewRole: "admin" };
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  setActiveEvent: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { saveHandicapPolicy } = await import("@/app/actions/handicap-policy");
const { addMember } = await import("@/app/actions/roster");
const { integrationSetup } = await import("@/lib/services/integrations");

const owner = { email: `${TAG}-owner@example.invalid`, name: `${TAG} Owner` };
let orgId = "";

async function scrub() {
  const orgs = await prisma.organization.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  if (orgs.length) {
    const ids = orgs.map((o) => o.id);
    await prisma.member.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.event.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

const storedPolicy = async () =>
  (await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { handicapPolicy: true } })).handicapPolicy;

const memberNamed = (name: string) =>
  prisma.member.findFirst({ where: { organizationId: orgId, name }, select: { handicap: true, handicapSource: true, ghin: true } });

beforeAll(async () => {
  await scrub();
  const user = await prisma.user.create({ data: { email: owner.email, name: owner.name, password: "x:unusable" } });
  const org = await prisma.organization.create({
    data: {
      name: `${TAG} Cedar Hollow Golf Club`,
      kind: "club",
      country: "United States",
      handicapPolicy: "ghin",
      handicapAuthorityId: "ghin",
      members: { create: { userId: user.id, role: "owner" } },
    },
  });
  orgId = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} Spring Medal`,
      status: "registration", shape: "single", format: "stroke", formationRule: "balanced",
      dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
      shareToken: `${TAG}-share`,
      registrationToken: `${TAG}-reg`,
    },
  });
  Object.assign(session, { email: owner.email, name: owner.name, eventId: event.id, role: "admin", viewRole: "admin" });
});

beforeEach(async () => {
  link.live = false;
  await prisma.organization.update({ where: { id: orgId }, data: { handicapPolicy: "ghin" } });
  await prisma.member.deleteMany({ where: { organizationId: orgId } });
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("while no federation link is live", () => {
  it("Club settings reads a stored service-only value as the club's own record", async () => {
    expect(await storedPolicy(), "the fixture is not on service-only").toBe("ghin");
    expect((await integrationSetup(orgId)).policy).toBe("club");
  });

  it("the club may type an index, even for a member with a GHIN number", async () => {
    const res = await addMember({ name: `${TAG} Della Ormsby`, ghin: "1234567", handicap: 14.2, handicapSource: "manual" });
    expect(res, res.error).toMatchObject({ ok: true });
    expect(await memberNamed(`${TAG} Della Ormsby`)).toMatchObject({ handicap: 14.2, handicapSource: "manual", ghin: "1234567" });
  });

  it("the server refuses to store service-only, and nothing changes", async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { handicapPolicy: "club" } });
    const res = await saveHandicapPolicy("ghin");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/the link that fetches them is coming/);
    expect(await storedPolicy()).toBe("club");
  });

  it("the other two choices are still stored", async () => {
    expect(await saveHandicapPolicy("hybrid")).toMatchObject({ ok: true });
    expect(await storedPolicy()).toBe("hybrid");
    expect(await saveHandicapPolicy("club")).toMatchObject({ ok: true });
    expect(await storedPolicy()).toBe("club");
  });
});

describe("CONTROL: with the link forced live, the same rows mean service-only again", () => {
  it("Club settings reads it as service-only", async () => {
    link.live = true;
    expect((await integrationSetup(orgId)).policy).toBe("ghin");
  });

  it("a typed index is refused, so the test above could see a refusal", async () => {
    link.live = true;
    const res = await addMember({ name: `${TAG} Ferris Quayle`, ghin: "7654321", handicap: 9.8, handicapSource: "manual" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/aren't entered by hand/);
    expect(await memberNamed(`${TAG} Ferris Quayle`)).toBeNull();
  });

  it("the choice may be stored", async () => {
    link.live = true;
    await prisma.organization.update({ where: { id: orgId }, data: { handicapPolicy: "club" } });
    expect(await saveHandicapPolicy("ghin")).toMatchObject({ ok: true });
    expect(await storedPolicy()).toBe("ghin");
  });
});
