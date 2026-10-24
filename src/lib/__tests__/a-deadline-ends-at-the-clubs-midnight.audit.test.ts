import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A DEADLINE ENDS AT THE CLUB'S MIDNIGHT, NOT THE SERVER'S (2026-10-11).
 *
 * `domain/__tests__/club-clock.test.ts` proves the arithmetic with fixed
 * instants. THIS proves the app uses it: the real entry form, the real entry
 * action, the member's weekly answer, the "which round is it" pointer and the
 * "you have a tournament round today" warning — against real rows, for a club
 * whose day is NOT this machine's day.
 *
 * WHICH CLUB THAT IS DEPENDS ON THE HOUR, and the test picks it. Kiritimati is
 * fourteen hours ahead of UTC and Pago Pago eleven behind, so at any instant
 * at least one of them is on a different calendar day from wherever this is
 * running; each `it` below runs for whichever applies and is reported as
 * SKIPPED for the other, never as passed — and the first test fails if
 * neither did (a check that could quietly cover nothing).
 *
 *   club AHEAD   its today is this machine's tomorrow. A closing date of the
 *                machine's today has GONE at the club. The old code, asking
 *                the server, left it open.
 *   club BEHIND  its today is this machine's yesterday. A closing date of the
 *                club's today is STILL OPEN. The old code closed it.
 *
 * And the control that makes it mean something: a club that has not said
 * where it is behaves exactly as every club did before.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Map<string, string>(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { registerForEvent } from "@/app/actions/register";
import { setOwnAttendance } from "@/app/actions/attendance";
import { adoptClubTimeZone, saveOrganizationTimeZone } from "@/app/actions/organization";
import { openRegistrationView } from "@/lib/services/registration";
import { loadEventState } from "@/lib/services/tournament";
import { tournamentClashFor } from "@/lib/services/tournament-clash";
import { clubToday } from "@/lib/domain/club-clock";
import { todayIso } from "@/lib/deadline";

const prisma = new PrismaClient();
const TAG = `zz-clubclock-${process.pid}`;

const HERE = todayIso(new Date());
const shifted = (iso: string, days: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return todayIso(new Date(y, m - 1, d + days, 12));
};
const AHEAD = "Pacific/Kiritimati";
const BEHIND = "Pacific/Pago_Pago";
const aheadNow = clubToday(AHEAD) > HERE;
const behindNow = clubToday(BEHIND) < HERE;

interface Club {
  org: string;
  event: string;
  token: string;
  /** Two dated rounds: [0] on this machine's today, [1] on the club's today. */
  rounds: string[];
  member: { user: string; email: string };
}

/**
 * A live club tournament taking entries, with weekly sign-up, two dated
 * rounds and one confirmed member who can sign in.
 */
async function club(name: string, timeZone: string, regDeadline: string, optDeadline: string): Promise<Club> {
  const org = await prisma.organization.create({
    data: { name: `${TAG} ${name}`, kind: "club", timeZone },
    select: { id: true },
  });
  const token = `${TAG}-${name}-tok`;
  const event = await prisma.event.create({
    data: {
      name: `${TAG} ${name} medal`,
      organizationId: org.id,
      status: "live",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline,
      registrationOpen: true,
      registrationToken: token,
      attendanceMode: "opt-out",
      shareToken: `${TAG}-${name}`,
    },
    select: { id: true },
  });
  const clubDay = clubToday(timeZone);
  const rounds: string[] = [];
  for (const [position, playedOn] of [HERE, clubDay].entries()) {
    const stage = await prisma.stage.create({
      data: {
        eventId: event.id,
        position,
        type: "Stroke Play Round",
        format: "Stroke Play",
        holes: 18,
        // Distinct even where the two days coincide (the club with no zone).
        playedOn: position === 0 || clubDay !== HERE ? playedOn : shifted(HERE, 7),
        optDeadline,
        description: position === 0 ? "the server's today" : "the club's today",
      },
      select: { id: true },
    });
    rounds.push(stage.id);
  }
  const email = `${TAG}-${name}-member@example.invalid`;
  const user = await prisma.user.create({
    data: { email, name: `${TAG} ${name} Member`, password: "x:unusable", emailVerifiedAt: new Date() },
    select: { id: true },
  });
  await prisma.player.create({
    data: { eventId: event.id, name: `${TAG} ${name} Member`, email, seed: 1, status: "confirmed", handicap: 0 },
  });
  return { org: org.id, event: event.id, token, rounds, member: { user: user.id, email } };
}

async function as(userId: string, eventId: string) {
  jar.clear();
  await createSession(userId);
  await setActiveEvent(eventId);
}

const entrant = (who: string) => ({
  name: `${TAG} ${who}`,
  email: `${TAG}-${who}@example.invalid`,
  handicap: "12",
  phone: "+1 555 010 0199",
});

let ahead: Club | null = null;
let behind: Club | null = null;
let noZone: Club;
let noZoneClosed: Club;

beforeAll(async () => {
  // AHEAD: the machine's today is the club's yesterday — the closing day has gone there.
  if (aheadNow) ahead = await club("ahead", AHEAD, HERE, HERE);
  // BEHIND: the club's today is the machine's yesterday — the closing day is still running there.
  if (behindNow) behind = await club("behind", BEHIND, clubToday(BEHIND), clubToday(BEHIND));
  // No zone: this machine's day, as before. One closing today (open), one that closed yesterday.
  noZone = await club("nozone", "", HERE, HERE);
  noZoneClosed = await club("nozoneclosed", "", shifted(HERE, -1), shifted(HERE, -1));
}, 60_000);

afterAll(async () => {
  try {
    await prisma.rateLimitHit.deleteMany({ where: { key: { contains: TAG } } }).catch(() => {});
    await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("a club whose day is not the server's", () => {
  it("CONTROL: at this hour there is one, in at least one direction", () => {
    expect(aheadNow || behindNow, "neither Kiritimati nor Pago Pago is on another day — the zones no longer bracket the clock").toBe(true);
  });

  it.runIf(aheadNow)("AHEAD: entries that closed yesterday AT THE CLUB are closed, though the server's day has not ended", async () => {
    if (!ahead) throw new Error("the club ahead was not made");
    expect(await openRegistrationView(ahead.token), "the entry form was still shown").toBeNull();
    const result = await registerForEvent(ahead.token, entrant("late-ahead"));
    expect(result.ok, "an entry was taken after the closing day ended at the club").toBe(false);
    expect(await prisma.player.count({ where: { eventId: ahead.event, email: entrant("late-ahead").email } })).toBe(0);
  });

  it.runIf(aheadNow)("AHEAD: the weekly answer is closed too, and the club's today is the round being played", async () => {
    if (!ahead) throw new Error("the club ahead was not made");
    await as(ahead.member.user, ahead.event);
    const answer = await setOwnAttendance(ahead.rounds[1], "out");
    expect(answer.ok, "a member changed their answer after the deadline day ended at the club").toBe(false);

    const state = await loadEventState(ahead.event);
    expect(state?.today).toBe(clubToday(AHEAD));
    expect(state?.timeZone).toBe(AHEAD);
    // Round 2 is dated the club's today, so it is the current one. On the
    // server's day it was still "tomorrow" and Round 1 was current.
    expect(state?.activeStage?.id).toBe(ahead.rounds[1]);

    const clash = await tournamentClashFor(ahead.member.email);
    expect(clash?.roundLabel, "the round warned about is not the one played today at the club").toContain("the club's today");
  });

  it.runIf(behindNow)("BEHIND: entries closing today AT THE CLUB are still open, though the server's day has moved on", async () => {
    if (!behind) throw new Error("the club behind was not made");
    expect(await openRegistrationView(behind.token), "the entry form was withheld on the closing day").not.toBeNull();
    const result = await registerForEvent(behind.token, entrant("intime-behind"));
    expect(result.ok, `an entry on the closing day was refused: ${result.error ?? ""}`).toBe(true);
    expect(await prisma.player.count({ where: { eventId: behind.event, email: entrant("intime-behind").email } })).toBe(1);
  });

  it.runIf(behindNow)("BEHIND: the weekly answer is still open, and the club's today is the round being played", async () => {
    if (!behind) throw new Error("the club behind was not made");
    await as(behind.member.user, behind.event);
    const answer = await setOwnAttendance(behind.rounds[1], "out");
    expect(answer.ok, `a member was refused on the deadline day: ${answer.error ?? ""}`).toBe(true);

    const state = await loadEventState(behind.event);
    expect(state?.today).toBe(clubToday(BEHIND));
    // Round 2 is dated the club's today (the server's yesterday) and Round 1
    // the server's today — which at the club has not come yet.
    expect(state?.activeStage?.id).toBe(behind.rounds[1]);

    const clash = await tournamentClashFor(behind.member.email);
    expect(clash?.roundLabel).toContain("the club's today");
  });
});

describe("CONTROL: a club that has not said where it is", () => {
  it("keeps this machine's day — open on the closing day, closed the day after", async () => {
    expect(await openRegistrationView(noZone.token)).not.toBeNull();
    const taken = await registerForEvent(noZone.token, entrant("nozone-intime"));
    expect(taken.ok, taken.error ?? "").toBe(true);

    expect(await openRegistrationView(noZoneClosed.token)).toBeNull();
    const refused = await registerForEvent(noZoneClosed.token, entrant("nozone-late"));
    expect(refused.ok).toBe(false);

    const state = await loadEventState(noZone.event);
    expect(state?.today).toBe(HERE);
    expect(state?.timeZone).toBe("");
    expect(state?.activeStage?.id).toBe(noZone.rounds[0]);
  });

  it("and its weekly answer follows the same day", async () => {
    await as(noZone.member.user, noZone.event);
    expect((await setOwnAttendance(noZone.rounds[0], "out")).ok).toBe(true);
    await as(noZoneClosed.member.user, noZoneClosed.event);
    expect((await setOwnAttendance(noZoneClosed.rounds[0], "out")).ok).toBe(false);
  });
});

describe("saying where the club is", () => {
  let owner = "";
  let stranger = "";

  beforeAll(async () => {
    const mk = async (who: string, orgId: string, eventId: string) => {
      const email = `${TAG}-${who}@example.invalid`;
      const user = await prisma.user.create({ data: { email, name: `${TAG} ${who}`, password: "x:unusable", emailVerifiedAt: new Date() }, select: { id: true } });
      await prisma.organizationMember.create({ data: { organizationId: orgId, userId: user.id, role: "owner" } });
      await prisma.account.create({ data: { eventId, name: `${TAG} ${who}`, email, role: "admin" } });
      return user.id;
    };
    owner = await mk("owner", noZone.org, noZone.event);
    stranger = await mk("stranger", noZoneClosed.org, noZoneClosed.event);
  });

  const zoneOf = async (orgId: string) =>
    (await prisma.organization.findUnique({ where: { id: orgId }, select: { timeZone: true } }))?.timeZone;

  it("a club with none takes its organizer's zone once, and never a second time", async () => {
    await as(owner, noZone.event);
    expect((await adoptClubTimeZone("Europe/London")).ok).toBe(true);
    expect(await zoneOf(noZone.org)).toBe("Europe/London");
    // A second device in another country does not move the club.
    expect((await adoptClubTimeZone("Asia/Tokyo")).ok).toBe(true);
    expect(await zoneOf(noZone.org)).toBe("Europe/London");
  });

  it("the setting changes it, and answers with the time on the club's wall", async () => {
    await as(owner, noZone.event);
    const result = await saveOrganizationTimeZone("America/New_York");
    expect(result.ok).toBe(true);
    expect(result.clock, "no clock came back to show the organizer").toMatch(/\d/);
    expect(await zoneOf(noZone.org)).toBe("America/New_York");
  });

  it("nothing that is not a zone is stored", async () => {
    await as(owner, noZone.event);
    for (const junk of ["", "Mars/Olympus_Mons", "<script>alert(1)</script>", "UTC+25"]) {
      expect((await saveOrganizationTimeZone(junk)).ok, junk).toBe(false);
    }
    // @ts-expect-error — a "use server" export is called with whatever the caller likes
    expect((await saveOrganizationTimeZone(null)).ok).toBe(false);
    // @ts-expect-error — and with things that are not strings at all
    expect((await saveOrganizationTimeZone({ $ne: "" })).ok).toBe(false);
    expect(await zoneOf(noZone.org)).toBe("America/New_York");
  });

  it("a member cannot move the club's clock, and another club's Commissioner moves only their own", async () => {
    await as(noZone.member.user, noZone.event);
    expect((await saveOrganizationTimeZone("Asia/Tokyo")).ok).toBe(false);
    expect((await adoptClubTimeZone("Asia/Tokyo")).ok).toBe(false);
    expect(await zoneOf(noZone.org)).toBe("America/New_York");

    await as(stranger, noZoneClosed.event);
    expect((await saveOrganizationTimeZone("Asia/Tokyo")).ok).toBe(true);
    expect(await zoneOf(noZoneClosed.org)).toBe("Asia/Tokyo");
    expect(await zoneOf(noZone.org), "one club's setting moved another club's clock").toBe("America/New_York");
  });
});
