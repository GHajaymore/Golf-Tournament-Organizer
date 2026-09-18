import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * ASKING A CLUB TO LET YOU IN.
 *
 * The other half of the same-name warning. That warning names who runs the
 * outfit and says "ask them to add you", and then the app stops helping: there
 * is no address, and there should not be. This is the ask, made in the app.
 *
 * The cells here are the ones that need real rows, and each is a rule that
 * would be invisible in a unit test:
 *
 *   - you may only ask the outfit the WARNING itself would have named. There
 *     is no organization id in the endpoint and no search, so a club three
 *     counties away cannot be asked at all.
 *   - asking twice does not stack, and does not re-send.
 *   - only an owner or admin may answer, and only for THEIR OWN outfit.
 *   - approving as Admin costs a staff seat, and the refusal says who.
 *   - a declined ask is kept, not deleted.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ASKJOIN";
const LEAGUE = `${TAG} Thursday Night League`;

const session = { email: "", name: "", eventId: "", role: "admin", viewRole: "admin" };
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  setActiveEvent: async () => {},
  requireStaff: async () => session.eventId,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
/**
 * No mail leaves a test. The sender is fire-and-forget by design, so stubbing
 * it proves nothing about the action — but a suite that quietly needs an API
 * key is a suite that behaves differently on the machine that has one.
 */
const sent: Array<{ to: string; asker: string }> = [];
vi.mock("@/lib/email", () => ({
  sendJoinRequestEmail: async (to: string, opts: { askerName: string }) => {
    sent.push({ to, asker: opts.askerName });
  },
  sendStaffInviteEmail: async () => {},
}));

const { askToJoinNamesake, approveJoinRequest, declineJoinRequest } = await import("@/app/actions/join");

const asker = { email: `${TAG.toLowerCase()}-asker@example.invalid`, name: `${TAG} Second Secretary` };
const boss = { email: `${TAG.toLowerCase()}-boss@example.invalid`, name: `${TAG} First Secretary` };

let leagueId = "";
let leagueEventId = "";
let askerUserId = "";

async function scrub() {
  const orgs = await prisma.organization.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  if (orgs.length) {
    await prisma.event.deleteMany({ where: { organizationId: { in: orgs.map((o) => o.id) } } });
  }
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
}

/** An outfit with an owner, a member on its roster, and a town. */
async function outfit(name: string, who: { email: string; name: string }, city: string) {
  const user = await prisma.user.create({ data: { email: who.email, name: who.name, password: "x:unusable" } });
  const org = await prisma.organization.create({
    data: {
      name,
      kind: "community",
      city,
      region: "OH",
      country: "US",
      members: { create: { userId: user.id, role: "owner" } },
    },
  });
  await prisma.member.create({
    data: { organizationId: org.id, name: `${TAG} A Member`, email: `${TAG.toLowerCase()}-m-${org.id}@example.invalid` },
  });
  return { userId: user.id, organizationId: org.id };
}

beforeAll(async () => {
  await scrub();
  const first = await outfit(LEAGUE, boss, "Cincinnati");
  leagueId = first.organizationId;
  // An event of the league's, so its owner has one to be "in" when answering.
  leagueEventId = (
    await prisma.event.create({
      data: {
        organizationId: leagueId,
        name: `${TAG} Week 1`,
        status: "registration", shape: "series", format: "stroke", formationRule: "balanced",
        dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
        shareToken: `${TAG.toLowerCase()}-share-1`,
        registrationToken: `${TAG.toLowerCase()}-reg-1`,
      },
    })
  ).id;
});

beforeEach(async () => {
  sent.length = 0;
  /**
   * THE LIMITER IS REAL, SO IT HAS TO BE RESET BETWEEN CELLS.
   *
   * Three asks an hour, keyed on the asker's email — and every cell here asks
   * as the same person, so without this the fourth cell onwards measured the
   * rate limiter rather than the thing it was written for. Found the honest
   * way: six cells went red with "Too many requests to join."
   *
   * Cleared rather than mocked, and the limit gets its own cell below, so this
   * does not become a suite that silently proves the limiter is absent.
   */
  await prisma.rateLimitHit.deleteMany({ where: { key: { startsWith: "join-request:" } } });
  await prisma.joinRequest.deleteMany({ where: { organizationId: leagueId } });
  await prisma.organizationMember.deleteMany({
    where: { organizationId: leagueId, user: { email: asker.email } },
  });
  await prisma.user.deleteMany({ where: { email: asker.email } });
  await prisma.organization.deleteMany({ where: { name: asker.name } });
  const second = await outfit(asker.name, asker, "Cincinnati");
  askerUserId = second.userId;
  session.email = asker.email;
  session.name = asker.name;
  session.eventId = "";
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

/** Sign in as the league's owner, looking at the league's own event. */
function asTheLeague() {
  session.email = boss.email;
  session.name = boss.name;
  session.eventId = leagueEventId;
}

describe("asking to be let in", () => {
  it("reaches the outfit the warning named, and tells its owners", async () => {
    const res = await askToJoinNamesake(LEAGUE, "I run the Thursday draw with them");
    expect(res.ok, res.error).toBe(true);
    expect(res.asked).toBe(LEAGUE);

    const row = await prisma.joinRequest.findFirstOrThrow({
      where: { organizationId: leagueId, userId: askerUserId },
      select: { status: true, note: true },
    });
    expect(row.status).toBe("pending");
    expect(row.note).toBe("I run the Thursday draw with them");

    // The club hears about it, because a secretary does not sign in on a
    // Tuesday to check whether anybody asked.
    expect(sent.map((s) => s.to)).toEqual([boss.email]);
  });

  it("cannot reach an outfit that is not near them — there is no id and no search", async () => {
    /**
     * The endpoint takes a NAME, never an organization id, and resolves it the
     * way the warning did: same matcher, same area rule. So this is not a
     * matter of a check that could be skipped — a club in another state is
     * unreachable from here.
     */
    const far = await outfit(`${TAG} Austin Thursday League`, { email: `${TAG.toLowerCase()}-far@example.invalid`, name: `${TAG} Far` }, "Austin");
    await prisma.organization.update({ where: { id: far.organizationId }, data: { region: "TX" } });

    const res = await askToJoinNamesake(`${TAG} Austin Thursday League`, "");
    expect(res.ok).toBe(false);
    expect(await prisma.joinRequest.count({ where: { organizationId: far.organizationId } })).toBe(0);
  });

  it("does not stack, and does not send a second mail", async () => {
    expect((await askToJoinNamesake(LEAGUE, "first")).ok).toBe(true);
    const again = await askToJoinNamesake(LEAGUE, "second");

    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/already asked/i);
    expect(await prisma.joinRequest.count({ where: { organizationId: leagueId } })).toBe(1);
    expect(sent.length, "a second mail went out for one ask").toBe(1);
  });

  it("is rate limited, because it puts mail in a stranger's inbox", async () => {
    /**
     * The control for the reset in `beforeEach`. Without a cell that watches
     * the limiter bite, clearing those rows between tests would quietly turn
     * this suite into proof that no limiter exists.
     *
     * Three an hour: a person asks their own club once, twice if they mistype.
     * Anything past that is somebody being pestered.
     */
    const farOutfits = ["A", "B", "C", "D"].map((s) => `${TAG} Nowhere League ${s}`);
    let lastError = "";
    for (const name of farOutfits) {
      const res = await askToJoinNamesake(name, "");
      // Each is refused for not existing; the point is that they are COUNTED.
      lastError = res.error ?? "";
    }
    expect(lastError, "the fourth ask in an hour was not throttled").toMatch(/Too many requests/i);
  });

  it("refuses somebody who is already in", async () => {
    await prisma.organizationMember.create({
      data: { organizationId: leagueId, userId: askerUserId, role: "member" },
    });
    const res = await askToJoinNamesake(LEAGUE, "");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already in/i);
  });
});

describe("the club answering", () => {
  it("lets them in as an Admin, and records who decided", async () => {
    expect((await askToJoinNamesake(LEAGUE, "")).ok).toBe(true);
    const ask = await prisma.joinRequest.findFirstOrThrow({
      where: { organizationId: leagueId },
      select: { id: true },
    });

    asTheLeague();
    expect(await approveJoinRequest(ask.id, "admin")).toEqual({ ok: true });

    const membership = await prisma.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: leagueId, userId: askerUserId } },
      select: { role: true },
    });
    // ADMIN, because whoever asks is the league's other organizer. A Member
    // could see the calendar and run nothing, and would go build their own.
    expect(membership.role).toBe("admin");

    const after = await prisma.joinRequest.findUniqueOrThrow({
      where: { id: ask.id },
      select: { status: true, decidedBy: true, decidedRole: true, decidedAt: true },
    });
    expect(after.status).toBe("approved");
    expect(after.decidedRole).toBe("admin");
    expect(after.decidedBy, "nobody is named as having let them in").toBe(boss.name);
    expect(after.decidedAt).not.toBeNull();
  });

  it("refuses an answer from somebody inside the club who is not staff", async () => {
    /**
     * WRITTEN TWICE, and the first version was decoration.
     *
     * It signed in as the asker with no active event, so `organizationAccess`
     * returned null and the action refused with "no organization found" — a
     * green cell that never reached the permission check at all. Deleting
     * `canEdit` left it passing, which is exactly the mutation failure
     * CLAUDE.md describes: the cell could not express the wrong answer.
     *
     * So the caller here is INSIDE the league — a `member`, the staff pool
     * role that carries no rights of its own — looking at the league's own
     * event. `organizationAccess` resolves the league, and the only thing
     * standing between them and letting themselves in is `canEdit`.
     */
    expect((await askToJoinNamesake(LEAGUE, "")).ok).toBe(true);
    const ask = await prisma.joinRequest.findFirstOrThrow({
      where: { organizationId: leagueId },
      select: { id: true },
    });

    await prisma.organizationMember.create({
      data: { organizationId: leagueId, userId: askerUserId, role: "member" },
    });
    session.eventId = leagueEventId;
    // Not an admin of the EVENT either — the other half of `canAdministerOrg`.
    session.role = "player";
    session.viewRole = "player";

    try {
      const res = await approveJoinRequest(ask.id, "admin");
      expect(res.ok, "a member of the club answered a request to join it").toBe(false);
      expect(res.error).toMatch(/owner or admin/i);

      const membership = await prisma.organizationMember.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: leagueId, userId: askerUserId } },
        select: { role: true },
      });
      expect(membership.role, "they promoted themselves to admin").toBe("member");
      expect(
        (await prisma.joinRequest.findUniqueOrThrow({ where: { id: ask.id }, select: { status: true } })).status,
      ).toBe("pending");
    } finally {
      session.role = "admin";
      session.viewRole = "admin";
    }
  });

  it("charges a staff seat for an Admin, and says who cannot be added", async () => {
    expect((await askToJoinNamesake(LEAGUE, "")).ok).toBe(true);
    const ask = await prisma.joinRequest.findFirstOrThrow({
      where: { organizationId: leagueId },
      select: { id: true },
    });

    // The free plan's single seat, with enforcement actually on.
    await prisma.subscription.create({
      data: { organizationId: leagueId, plan: "free", status: "active", provider: "stripe" },
    });
    try {
      asTheLeague();
      const refused = await approveJoinRequest(ask.id, "admin");
      expect(refused.ok, "the seat limit is not being enforced at all").toBe(false);
      // NAMED. "Seat limit reached" beside a person's request is the moment to
      // say who cannot be added and what the alternative is.
      expect(refused.error).toContain(asker.name);
      expect(refused.error).toMatch(/Member/);

      // And the alternative actually works, without a seat.
      expect(await approveJoinRequest(ask.id, "member")).toEqual({ ok: true });
      const membership = await prisma.organizationMember.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: leagueId, userId: askerUserId } },
        select: { role: true },
      });
      expect(membership.role).toBe("member");
    } finally {
      await prisma.subscription.deleteMany({ where: { organizationId: leagueId } });
    }
  });

  it("reopens the same row when somebody declined by mistake asks again", async () => {
    /**
     * WRITTEN BECAUSE A MUTATION SURVIVED. The action resets the row to
     * pending on a second ask, the comment above it says why — somebody
     * declined by mistake needs a way back — and nothing tested it: dropping
     * the reset left all nine cells green.
     *
     * The club must SEE the new ask, which means `status` back to pending on
     * the one row rather than a second row beside it.
     */
    expect((await askToJoinNamesake(LEAGUE, "first time")).ok).toBe(true);
    const ask = await prisma.joinRequest.findFirstOrThrow({
      where: { organizationId: leagueId },
      select: { id: true },
    });
    asTheLeague();
    expect(await declineJoinRequest(ask.id)).toEqual({ ok: true });

    session.email = asker.email;
    session.name = asker.name;
    session.eventId = "";
    expect((await askToJoinNamesake(LEAGUE, "sorry, it really is me")).ok).toBe(true);

    expect(
      await prisma.joinRequest.count({ where: { organizationId: leagueId, userId: askerUserId } }),
      "a second row was created beside the declined one",
    ).toBe(1);
    const again = await prisma.joinRequest.findUniqueOrThrow({
      where: { id: ask.id },
      select: { status: true, note: true, decidedAt: true, decidedBy: true },
    });
    expect(again.status, "the club will never see this ask").toBe("pending");
    expect(again.note).toBe("sorry, it really is me");
    // The old decision is cleared with it, or the screen would show a pending
    // request that claims somebody already answered it.
    expect(again.decidedAt).toBeNull();
    expect(again.decidedBy).toBe("");
  });

  it("keeps a declined ask rather than deleting it", async () => {
    expect((await askToJoinNamesake(LEAGUE, "")).ok).toBe(true);
    const ask = await prisma.joinRequest.findFirstOrThrow({
      where: { organizationId: leagueId },
      select: { id: true },
    });

    asTheLeague();
    expect(await declineJoinRequest(ask.id)).toEqual({ ok: true });

    const after = await prisma.joinRequest.findUniqueOrThrow({
      where: { id: ask.id },
      select: { status: true, decidedBy: true },
    });
    // Kept: it is what stops the same person asking every morning, and a
    // decision one person made about another is not deleted quietly.
    expect(after.status).toBe("declined");
    expect(after.decidedBy).toBe(boss.name);
    expect(
      await prisma.organizationMember.count({ where: { organizationId: leagueId, userId: askerUserId } }),
    ).toBe(0);
  });
});
