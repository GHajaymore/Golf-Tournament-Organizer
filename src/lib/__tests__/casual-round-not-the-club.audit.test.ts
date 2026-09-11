import "dotenv/config";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  personalOrganizationFor,
  organizationForNewEvent,
  orgSetupFactsFor,
} from "@/lib/services/organization";

/**
 * A SECRETARY'S SUNDAY FOURBALL WAS CREATED INSIDE THEIR CLUB.
 *
 * `match-setup.ts` resolved its organization through `organizationForNewEvent`
 * under a comment saying it "returns the person's own personal organization …
 * somebody playing their mate on Sunday is not starting a club". That resolver
 * prefers a real club: it orders by kind, and kinds sort alphabetically, so
 * `club` beats `community` beats `personal`. The sentence was true only for an
 * organizer who ran nothing else.
 *
 * For everybody who runs a club it was exactly backwards, and the club then
 * carried the round — in its tournament picker, under its branding and theme,
 * on its plan, and in the counts its other organizers read. A club has no
 * business knowing about a Sunday fourball.
 *
 * Real rows, because the whole of it is which organization a row lands in, and
 * the interesting cases are about which memberships exist: a club owner, an
 * admin of somebody else's club, a person with no club at all.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CASUALORG";

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

/** Somebody who runs a real club, as a club secretary does. */
async function clubSecretary(who: string) {
  const displayName = `${TAG} ${who}`;
  const user = await prisma.user.create({ data: { email: at(who), name: displayName } });
  const club = await prisma.organization.create({
    data: { name: `${TAG} ${who} Golf Club`, kind: "club" },
  });
  await prisma.organizationMember.create({
    data: { organizationId: club.id, userId: user.id, role: "owner" },
  });
  return { user, club, displayName };
}

const orgOf = (id: string) =>
  prisma.organization.findUnique({ where: { id }, select: { id: true, name: true, kind: true } });

beforeEach(cleanup);
afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a club secretary setting up a quick round", () => {
  it("does not put it in the club", async () => {
    // THE FAULT, stated as plainly as it can be.
    const { club, displayName } = await clubSecretary("ann");
    const id = await personalOrganizationFor(at("ann"), displayName);
    expect(id).not.toBe(club.id);
    expect((await orgOf(id))?.kind).toBe("personal");
  });

  it("still puts a TOURNAMENT in the club, which is the whole difference", async () => {
    /**
     * The control, and the thing that must not break. A secretary creating a
     * competition is acting for the club; the same person creating a fourball
     * is not. Two resolvers because there are two questions, and this asserts
     * the other one still answers the way it always did.
     */
    const { club, displayName } = await clubSecretary("bea");
    expect(await organizationForNewEvent(at("bea"), displayName)).toBe(club.id);
  });

  it("keeps the club's event count out of it", async () => {
    /**
     * What the club actually reads. `orgSetupFactsFor` counts the club's
     * events for the setup checklist, so a secretary whose only event was a
     * Sunday fourball had "Create your first tournament" ticked by a round
     * their members will never see.
     */
    const { club, displayName } = await clubSecretary("cal");
    const personal = await personalOrganizationFor(at("cal"), displayName);
    await prisma.event.create({
      data: {
        organizationId: personal,
        name: `${TAG} cal v mate`,
        shape: "match",
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-cal-${process.pid}`,
      },
    });

    const facts = await orgSetupFactsFor(at("cal"), displayName);
    // The checklist is about the CLUB — kind sorts club first — and the club
    // has had nothing created in it.
    expect(facts?.kind).toBe("club");
    expect(facts?.eventCount).toBe(0);
    expect(await prisma.event.count({ where: { organizationId: club.id } })).toBe(0);
  });

  it("reuses the same personal organization rather than making one a week", async () => {
    const { displayName } = await clubSecretary("dee");
    const first = await personalOrganizationFor(at("dee"), displayName);
    const second = await personalOrganizationFor(at("dee"), displayName);
    expect(second).toBe(first);
    const mine = await prisma.organization.count({
      where: { name: { startsWith: TAG }, kind: "personal" },
    });
    expect(mine).toBe(1);
  });
});

describe("somebody with no club at all", () => {
  it("gets their own organization, created on first use", async () => {
    // The free-tier case this whole path exists for.
    const id = await personalOrganizationFor(at("eve"), `${TAG} eve`);
    const org = await orgOf(id);
    expect(org?.kind).toBe("personal");
    expect(org?.name).toBe(`${TAG} eve`);
  });

  it("gets the same one the second time", async () => {
    const first = await personalOrganizationFor(at("fay"), `${TAG} fay`);
    expect(await personalOrganizationFor(at("fay"), `${TAG} fay`)).toBe(first);
  });
});

describe("an admin of somebody else's personal organization", () => {
  it("does not have their round land in it", async () => {
    /**
     * Owner, not owner-or-admin. Two people can share a personal organization
     * — one adds the other as an admin — and a fourball belongs to whoever set
     * it up, not to whoever happens to own the row they both touch.
     */
    const gus = await prisma.user.create({ data: { email: at("gus"), name: `${TAG} gus` } });
    const org = await prisma.organization.create({
      data: { name: `${TAG} gus own`, kind: "personal" },
    });
    await prisma.organizationMember.create({
      data: { organizationId: org.id, userId: gus.id, role: "owner" },
    });

    const hal = await prisma.user.create({ data: { email: at("hal"), name: `${TAG} hal` } });
    await prisma.organizationMember.create({
      data: { organizationId: org.id, userId: hal.id, role: "admin" },
    });

    const id = await personalOrganizationFor(at("hal"), `${TAG} hal`);
    expect(id).not.toBe(org.id);
    expect((await orgOf(id))?.name).toBe(`${TAG} hal`);
  });
});

describe("a society, which is not a club and not personal either", () => {
  it("is skipped too — the round is the person's, not the society's", async () => {
    // `community` is a shared tenant with a roster and a ledger. The rule is
    // "the person's own", not "anything that is not a club".
    const user = await prisma.user.create({ data: { email: at("ivy"), name: `${TAG} ivy` } });
    const society = await prisma.organization.create({
      data: { name: `${TAG} ivy Society`, kind: "community" },
    });
    await prisma.organizationMember.create({
      data: { organizationId: society.id, userId: user.id, role: "owner" },
    });

    const id = await personalOrganizationFor(at("ivy"), `${TAG} ivy`);
    expect(id).not.toBe(society.id);
    expect((await orgOf(id))?.kind).toBe("personal");
  });
});

/**
 * And the SETUP PATH has to be the one that uses it.
 *
 * Everything above tests the resolver. A resolver nothing calls is a resolver
 * that changes nothing — and the fault being fixed was precisely that
 * `match-setup.ts` called the other one, under a comment describing this one.
 */
describe("the quick-round setup path", () => {
  it("resolves the person's own organization, not the event resolver", async () => {
    const { readSource } = await import("./source");
    const src = readSource("src/app/actions/match-setup.ts");
    expect(src).toMatch(/personalOrganizationFor\(session\.email, session\.name\)/);
    expect(src).not.toMatch(/organizationForNewEvent\(/);
  });

  it("is the only writer of the expiry column, still", async () => {
    // The safety argument for the sweep rests on this and the organization
    // change must not have moved it.
    const { readSource } = await import("./source");
    expect(readSource("src/app/actions/match-setup.ts")).toMatch(/expiresAt: expiryFrom\(/);
  });
});

/**
 * AND THE CLUB'S COURSES ARE STILL OFFERED, which is the line between
 * "the round is not the club's" and "the club is hidden from you".
 *
 * Moving a quick round into the person's own organization took the club's
 * course library off the card screen with it: that screen scoped
 * `clubCourses` to the EVENT's organization, which is now a personal one with
 * no courses in it. A secretary setting up a fourball at their own course
 * could no longer find it in the venue picker.
 *
 * A golf course is a physical place, not club apparatus. Offering one is a
 * convenience — the same convenience the memory records for the member list
 * and its stored handicaps — and `/match/new` has always read the person's
 * memberships for exactly this.
 */
describe("what a casual round may still read from the club", () => {
  it("offers every course the person's clubs have on file", async () => {
    const { club, displayName } = await clubSecretary("kit");
    await prisma.course.create({
      data: {
        organizationId: club.id,
        name: `${TAG} kit Heath`,
        pars: JSON.stringify(new Array(18).fill(4)),
        yards: JSON.stringify(new Array(18).fill(400)),
        strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    });
    const personal = await personalOrganizationFor(at("kit"), displayName);
    expect(personal).not.toBe(club.id);

    const { courseOrgIdsFor } = await import("@/lib/services/organization");
    const ids = await courseOrgIdsFor(at("kit"));
    // Both: the club whose course it is, and the organization the round is in.
    expect(ids).toContain(club.id);
    expect(ids).toContain(personal);

    const { clubCourses } = await import("@/lib/services/courses");
    const names = (await clubCourses(ids, "no-such-event")).map((c) => c.name);
    expect(names).toContain(`${TAG} kit Heath`);
  });

  it("offers them to an ordinary member, not only to whoever runs the club", async () => {
    /**
     * THE CASE THIS IS ACTUALLY FOR, and the one the test above does not
     * reach: a club member who runs nothing. They are the casual golfer this
     * whole path exists for — the fourball on a Sunday, at the course they
     * are a member of — and every other organization reader in this file is
     * deliberately owner-or-admin only.
     *
     * Found by mutation: narrowing the membership query to `role: "owner"`
     * left the fixture above green, because a secretary owns their club.
     */
    const host = await clubSecretary("pat");
    await prisma.course.create({
      data: {
        organizationId: host.club.id,
        name: `${TAG} pat Common`,
        pars: JSON.stringify(new Array(18).fill(4)),
        yards: JSON.stringify(new Array(18).fill(400)),
        strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    });
    const member = await prisma.user.create({ data: { email: at("ray"), name: `${TAG} ray` } });
    await prisma.organizationMember.create({
      data: { organizationId: host.club.id, userId: member.id, role: "member" },
    });

    const { courseOrgIdsFor } = await import("@/lib/services/organization");
    const { clubCourses } = await import("@/lib/services/courses");
    const ids = await courseOrgIdsFor(at("ray"));
    expect(ids).toContain(host.club.id);
    const names = (await clubCourses(ids, "no-such-event")).map((c) => c.name);
    expect(names).toContain(`${TAG} pat Common`);
  });

  it("offers nothing from a club this person is not in", async () => {
    // The scope is memberships, not every course in the database.
    const other = await clubSecretary("lou");
    await prisma.course.create({
      data: {
        organizationId: other.club.id,
        name: `${TAG} lou Private`,
        pars: JSON.stringify(new Array(18).fill(4)),
        yards: JSON.stringify(new Array(18).fill(400)),
        strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    });
    const stranger = await prisma.user.create({
      data: { email: at("mo"), name: `${TAG} mo` },
    });
    expect(stranger.id).toBeTruthy();

    const { courseOrgIdsFor } = await import("@/lib/services/organization");
    const { clubCourses } = await import("@/lib/services/courses");
    const names = (await clubCourses(await courseOrgIdsFor(at("mo")), "no-such-event")).map((c) => c.name);
    expect(names).not.toContain(`${TAG} lou Private`);
  });

  it("still takes a single organization, so nothing else changed", async () => {
    // Every tournament caller passes one id and must behave exactly as before.
    const { club } = await clubSecretary("nan");
    await prisma.course.create({
      data: {
        organizationId: club.id,
        name: `${TAG} nan Links`,
        pars: JSON.stringify(new Array(18).fill(4)),
        yards: JSON.stringify(new Array(18).fill(400)),
        strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    });
    const { clubCourses } = await import("@/lib/services/courses");
    const names = (await clubCourses(club.id, "no-such-event")).map((c) => c.name);
    expect(names).toContain(`${TAG} nan Links`);
  });
});
