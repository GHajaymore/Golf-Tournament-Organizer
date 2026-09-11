import "dotenv/config";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { organizationForNewEvent } from "@/lib/services/organization";

/**
 * "WHO'S RUNNING THIS?" WAS A BOX THAT DID NOTHING.
 *
 * The field is offered on an organizer's first tournament, above the sentence
 * "leave blank to run it under your own name". Sign-up creates an organization
 * and a membership, so `organizationForNewEvent` always found one at its first
 * or second preference and returned it — and `orgName` was only ever read at
 * the third, the create, which a signed-up organizer can never reach.
 *
 * Walked on 2026-09-10: signed up as a society, typed "Zz Heathland Society"
 * into that field, created the tournament, and the organization was still
 * called "Zz Secretary" — under a checklist whose first row is "Name your
 * society", still unticked.
 *
 * Real rows, because the whole of it is a join between a User, an
 * OrganizationMember and an Organization, and the interesting cases are about
 * WHICH of those rows exist: an org somebody else owns, a membership that is
 * admin rather than owner, a name a human has already chosen.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ORGNAME";

const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: TAG.toLowerCase() } },
    select: { id: true },
  });
  await prisma.organizationMember.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.event.deleteMany({ where: { organization: { name: { startsWith: TAG } } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

/** A signed-up organizer: a user, an organization named after them, ownership. */
async function signUp(who: string, kind = "community", role = "owner") {
  const displayName = `${TAG} ${who}`;
  const user = await prisma.user.create({ data: { email: at(who), name: displayName } });
  const org = await prisma.organization.create({ data: { name: displayName, kind } });
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: user.id, role },
  });
  return { user, org, displayName };
}

const nameOf = async (id: string) =>
  (await prisma.organization.findUnique({ where: { id }, select: { name: true } }))!.name;

beforeEach(cleanup);
afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a new secretary typing their society's name", () => {
  it("names the organization sign-up made for them", async () => {
    // THE FAULT. Before this, the returned id was right and the name was still
    // the person's.
    const { org, displayName } = await signUp("ann");
    const id = await organizationForNewEvent(at("ann"), displayName, `${TAG} Heathland Society`);
    expect(id).toBe(org.id);
    expect(await nameOf(org.id)).toBe(`${TAG} Heathland Society`);
  });

  it("still puts the tournament in that same organization", async () => {
    // The control: a fix that created a SECOND organization would satisfy the
    // name assertion above and quietly split the club in two.
    const { org, displayName } = await signUp("bea");
    await organizationForNewEvent(at("bea"), displayName, `${TAG} Bea Society`);
    const count = await prisma.organizationMember.count({ where: { organizationId: org.id } });
    expect(count).toBe(1);
    const all = await prisma.organization.count({ where: { name: { startsWith: TAG } } });
    expect(all).toBe(1);
  });

  it("leaves it alone when the field is left blank", async () => {
    // "Leave blank to run it under your own name" — which is what the derived
    // name already is.
    const { org, displayName } = await signUp("cal");
    await organizationForNewEvent(at("cal"), displayName, "");
    expect(await nameOf(org.id)).toBe(displayName);
    await organizationForNewEvent(at("cal"), displayName, undefined);
    expect(await nameOf(org.id)).toBe(displayName);
  });

  it("ignores whitespace, rather than blanking the name with it", async () => {
    const { org, displayName } = await signUp("dee");
    await organizationForNewEvent(at("dee"), displayName, "   ");
    expect(await nameOf(org.id)).toBe(displayName);
  });
});

describe("an organization somebody has already named", () => {
  it("is never renamed by a later tournament", async () => {
    /**
     * The rule the old comment was protecting, and it still holds. A secretary
     * who named their society last month and types something else into a form
     * this month must not rename it — that is what the organization's own
     * settings screen is for.
     */
    const { org, displayName } = await signUp("eve");
    await prisma.organization.update({ where: { id: org.id }, data: { name: `${TAG} Real Society` } });
    await organizationForNewEvent(at("eve"), displayName, `${TAG} Something Else`);
    expect(await nameOf(org.id)).toBe(`${TAG} Real Society`);
  });
});

describe("an admin of somebody else's organization", () => {
  it("cannot rename it from the first-tournament form", async () => {
    /**
     * Choosing where a tournament goes and renaming the tenant are different
     * powers. `organizationForNewEvent` resolves on owner-OR-admin, so without
     * a second check an admin would rename somebody else's organization by
     * typing in a box on their own first event.
     */
    const fay = await signUp("fay");
    const gus = await prisma.user.create({ data: { email: at("gus"), name: `${TAG} gus` } });
    await prisma.organizationMember.create({
      data: { organizationId: fay.org.id, userId: gus.id, role: "admin" },
    });

    const id = await organizationForNewEvent(at("gus"), `${TAG} gus`, `${TAG} Gus Society`);
    // He still gets to create his tournament in it — that part is unchanged.
    expect(id).toBe(fay.org.id);
    expect(await nameOf(fay.org.id)).toBe(fay.displayName);
  });

  it("cannot rename one that IS still named after them", async () => {
    /**
     * THE CASE THE OWNER CHECK ACTUALLY EXISTS FOR, and the test above does
     * not reach it: Fay's organization is called "… fay", and to Gus that is
     * not the name the app would have derived for HIM — so
     * `organizationWasNamed` already answers true and the rename is refused
     * for a different reason. Deleting the owner check left that test green,
     * which is how it was found.
     *
     * Here the organization is named after Gus and Gus is only an admin of it:
     * demoted from owner by `setOrganizationMemberRole`, or two organizers
     * sharing a display name. `organizationWasNamed` says false, so the owner
     * check is the only thing standing between Gus and somebody else's
     * organization taking the name he typed.
     */
    const displayName = `${TAG} gil`;
    const owner = await prisma.user.create({ data: { email: at("owner"), name: `${TAG} owner` } });
    const org = await prisma.organization.create({ data: { name: displayName, kind: "community" } });
    await prisma.organizationMember.create({
      data: { organizationId: org.id, userId: owner.id, role: "owner" },
    });
    const gil = await prisma.user.create({ data: { email: at("gil"), name: displayName } });
    await prisma.organizationMember.create({
      data: { organizationId: org.id, userId: gil.id, role: "admin" },
    });

    const id = await organizationForNewEvent(at("gil"), displayName, `${TAG} Gil Society`);
    expect(id).toBe(org.id);
    expect(await nameOf(org.id)).toBe(displayName);
  });

  it("names it when they are the owner, so the check is not simply a refusal", async () => {
    // The control. Without it, the two above pass against a rename that never
    // happens for anybody.
    const { org, displayName } = await signUp("jo");
    await organizationForNewEvent(at("jo"), displayName, `${TAG} Jo Society`);
    expect(await nameOf(org.id)).toBe(`${TAG} Jo Society`);
  });
});

describe("an organizer who has never signed up", () => {
  it("gets a new organization under the name they typed, as before", async () => {
    // The path that always worked, asserted so the change cannot break it.
    const id = await organizationForNewEvent(at("hal"), `${TAG} hal`, `${TAG} Hal Society`);
    expect(await nameOf(id)).toBe(`${TAG} Hal Society`);
  });

  it("falls back to their own name when they type nothing", async () => {
    const id = await organizationForNewEvent(at("ivy"), `${TAG} ivy`, "");
    expect(await nameOf(id)).toBe(`${TAG} ivy`);
  });
});
