import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE CLUB THAT WAS HERE FIRST IS TOLD (Ajay, 7 Nov 2026).
 *
 * `one-club-not-two.audit.test.ts` proves the second club's founder is ASKED and may carry on. This
 * file proves the other half, on real rows: when a club actually TAKES a name that a club nearby
 * already carries, the existing club's Commissioner gets a notice, and in the cases where nobody
 * should be told, nobody is.
 *
 *   told      a confirmed create; a rename in club settings
 *   quiet     the question not yet answered; another state; the club's own name; a `personal`
 *             tenant on either side; the demo club on either side
 *   dismiss   a Commissioner of the club the notice belongs to; nobody else, whatever id they post
 *   privacy   the words carry the new club's name, town and its founder's NAME, never an email
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/namesake-notice.audit.test.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-NAMESAKE";
const lower = TAG.toLowerCase();
const LEAGUE = `${TAG} Thursday Night League`;

const session = { email: "", name: "", eventId: "", role: "admin", viewRole: "admin" };
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  setActiveEvent: async () => {},
  requireStaff: async () => session.eventId,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
// No mail leaves a test, and the spec below asserts none is even attempted for a notice.
const mail: string[] = [];
vi.mock("@/lib/email", () => ({
  sendJoinRequestEmail: async (to: string) => { mail.push(to); },
  sendStaffInviteEmail: async (to: string) => { mail.push(to); },
}));

const { createEvent } = await import("@/app/actions/tournament");
const { saveOrganizationBranding } = await import("@/app/actions/organization");
const { dismissNamesakeNotice } = await import("@/app/actions/join");
const { createOrganizationWithOwner, otherOrganizationNamed } = await import("@/lib/services/organization");
const { openNamesakeNotices } = await import("@/lib/services/namesake-notice");

const boss = { email: `${lower}-boss@example.invalid`, name: `${TAG} First Secretary` };
const second = { email: `${lower}-second@example.invalid`, name: `${TAG} Second Secretary` };
const stranger = { email: `${lower}-stranger@example.invalid`, name: `${TAG} Stranger` };

let leagueId = "";
let leagueEventId = "";
let strangerOrgId = "";

async function scrub() {
  const orgs = await prisma.organization.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  if (orgs.length) await prisma.event.deleteMany({ where: { organizationId: { in: orgs.map((o) => o.id) } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: lower } } });
}

/** An outfit with an owner, a member on its roster (a society cannot start without one), and a town. */
async function outfit(
  name: string,
  who: { email: string; name: string },
  extra: { kind?: string; isDemo?: boolean; city?: string; region?: string; country?: string } = {},
) {
  const user = await prisma.user.upsert({
    where: { email: who.email },
    update: {},
    create: { email: who.email, name: who.name, password: "x:unusable" },
  });
  const org = await prisma.organization.create({
    data: { name, kind: extra.kind ?? "community", isDemo: extra.isDemo ?? false, city: extra.city ?? "", region: extra.region ?? "", country: extra.country ?? "", members: { create: { userId: user.id, role: "owner" } } },
  });
  await prisma.member.create({ data: { organizationId: org.id, name: `${TAG} A Member`, email: `${lower}-m-${org.id}@example.invalid` } });
  return org.id;
}

const noticesFor = (organizationId: string) => prisma.namesakeNotice.findMany({ where: { organizationId } });

beforeAll(async () => {
  await scrub();
  leagueId = await outfit(LEAGUE, boss, { city: "Cincinnati", region: "OH" });
  leagueEventId = (
    await prisma.event.create({
      data: {
        organizationId: leagueId, name: `${TAG} Week 1`, status: "draft", shape: "series", format: "stroke",
        formationRule: "balanced", dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
        shareToken: `${lower}-share-1`, registrationToken: `${lower}-reg-1`,
      },
    })
  ).id;
  // A second club's Commissioner who has nothing to do with the league.
  strangerOrgId = await outfit(`${TAG} Unrelated Society`, stranger, { city: "Dayton", region: "OH" });
});

beforeEach(async () => {
  mail.length = 0;
  await prisma.namesakeNotice.deleteMany({ where: { organizationId: leagueId } });
  // The second secretary starts each cell freshly signed up, owning an empty tenant named after them.
  await prisma.organization.deleteMany({ where: { members: { some: { user: { email: second.email } } } } });
  await prisma.user.deleteMany({ where: { email: second.email } });
  await outfit(second.name, second);
  session.email = second.email;
  session.name = second.name;
  session.eventId = "";
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

const asTheLeague = () => { session.email = boss.email; session.name = boss.name; session.eventId = leagueEventId; };

describe("a club takes a name that a club nearby already carries", () => {
  it("is told to the existing club once the second club's founder carries on", async () => {
    const res = await createEvent(`${TAG} Week 2`, "custom", "series", LEAGUE, undefined, true);
    expect(res.ok, res.error).toBe(true);

    const [notice, ...rest] = await noticesFor(leagueId);
    expect(rest, "more than one notice for one club").toHaveLength(0);
    expect(notice, "the existing club was not told").toBeTruthy();
    expect(notice.status).toBe("open");
    expect(notice.name).toBe(LEAGUE);
    expect(notice.byName).toBe(second.name);
    // The second club has no town yet: a new tenant is "near everything", and says so with an empty town.
    expect(notice.town).toBe("");
  });

  it("is not told while the question is still being asked", async () => {
    const res = await createEvent(`${TAG} Week 3`, "custom", "series", LEAGUE);
    expect(res.ok).toBe(false);
    expect(res.clubExists).toBe(LEAGUE);
    expect(await noticesFor(leagueId), "told about a club that does not exist yet").toHaveLength(0);
  });

  it("is told when an existing club is renamed to the name in club settings", async () => {
    const res = await saveOrganizationBranding(LEAGUE, "", "", { city: "Cincinnati", region: "OH", country: "" });
    expect(res.ok).toBe(true);
    // The settings screen still warns the person (unchanged) ...
    expect(res.warning).toContain(LEAGUE);
    // ... and now the other club hears too.
    const notices = await noticesFor(leagueId);
    expect(notices).toHaveLength(1);
    expect(notices[0].town).toBe("Cincinnati, OH");
    expect(notices[0].byName).toBe(second.name);
  });

  it("saving the same name again does not raise it twice, and a rename away withdraws it", async () => {
    await saveOrganizationBranding(LEAGUE, "", "", { city: "Cincinnati", region: "OH", country: "" });
    await saveOrganizationBranding(LEAGUE, "", "", { city: "Cincinnati", region: "OH", country: "" });
    expect(await noticesFor(leagueId)).toHaveLength(1);

    await saveOrganizationBranding(`${TAG} A Quite Different Name`, "", "", { city: "Cincinnati", region: "OH", country: "" });
    expect(await noticesFor(leagueId), "an out-of-date notice was left open").toHaveLength(0);
  });
});

describe("quiet cases", () => {
  it("says nothing about a namesake in another state", async () => {
    await saveOrganizationBranding(LEAGUE, "", "", { city: "Austin", region: "TX", country: "" });
    expect(await noticesFor(leagueId)).toHaveLength(0);
  });

  it("says nothing about a namesake in another state when the new club is made through the tournament form", async () => {
    // The create path asks the matcher itself (settings hands it the answer it already has).
    await prisma.organization.updateMany({
      where: { members: { some: { user: { email: second.email } } } },
      data: { city: "Austin", region: "TX", country: "US" },
    });
    const res = await createEvent(`${TAG} Week 8`, "custom", "series", LEAGUE, undefined, true);
    expect(res.ok, res.error).toBe(true);
    expect(await noticesFor(leagueId), "told about a league two states away").toHaveLength(0);
  });

  it("says nothing to a club about its own name", async () => {
    asTheLeague();
    const res = await saveOrganizationBranding(LEAGUE, "", "", { city: "Cincinnati", region: "OH", country: "" });
    expect(res.ok).toBe(true);
    expect(await prisma.namesakeNotice.count({ where: { OR: [{ organizationId: leagueId }, { newOrganizationId: leagueId }] } })).toBe(0);
  });

  it("never tells a personal tenant, but a personal newcomer that took the name does start one", async () => {
    const personalName = `${TAG} Dana Personal`;
    const personalId = await outfit(personalName, { email: `${lower}-p@example.invalid`, name: personalName }, { kind: "personal" });
    // A club takes a personal tenant's name: nobody is told (a person's workspace is nobody's club).
    await saveOrganizationBranding(personalName, "", "", {});
    expect(await noticesFor(personalId)).toHaveLength(0);
    // A personal tenant (the form's default kind) taking a club's name DOES tell the club.
    await prisma.organization.updateMany({ where: { members: { some: { user: { email: second.email } } } }, data: { kind: "personal" } });
    await saveOrganizationBranding(LEAGUE, "", "", { city: "Cincinnati", region: "OH", country: "" });
    expect(await noticesFor(leagueId)).toHaveLength(1);
  });

  it("a personal newcomer made through the tournament form with a typed club name tells the club", async () => {
    await prisma.organization.updateMany({ where: { members: { some: { user: { email: second.email } } } }, data: { kind: "personal" } });
    const res = await createEvent(`${TAG} Week 9`, "custom", "series", LEAGUE, undefined, true);
    expect(res.ok, res.error).toBe(true);
    expect(await noticesFor(leagueId)).toHaveLength(1);
  });

  it("a tenant auto-named after its person at sign-up raises nothing", async () => {
    // Named exactly like the league, with NO typed name: sign-up passes none.
    const user = `${lower}-signup@example.invalid`;
    const id = await createOrganizationWithOwner({ email: user, displayName: LEAGUE });
    expect((await prisma.organization.findUnique({ where: { id } }))?.name).toBe(LEAGUE);
    expect(await noticesFor(leagueId), "sign-up's auto-name told a club").toHaveLength(0);
  });

  it("never tells the demo club, and the demo club never starts a notice", async () => {
    const demoName = `${TAG} Demo Heath Golf Club`;
    const demoId = await outfit(demoName, { email: `${lower}-d@example.invalid`, name: `${TAG} Demo Owner` }, { isDemo: true, kind: "club" });
    await saveOrganizationBranding(demoName, "", "", {});
    expect(await noticesFor(demoId), "told the demo club").toHaveLength(0);

    await prisma.organization.updateMany({ where: { members: { some: { user: { email: second.email } } } }, data: { isDemo: true } });
    await saveOrganizationBranding(LEAGUE, "", "", { city: "Cincinnati", region: "OH", country: "" });
    expect(await noticesFor(leagueId), "the demo club started a notice").toHaveLength(0);
  });
});

describe("what the Commissioner reads, and who may dismiss it", () => {
  it("is worded with the name, town and founder's NAME and no email, and sends no mail", async () => {
    await saveOrganizationBranding(LEAGUE, "", "", { city: "Cincinnati", region: "OH", country: "" });
    const [seen] = await openNamesakeNotices(leagueId);
    expect(seen.words).toContain(`“${LEAGUE}”`);
    expect(seen.words).toContain("Cincinnati, OH");
    expect(seen.words).toContain(second.name);
    expect(seen.words).not.toContain("@");
    expect(mail, "a notice must never send an email").toEqual([]);
  });

  it("a plain save of the FIRST club's settings does not tell the second club that it took the name", async () => {
    await saveOrganizationBranding(LEAGUE, "", "", { city: "Cincinnati", region: "OH", country: "" });
    const secondOrg = await prisma.organization.findFirstOrThrow({ where: { members: { some: { user: { email: second.email } } } }, select: { id: true } });
    asTheLeague();
    // Same name, a different short name: nothing about the NAME changed.
    const res = await saveOrganizationBranding(LEAGUE, "Thursday", "", { city: "Cincinnati", region: "OH", country: "" });
    expect(res.ok).toBe(true);
    expect(await prisma.namesakeNotice.count({ where: { organizationId: secondOrg.id } }), "the older club told the newer one it took the name").toBe(0);
    expect(await noticesFor(leagueId), "the original notice was lost").toHaveLength(1);
  });

  it("the question to the second club never names the first club's founder by an address either", async () => {
    await prisma.user.updateMany({ where: { email: boss.email }, data: { name: boss.email } });
    try {
      const hit = await otherOrganizationNamed(LEAGUE, null, { city: "Cincinnati", region: "OH", country: "" });
      expect(hit?.runBy).toBe("");
    } finally {
      await prisma.user.updateMany({ where: { email: boss.email }, data: { name: boss.name } });
    }
  });

  it("says a club that existed TOOK the name, and one made with it was SET UP; neither shows an address", async () => {
    await prisma.user.updateMany({ where: { email: second.email }, data: { name: second.email } });
    await saveOrganizationBranding(LEAGUE, "", "", { city: "Cincinnati", region: "OH", country: "" });
    const [renamed] = await openNamesakeNotices(leagueId);
    expect((await noticesFor(leagueId))[0].byName, "an address was stored").toBe("");
    expect(renamed.words).toContain("took the name");
    expect(renamed.words).not.toContain("@");
    expect(renamed.words).toContain("ask them to join");

    await prisma.namesakeNotice.deleteMany({ where: { organizationId: leagueId } });
    await createOrganizationWithOwner({ email: `${lower}-made@example.invalid`, displayName: `${TAG} Made Founder`, orgName: LEAGUE, kind: "club" });
    const [made] = await openNamesakeNotices(leagueId);
    expect(made.words).toContain("was set up on");
    expect(made.words).toContain(`by ${TAG} Made Founder`);
  });

  it("is dismissed by the club's Commissioner, stays dismissed, and is not raised again", async () => {
    await saveOrganizationBranding(LEAGUE, "", "", { city: "Cincinnati", region: "OH", country: "" });
    const [notice] = await noticesFor(leagueId);
    asTheLeague();
    const res = await dismissNamesakeNotice(notice.id);
    expect(res.ok, res.error).toBe(true);
    expect((await prisma.namesakeNotice.findUnique({ where: { id: notice.id } }))?.status).toBe("dismissed");
    expect(await openNamesakeNotices(leagueId)).toHaveLength(0);

    // The other club saves its settings again: the dismissed notice is not resurrected.
    session.email = second.email; session.name = second.name; session.eventId = "";
    await saveOrganizationBranding(LEAGUE, "", "", { city: "Cincinnati", region: "OH", country: "" });
    expect((await prisma.namesakeNotice.findUnique({ where: { id: notice.id } }))?.status).toBe("dismissed");
    expect(await prisma.namesakeNotice.count({ where: { organizationId: leagueId } })).toBe(1);
  });

  it("is refused to the staff of a different club, whatever id they post", async () => {
    await saveOrganizationBranding(LEAGUE, "", "", { city: "Cincinnati", region: "OH", country: "" });
    const [notice] = await noticesFor(leagueId);
    session.email = stranger.email; session.name = stranger.name; session.eventId = "";
    expect(strangerOrgId).not.toBe(leagueId);
    const res = await dismissNamesakeNotice(notice.id);
    expect(res.ok).toBe(false);
    expect((await prisma.namesakeNotice.findUnique({ where: { id: notice.id } }))?.status, "another club's staff dismissed it").toBe("open");
  });

  it("is refused to somebody who is not staff of the club at all", async () => {
    await saveOrganizationBranding(LEAGUE, "", "", { city: "Cincinnati", region: "OH", country: "" });
    const [notice] = await noticesFor(leagueId);
    // A member on the roster of the league's tournament with no organization role: signed in against the league's event.
    const nobody = `${lower}-nobody@example.invalid`;
    await prisma.user.create({ data: { email: nobody, name: `${TAG} Nobody`, password: "x:unusable" } });
    session.email = nobody; session.name = `${TAG} Nobody`; session.eventId = leagueEventId; session.role = "player";
    try {
      const res = await dismissNamesakeNotice(notice.id);
      expect(res.ok).toBe(false);
    } finally {
      session.role = "admin";
    }
    expect((await prisma.namesakeNotice.findUnique({ where: { id: notice.id } }))?.status).toBe("open");
  });
});
