import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE DEMO CLUB, AGAINST REAL ROWS (2026-10-24; docs/claude/demo-club.md).
 *
 * The demo is built by the same function the owner's button calls
 * (`buildDemoClub`), under this file's own `zz-demo` mark, and taken down in a
 * `finally`. What is held here:
 *
 *   the build       two tournaments; the finished one completed, every card approved
 *   refresh         twice is the same club, the same two boards, nothing doubled
 *   refusal         a REAL club holding the demo's name is never touched
 *   a stranger      the owner's action refuses anybody who is not the owner
 *   the replay      the board at 9:00 and at 11:30 by the club's clock are different
 *                   boards, a tick writes nothing twice, a new day starts again
 *
 * and EACH EXCLUSION WITH ITS CONTROL — the demo left out, and a real club in
 * the same place NOT left out, so the exclusion cannot pass by excluding
 * everybody:
 *
 *   the deploy freeze, owner counts, interest counts, plan limits, billing,
 *   the namesake listing, email, text and push.
 *
 * The canary's exclusion is `prod-smoke-refuses-the-demo.test.ts`; the search
 * engines' is `the-demo-club-is-not-indexed.test.ts`.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/the-demo-club.audit.test.ts
 */

// Real senders, held at the wire: a Resend that records, a web-push that records.
const wire = vi.hoisted(() => {
  process.env.RESEND_API_KEY = "re_test_demo_club_never_sent";
  process.env.VAPID_PUBLIC_KEY = "BDemoClubPublicKeyForTheTestOnly";
  process.env.VAPID_PRIVATE_KEY = "demo-club-private-key-for-the-test-only";
  return { emails: [] as unknown[], pushes: [] as unknown[] };
});
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: async (m: unknown) => (wire.emails.push(m), { data: { id: "x" }, error: null }) };
  },
}));
vi.mock("web-push", () => ({
  default: { setVapidDetails: () => {}, sendNotification: async (s: unknown) => void wire.pushes.push(s) },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/auth", () => ({ getSession: async () => null }));

import { advanceDemoReplay, buildDemoClub, DEMO_NAME_TAKEN, demoStatus } from "@/lib/services/demo-club";
import { DEMO_EMAIL_DOMAIN, DEMO_FIELD, demoClubName, demoShareTokens } from "@/lib/domain/demo-club";
import { refreshDemoClub } from "@/app/actions/owner";
import { liveBoard } from "@/lib/services/live-board";
import { currentDeployWindow } from "@/lib/services/deploy-window";
import { ownerCounts, interestShown } from "@/lib/services/owner-counts";
import { fieldCapFor } from "@/lib/services/limits";
import { checkoutUrl, DEMO_NOT_BILLED } from "@/lib/services/billing";
import { otherOrganizationNamed } from "@/lib/services/organization";
import { sendRegistrationEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { sendPushToEmails } from "@/lib/services/push";
import { pricingOverrides } from "@/lib/plans";
import { removeDemoClub, demoTestMark } from "../../../e2e/demo-fixture.mjs";

const prisma = new PrismaClient();
const MARK = `${demoTestMark()}-audit`;
const REAL = `${MARK} real`;
const ZONE = "America/New_York";

/** An instant by the demo club's wall clock, on a WEDNESDAY years ahead: no club's weekend morning, no real tournament. */
function atClub(hhmm: string, day = "2031-03-12"): Date {
  // March 12th 2031 is after the US clocks change (March 9th): New York is UTC-4.
  return new Date(`${day}T${hhmm}:00-04:00`);
}

async function realClub(name: string) {
  return prisma.organization.create({ data: { name, kind: "club", timeZone: ZONE } });
}

async function cleanup() {
  await removeDemoClub(prisma, MARK);
  const real = await prisma.organization.findMany({ where: { name: { startsWith: REAL } }, select: { id: true } });
  const ids = real.map((o) => o.id);
  await prisma.event.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.subscription.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  await prisma.interestRequest.deleteMany({ where: { email: { startsWith: MARK } } });
  await prisma.pushSubscription.deleteMany({ where: { email: { startsWith: MARK } } });
}

const markWas = process.env.DEMO_CLUB_MARK;
beforeAll(async () => {
  // The owner's action builds THIS file's demo if anything ever lets a stranger press it —
  // so a broken gate shows up as a demo this file removes, never as the bare one.
  process.env.DEMO_CLUB_MARK = MARK;
  await cleanup();
});
afterAll(async () => {
  try {
    await cleanup();
  } finally {
    if (markWas === undefined) delete process.env.DEMO_CLUB_MARK;
    else process.env.DEMO_CLUB_MARK = markWas;
    await prisma.$disconnect();
  }
});

async function demoOrg() {
  return prisma.organization.findFirstOrThrow({ where: { name: demoClubName(MARK), isDemo: true } });
}
async function demoEvent(which: "today" | "finished") {
  return prisma.event.findUniqueOrThrow({ where: { shareToken: demoShareTokens(MARK)[which] }, include: { stages: true } });
}

describe("the demo club is built, and built again", () => {
  it("builds an invented club with a finished championship and a medal playing today", async () => {
    const built = await buildDemoClub({ mark: MARK, at: atClub("07:00") });
    expect(built.ok, JSON.stringify(built)).toBe(true);
    const org = await demoOrg();
    expect(org.isDemo).toBe(true);
    expect(org.timeZone).toBe(ZONE);

    const finished = await demoEvent("finished");
    expect(finished.status).toBe("completed");
    expect(finished.stages).toHaveLength(2);
    expect(finished.stages.every((s) => s.closedAt !== null)).toBe(true);
    const cards = await prisma.scorecard.findMany({ where: { eventId: finished.id } });
    expect(cards).toHaveLength(DEMO_FIELD.length * 2);
    expect(cards.every((c) => c.status === "approved")).toBe(true);
    expect(cards.every((c) => (JSON.parse(c.strokes) as number[]).filter((s) => s > 0).length === 18)).toBe(true);
    // The finished board is final, on the app's own reader.
    expect((await liveBoard(finished.id))?.official).toBe(true);

    const today = await demoEvent("today");
    expect(today.status).toBe("live");
    expect(today.stages[0].playedOn).toBe("2031-03-12");
    expect(today.stages[0].accessCode, "the medal has no round code for the QR").not.toBe("");
    // Seven in the morning at the club: nobody is off yet.
    expect(await prisma.scorecard.count({ where: { eventId: today.id } })).toBe(0);
    // Nobody in the demo has an address: there is nobody to send anything to.
    expect(await prisma.player.count({ where: { eventId: { in: [today.id, finished.id] }, NOT: { email: "" } } })).toBe(0);
  });

  it("refreshed twice is the same club and the same two boards, with nothing doubled", async () => {
    const first = await demoOrg();
    await buildDemoClub({ mark: MARK, at: atClub("07:00") });
    await buildDemoClub({ mark: MARK, at: atClub("07:00") });
    const clubs = await prisma.organization.findMany({ where: { name: demoClubName(MARK) } });
    expect(clubs.map((c) => c.id)).toEqual([first.id]);
    expect(await prisma.event.count({ where: { organizationId: first.id } })).toBe(2);
    expect(await prisma.course.count({ where: { organizationId: first.id } })).toBe(1);
    expect(await prisma.player.count({ where: { event: { organizationId: first.id } } })).toBe(DEMO_FIELD.length * 2);
    expect((await demoStatus(MARK)).built).toBe(true);
  });

  it("refuses, writing nothing, when a REAL club holds the demo's name", async () => {
    const mark = `${MARK}-taken`;
    const name = demoClubName(mark);
    const real = await prisma.organization.create({ data: { name, kind: "club" } });
    try {
      const event = await prisma.event.create({
        data: { organizationId: real.id, name: "zz real medal", dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${mark}-real` },
      });
      const res = await buildDemoClub({ mark, at: atClub("09:00") });
      expect(res).toEqual({ ok: false, error: DEMO_NAME_TAKEN });
      const after = await prisma.organization.findUniqueOrThrow({ where: { id: real.id } });
      expect(after.isDemo, "the real club was marked as the demo").toBe(false);
      expect(await prisma.event.findUnique({ where: { id: event.id } }), "the real club's tournament was deleted").not.toBeNull();
      expect(await prisma.event.count({ where: { organizationId: real.id } })).toBe(1);
      // And the replay will not touch it either: it only finds a club carrying the mark.
      expect(await advanceDemoReplay({ mark, at: atClub("12:00") })).toEqual({ ok: false, reason: "no demo" });
    } finally {
      await prisma.event.deleteMany({ where: { organizationId: real.id } });
      await prisma.organization.delete({ where: { id: real.id } });
    }
  });

  it("refuses the owner's action to anybody who is not the owner, and builds nothing", async () => {
    const before = await prisma.organization.count({ where: { isDemo: true } });
    const updatedBefore = (await prisma.organization.findFirst({ where: { name: demoClubName(MARK) }, select: { updatedAt: true } }))?.updatedAt;
    expect(await refreshDemoClub()).toEqual({ ok: false, error: "Not found." });
    expect(await prisma.organization.count({ where: { isDemo: true } })).toBe(before);
    const updatedAfter = (await prisma.organization.findFirst({ where: { name: demoClubName(MARK) }, select: { updatedAt: true } }))?.updatedAt;
    expect(updatedAfter, "a stranger's press rebuilt the demo").toEqual(updatedBefore);
  });
});

describe("the replay plays the club's day by the club's clock", () => {
  it("moves the board between 9:00 and 11:30, writes nothing twice, and starts again the next day", async () => {
    await buildDemoClub({ mark: MARK, at: atClub("07:00") });
    const event = await demoEvent("today");
    const thru = async () => {
      const board = await liveBoard(event.id);
      return new Map((board?.rows ?? []).map((r) => [r.id, r.thru]));
    };

    const nine = await advanceDemoReplay({ mark: MARK, at: atClub("09:00") });
    expect(nine).toMatchObject({ ok: true, reset: false });
    const atNine = await thru();
    // 8:00 off: 60 minutes, four holes; 8:30 off: two holes; 9:00 off: none yet.
    const players = await prisma.player.findMany({ where: { eventId: event.id }, orderBy: { seed: "asc" } });
    expect(atNine.get(players[0].id), "the first group at nine").toBe(4);
    expect(atNine.get(players[3].id), "the second group at nine").toBe(2);
    expect(atNine.get(players[6].id) ?? 0, "the third group goes off at nine").toBe(0);

    const again = await advanceDemoReplay({ mark: MARK, at: atClub("09:00") });
    expect(again).toMatchObject({ ok: true, holesWritten: 0 });

    await advanceDemoReplay({ mark: MARK, at: atClub("11:30") });
    const atHalfEleven = await thru();
    expect(atHalfEleven.get(players[0].id), "the first group at half eleven").toBe(15);
    expect(atHalfEleven.get(players[6].id), "the third group at half eleven").toBe(10);
    expect(atHalfEleven.get(players[21].id) ?? 0, "the last group is off at half eleven").toBe(0);
    // A board that moved, not merely a count: some line reads differently at 11:30 than at 9:00.
    expect([...atHalfEleven.entries()].some(([id, t]) => (atNine.get(id) ?? 0) !== t)).toBe(true);

    // A visitor taps a hole-in-one on a hole the group has played: the next tick puts the club's day back.
    const card = await prisma.scorecard.findFirstOrThrow({ where: { eventId: event.id, playerId: players[0].id } });
    const scripted = JSON.parse(card.strokes) as number[];
    await prisma.scorecard.update({ where: { id: card.id }, data: { strokes: JSON.stringify([1, ...scripted.slice(1)]) } });
    const putBack = await advanceDemoReplay({ mark: MARK, at: atClub("11:31") });
    expect(putBack).toMatchObject({ ok: true, cards: 1, holesWritten: 1 });
    const after = await prisma.scorecard.findFirstOrThrow({ where: { id: card.id } });
    expect(JSON.parse(after.strokes)).toEqual(scripted);

    // The next morning at the club: the medal starts again, dated that day, and the
    // championship moves with it so it is always earlier in the week.
    const next = await advanceDemoReplay({ mark: MARK, at: atClub("06:00", "2031-03-13") });
    expect(next).toMatchObject({ ok: true, reset: true, holesWritten: 0, day: "2031-03-13" });
    expect(await prisma.scorecard.count({ where: { eventId: event.id } })).toBe(0);
    expect((await demoEvent("today")).stages[0].playedOn).toBe("2031-03-13");
    expect((await demoEvent("finished")).endOn).toBe("2031-03-10");
  });
});

describe("the demo club is left out of what is about real clubs — each with a control", () => {
  let demo = { orgId: "", eventId: "" };
  let real = { orgId: "", eventId: "" };

  beforeAll(async () => {
    await buildDemoClub({ mark: MARK, at: atClub("13:00") });
    demo = { orgId: (await demoOrg()).id, eventId: (await demoEvent("today")).id };
    const org = await realClub(`${REAL} Fenwick Vale Golf Club`);
    const event = await prisma.event.create({
      data: {
        organizationId: org.id, name: `${REAL} medal`, dates: "", course: "", city: "", address: "", regDeadline: "",
        shareToken: `${REAL}-medal`.replace(/\s/g, "-"), status: "live", startOn: "2031-03-12", endOn: "2031-03-12",
      },
    });
    real = { orgId: org.id, eventId: event.id };
  });

  it("the deploy freeze: a demo tournament today does not freeze, a real club's tournament today does", async () => {
    await prisma.event.update({ where: { id: real.eventId }, data: { status: "draft" } });
    const demoOnly = await currentDeployWindow(atClub("13:00"));
    expect(demoOnly.frozen, `frozen by the demo: ${demoOnly.reason}`).toBe(false);
    await prisma.event.update({ where: { id: real.eventId }, data: { status: "live" } });
    const withReal = await currentDeployWindow(atClub("13:00"));
    expect(withReal.frozen, "CONTROL: a real club playing today did not freeze the deploy").toBe(true);
  });

  it("owner counts: the demo is in no total and no list; a real club is", async () => {
    const counts = await ownerCounts();
    expect(counts.recentOrgs.map((o) => o.id)).not.toContain(demo.orgId);
    expect(counts.recentOrgs.map((o) => o.id), "CONTROL: a new real club is not among the newest").toContain(real.orgId);
    expect(counts.liveEvents.map((e) => e.id)).not.toContain(demo.eventId);
    expect(counts.liveEvents.map((e) => e.id), "CONTROL: a real live tournament is not live right now").toContain(real.eventId);
    // The totals: the same with the demo's own rows taken away, and different without the real club.
    const all = await prisma.organization.count();
    const demos = await prisma.organization.count({ where: { isDemo: true } });
    expect(counts.totalOrgs).toBe(all - demos);
    const players = await prisma.player.count();
    const demoPlayers = await prisma.player.count({ where: { event: { organization: { isDemo: true } } } });
    expect(demoPlayers).toBeGreaterThan(0);
    expect(counts.totalPlayers).toBe(players - demoPlayers);
  });

  it("interest counts: a row on the demo's domain is not counted; any other is", async () => {
    await prisma.interestRequest.createMany({
      data: [
        { name: "Zz Demo", email: `${MARK}-row@${DEMO_EMAIL_DOMAIN}`, club: "zz" },
        { name: "Zz Real", email: `${MARK}-row@example.org`, club: "zz" },
      ],
    });
    const shown = (await interestShown(10_000)).map((r) => r.email);
    expect(shown).not.toContain(`${MARK}-row@${DEMO_EMAIL_DOMAIN}`);
    expect(shown, "CONTROL: a real registration is not listed").toContain(`${MARK}-row@example.org`);
  });

  it("plan limits: the demo is capped by no plan; a real club on the same terms is", async () => {
    for (const id of [demo.orgId, real.orgId]) {
      await prisma.subscription.upsert({ where: { organizationId: id }, update: { plan: "free", planTermsApply: true }, create: { organizationId: id, plan: "free", planTermsApply: true } });
    }
    try {
      expect(await fieldCapFor(demo.orgId)).toBeNull();
      expect(await fieldCapFor(real.orgId), "CONTROL: a real club held to the free terms was not capped").not.toBeNull();
    } finally {
      await prisma.subscription.deleteMany({ where: { organizationId: { in: [demo.orgId, real.orgId] } } });
    }
  });

  it("billing: the demo is refused a payment page before Stripe is asked; a real club is not refused for being the demo", async () => {
    const ask = (organizationId: string) =>
      checkoutUrl({ organizationId, plan: "society", interval: "month", currency: "USD", overrides: pricingOverrides(), email: null, origin: "http://localhost" });
    expect(await ask(demo.orgId)).toEqual({ error: DEMO_NOT_BILLED });
    expect(await ask(real.orgId), "CONTROL").not.toEqual({ error: DEMO_NOT_BILLED });
    expect(await prisma.subscription.findUnique({ where: { organizationId: demo.orgId } }), "the demo was given a billing row").toBeNull();
  });

  it("the namesake listing: nobody is pointed at the demo club; a real club of a name is found", async () => {
    expect(await otherOrganizationNamed(demoClubName(MARK))).toBeNull();
    expect(await otherOrganizationNamed(`${REAL} Fenwick Vale Golf Club`), "CONTROL").not.toBeNull();
  });

  it("email: nothing is sent for the demo club, or to its domain; a real club's is sent", async () => {
    wire.emails.length = 0;
    await sendRegistrationEmail("zz-demo-entrant@example.org", { eventName: "x", status: "confirmed", organizationId: demo.orgId, eventId: demo.eventId });
    await sendRegistrationEmail(`${MARK}-x@${DEMO_EMAIL_DOMAIN}`, { eventName: "x", status: "confirmed", organizationId: real.orgId, eventId: real.eventId });
    expect(wire.emails, "the demo sent an email").toHaveLength(0);
    await sendRegistrationEmail("zz-demo-entrant@example.org", { eventName: "x", status: "confirmed", organizationId: real.orgId, eventId: real.eventId });
    expect(wire.emails, "CONTROL: a real club's email did not reach the wire").toHaveLength(1);
  });

  it("text: the demo club texts nobody; a real club's text goes on to the carrier", async () => {
    expect(await sendSms("+15555550100", "x", { organizationId: demo.orgId })).toEqual({ ok: false, error: "The demo club sends nothing." });
    const res = await sendSms("+15555550100", "x", { organizationId: real.orgId });
    expect(res.error, "CONTROL: a real club's text was refused as the demo's").not.toBe("The demo club sends nothing.");
  });

  it("push: nothing is pushed about the demo club's tournaments; a real club's push goes", async () => {
    const email = `${MARK}-device@example.org`;
    await prisma.pushSubscription.create({ data: { endpoint: `https://push.example.invalid/${MARK}`, p256dh: "k", auth: "a", email } });
    wire.pushes.length = 0;
    await sendPushToEmails([email], { title: "t", body: "b" }, { eventId: demo.eventId });
    expect(wire.pushes, "the demo pushed a notification").toHaveLength(0);
    await sendPushToEmails([email], { title: "t", body: "b" }, { eventId: real.eventId });
    expect(wire.pushes, "CONTROL: a real club's push did not go").toHaveLength(1);
  });
});
