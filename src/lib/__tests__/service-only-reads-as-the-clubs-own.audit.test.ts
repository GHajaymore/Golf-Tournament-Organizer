import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A CLUB ALREADY ON A BODY'S CHOICE HAS ITS INDEXES TYPED BY THE CLUB, UNTIL A
 * FEDERATION LINK IS LIVE (the team's rulings, 2026-10-24).
 *
 * "GHIN only" told a club that nobody may type an index, and "GHIN where a
 * member has one" told it the same of every member with a number — while no
 * adapter fetches one (`integrations/ghin.ts` reports `unconfigured`, and so
 * does every body in `bodies.ts`). Both choices are hidden, and a club that
 * STORED either before reads as the club's own record. Nothing is rewritten in
 * the database: the stored value waits for the day `federationLinkLive()` says
 * yes.
 *
 * Real rows, because the readers are database reads. For each stored value —
 * "ghin" and "hybrid", written directly as an older save would have left it —
 * a US club with its owner signed in, and
 *   - Club settings' view of it (`integrationSetup`) reads "club";
 *   - the roster takes a TYPED index for a member who has a GHIN number, on
 *     an add and on correcting one already on file;
 *   - `saveHandicapPolicy` of that value is refused and stores nothing;
 * and the CONTROL, with the predicate forced true: the same row reads as
 * stored, the same typed index is refused, and the choice may be stored — so
 * the checks above cannot pass on a reader that ignores the setting
 * altogether.
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
const { addMember, updateMember } = await import("@/app/actions/roster");
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
  await prisma.member.deleteMany({ where: { organizationId: orgId } });
});

/** A member on the roster with a GHIN number and an index received from GHIN. */
const withNumber = (name: string) =>
  prisma.member.create({
    data: { organizationId: orgId, name, email: `${name.split(" ").pop()!.toLowerCase()}-${TAG}@example.invalid`, ghin: "7654321", handicap: 10.2, handicapSource: "ghin" },
  });

/** Exactly what the roster's form sends on an edit, with a new figure typed. */
const editForm = (m: { name: string; email: string }, handicap: number) => ({
  name: m.name, email: m.email, phone: "", ghin: "7654321", homeClub: "", memberNumber: "", handicapType: "18", notes: "", handicap,
});

const storeDirectly = (handicapPolicy: string) => prisma.organization.update({ where: { id: orgId }, data: { handicapPolicy } });

/** Each body choice, and the words the roster refuses a typed index with once it is live. */
const BODY_CHOICES = [
  { policy: "ghin", name: "service-only", refusal: /aren't entered by hand/ },
  { policy: "hybrid", name: "where a member has one", refusal: /Clear their GHIN number/ },
] as const;

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe.each(BODY_CHOICES)("a club stored on $name ($policy)", ({ policy, refusal }) => {
  describe("while no federation link is live", () => {
    it("Club settings reads it as the club's own record", async () => {
      await storeDirectly(policy);
      expect(await storedPolicy(), "the fixture is not on the choice").toBe(policy);
      expect((await integrationSetup(orgId)).policy).toBe("club");
    });

    it("the club may type an index, even for a member with a GHIN number", async () => {
      await storeDirectly(policy);
      const res = await addMember({ name: `${TAG} Della Ormsby`, ghin: "1234567", handicap: 14.2, handicapSource: "manual" });
      expect(res, res.error).toMatchObject({ ok: true });
      expect(await memberNamed(`${TAG} Della Ormsby`)).toMatchObject({ handicap: 14.2, handicapSource: "manual", ghin: "1234567" });
    });

    it("and may correct one already on file for a member with a GHIN number", async () => {
      await storeDirectly(policy);
      const m = await withNumber(`${TAG} Hollis Brand`);
      const res = await updateMember(m.id, editForm(m, 4.0));
      expect(res, res.error).toMatchObject({ ok: true });
      expect(await memberNamed(m.name)).toMatchObject({ handicap: 4, handicapSource: "manual" });
    });

    it("the server refuses to store it, and nothing changes", async () => {
      await storeDirectly("club");
      const res = await saveHandicapPolicy(policy);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/the link that fetches them is coming/);
      expect(await storedPolicy()).toBe("club");
    });
  });

  describe("CONTROL: with the link forced live, the same row means what it says again", () => {
    it("Club settings reads it as stored", async () => {
      await storeDirectly(policy);
      link.live = true;
      expect((await integrationSetup(orgId)).policy).toBe(policy);
    });

    it("a typed index for a member with a GHIN number is refused, so the test above could see a refusal", async () => {
      await storeDirectly(policy);
      link.live = true;
      const m = await withNumber(`${TAG} Ferris Quayle`);
      const res = await updateMember(m.id, editForm(m, 4.0));
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(refusal);
      expect(await memberNamed(m.name)).toMatchObject({ handicap: 10.2, handicapSource: "ghin" });
    });

    it("the choice may be stored", async () => {
      await storeDirectly("club");
      link.live = true;
      expect(await saveHandicapPolicy(policy)).toMatchObject({ ok: true });
      expect(await storedPolicy()).toBe(policy);
    });
  });
});

describe("the club's own record", () => {
  it("is still stored while no link is live", async () => {
    await storeDirectly("ghin");
    expect(await saveHandicapPolicy("club")).toMatchObject({ ok: true });
    expect(await storedPolicy()).toBe("club");
  });
});
