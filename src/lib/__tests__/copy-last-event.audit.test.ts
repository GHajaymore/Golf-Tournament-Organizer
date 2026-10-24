import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * COPY LAST EVENT AND WHAT'S NEXT, AGAINST REAL ROWS (the secretary's home,
 * 2026-10-24).
 *
 * A club with last summer's medal — every setting the panel named set to
 * something that is NOT its default, a field, cards, a published tee sheet,
 * side games with people in them and money on them, both public links — and a
 * second club next door. Then, as each kind of person:
 *
 *   another club's Commissioner   refused: the source is not their club's
 *   a Guest made organizer of it  refused: a copy is made in the club's name
 *   a plain member                refused
 *   the club's Commissioner       a day already gone AT THE CLUB is refused;
 *                                 a day ahead makes the copy, which is held
 *                                 field by field to the SOURCE ROW, not to a
 *                                 list of expected values
 *
 * and the original is byte-for-byte what it was. The copy's sign-up link, once
 * opened, is a new address. What's next, for the same people: the club's jobs,
 * the other club's never, and a Guest's with no right to act.
 *
 *   npx vitest run --config vitest.audit.config.ts copy-last-event
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
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createSession, setActiveEvent, getSession } from "@/lib/auth";
import { cloneEvent, setRegistrationOpen } from "@/app/actions/tournament";
import { CLONED_EVENT_FIELDS, CLONED_STAGE_FIELDS, CLONED_CONTEST_FIELDS, CLONED_SIDE_GAME_FIELDS, CLONED_SKINS_POT_FIELDS } from "@/lib/services/clone";
import { secretaryHomeFor } from "@/lib/services/whats-next";
import { clubToday } from "@/lib/domain/club-clock";
import { todayIso } from "@/lib/deadline";
import { addDays, daysBetween } from "@/lib/domain/round-dates";
import { formatDayRange } from "@/lib/domain/locale";
import { COPY_DAY_GONE } from "@/lib/domain/copy-dates";

const prisma = new PrismaClient();
const MARK = "zz-sechome-audit";
const COPY = `${MARK} Summer Medal 2027`;

/**
 * THE CLUB'S ZONE IS ON ANOTHER DAY FROM THIS MACHINE, so a check made on the
 * server's clock and one made on the club's give different answers. Whichever
 * of the two ends of the world is on another calendar day right now.
 */
const SERVER_TODAY = todayIso(new Date());
const ZONE = ["Pacific/Kiritimati", "Pacific/Pago_Pago"].find((z) => clubToday(z) !== SERVER_TODAY) ?? "Pacific/Kiritimati";
const CLUB_TODAY = clubToday(ZONE);

const ids = { org: "", other: "", source: "", running: "", elsewhere: "", r1: "", r2: "", copy: "" };
const users = { owner: "", guest: "", member: "", stranger: "", both: "" };
const email = (who: string) => `${MARK}-${who}@example.invalid`;

async function cleanup() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
}

async function signInAs(userId: string, eventId: string) {
  jar.clear();
  await createSession(userId);
  await setActiveEvent(eventId);
  const s = await getSession();
  if (!s) throw new Error("the session did not take");
  return s;
}

/** The whole source as stored, and everything hanging off it — to prove it is untouched. */
async function snapshot(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const stages = await prisma.stage.findMany({ where: { eventId }, orderBy: { position: "asc" } });
  const counts = {
    players: await prisma.player.count({ where: { eventId } }),
    cards: await prisma.scorecard.count({ where: { eventId } }),
    contests: await prisma.contest.count({ where: { eventId } }),
    contestEntries: await prisma.contestEntry.count({ where: { contest: { eventId } } }),
    sideGames: await prisma.sideGame.count({ where: { eventId } }),
    sideGameEntries: await prisma.sideGameEntry.count({ where: { sideGame: { eventId } } }),
    pots: await prisma.skinsPot.count({ where: { eventId } }),
    potEntries: await prisma.skinsEntry.count({ where: { pot: { eventId } } }),
    accounts: await prisma.account.count({ where: { eventId } }),
  };
  return JSON.stringify({ event, stages, counts });
}

let before = "";

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${MARK} Golf Club`, kind: "club", timeZone: ZONE, locale: "en-GB" } });
  ids.org = org.id;
  await prisma.subscription.create({ data: { organizationId: org.id, plan: "society", planTermsApply: false } });
  const other = await prisma.organization.create({ data: { name: `${MARK} Other Club`, kind: "club", timeZone: ZONE } });
  ids.other = other.id;

  for (const who of Object.keys(users) as (keyof typeof users)[]) {
    users[who] = (await prisma.user.create({ data: { email: email(who), name: `Zz ${who}`, password: "x:unusable", emailVerifiedAt: new Date() } })).id;
  }
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: users.owner, role: "owner" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: users.guest, role: "guest" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: users.member, role: "member" } });
  await prisma.organizationMember.create({ data: { organizationId: other.id, userId: users.stranger, role: "owner" } });
  // Somebody who runs BOTH clubs: each club's home is that club's alone.
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: users.both, role: "admin" } });
  await prisma.organizationMember.create({ data: { organizationId: other.id, userId: users.both, role: "admin" } });

  // Last summer's medal, every named setting off its default.
  const source = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Summer Medal`,
      status: "completed",
      shape: "single",
      format: "stroke",
      dates: "13–14 Jun 2026",
      startOn: "2026-06-13",
      endOn: "2026-06-14",
      course: `${MARK} Hollins Moss`,
      city: "",
      address: "",
      regDeadline: "2026-06-10",
      regOpens: "2026-06-01",
      teePolicy: "flight",
      registrationApproval: "approve",
      registrationOpen: true,
      registrationToken: `${MARK}-reg-${process.pid}`,
      shareToken: `${MARK}-share-${process.pid}`,
      requirePhone: true,
      capacity: 40,
      leaderboardVisibility: "public",
      flightMode: "count",
      flightValue: 3,
      scoreEntryBy: "players",
      inviteMessage: "See you on the 13th of June",
    },
  });
  ids.source = source.id;
  const r1 = await prisma.stage.create({
    data: {
      eventId: source.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "net",
      handicapAllowance: 90, playedOn: "2026-06-13", teeSheet: JSON.stringify({ groups: [] }), teeSheetPublished: true, accessCode: "ZZ1234",
    },
  });
  const r2 = await prisma.stage.create({
    data: {
      eventId: source.id, position: 1, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross",
      handicapAllowance: 85, playedOn: "2026-06-14", accessCode: "ZZ5678",
    },
  });
  ids.r1 = r1.id;
  ids.r2 = r2.id;
  await prisma.account.create({ data: { eventId: source.id, email: email("guest"), name: "Zz guest", role: "admin" } });

  const field = [];
  for (const [i, name] of ["Ffion Arkwright", "Tomás Briain", "Kiri Moss", "Bea Lindqvist"].entries()) {
    field.push(await prisma.player.create({
      data: { eventId: source.id, name, email: email(`p${i}`), handicap: 10 + i, seed: i + 1, status: i === 3 ? "pending" : "confirmed" },
    }));
  }
  await prisma.scorecard.create({ data: { eventId: source.id, stageId: r1.id, playerId: field[0].id, strokes: JSON.stringify(new Array(18).fill(5)), status: "approved" } });

  const kp = await prisma.contest.create({
    data: { eventId: source.id, stageId: r1.id, kind: "closest-pin", name: "KP 7th", hole: 7, buyInCents: 200, entryMode: "opt-out", sponsorName: "Zz Motors" },
  });
  await prisma.contestEntry.create({ data: { contestId: kp.id, playerId: field[0].id, won: true } });
  const outing = await prisma.contest.create({ data: { eventId: source.id, stageId: "", kind: "other", name: "Best dressed", buyInCents: 0 } });
  void outing;
  const birdies = await prisma.sideGame.create({ data: { eventId: source.id, stageId: r2.id, kind: "birdies", buyInCents: 500, entryMode: "opt-in" } });
  await prisma.sideGameEntry.create({ data: { sideGameId: birdies.id, playerId: field[1].id } });
  await prisma.sideGame.create({ data: { eventId: source.id, stageId: r1.id, kind: "low-net", buyInCents: 300, groupKey: "Group 1" } });
  const pot = await prisma.skinsPot.create({ data: { eventId: source.id, stageId: r1.id, buyInCents: 1000, net: false, scope: "back" } });
  await prisma.skinsEntry.create({ data: { potId: pot.id, playerId: field[2].id } });

  // A tournament of the same club being played: an entry waiting, and cards out.
  const running = await prisma.event.create({
    data: {
      organizationId: org.id, name: `${MARK} Autumn Foursomes`, status: "live", shape: "single", format: "stroke",
      dates: "", course: "", city: "", address: "", regDeadline: addDays(CLUB_TODAY, 3), shareToken: `${MARK}-run-${process.pid}`,
    },
  });
  ids.running = running.id;
  const live = await prisma.stage.create({
    data: { eventId: running.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, playedOn: CLUB_TODAY },
  });
  // The Guest runs this one too, by an Account of their own — a tournament the club lent them.
  await prisma.account.create({ data: { eventId: running.id, email: email("guest"), name: "Zz guest", role: "admin" } });
  for (const [i, status] of ["confirmed", "confirmed", "pending"].entries()) {
    const p = await prisma.player.create({ data: { eventId: running.id, name: `Zz Runner ${i}`, email: email(`r${i}`), handicap: 9, seed: i + 1, status } });
    if (i === 0) await prisma.scorecard.create({ data: { eventId: running.id, stageId: live.id, playerId: p.id, strokes: JSON.stringify(new Array(18).fill(4)), status: "entered" } });
  }

  // Next door: a tournament with an entry waiting, which nobody at this club may see.
  const elsewhere = await prisma.event.create({
    data: {
      organizationId: other.id, name: `${MARK} Next Door Open`, status: "registration", shape: "single", format: "stroke",
      dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${MARK}-next-${process.pid}`,
    },
  });
  ids.elsewhere = elsewhere.id;
  await prisma.player.create({ data: { eventId: elsewhere.id, name: "Zz Neighbour", email: email("n0"), handicap: 9, seed: 1, status: "pending" } });

  before = await snapshot(ids.source);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const eventsInClub = () => prisma.event.count({ where: { organizationId: ids.org } });
const DAY = () => addDays(CLUB_TODAY, 30);

describe("who may copy last event", () => {
  it("not another club's Commissioner, whatever id they send", async () => {
    await signInAs(users.stranger, ids.elsewhere);
    const n = await eventsInClub();
    const res = await cloneEvent(ids.source, `${MARK} stolen`, { startOn: DAY() });
    expect(res.ok).toBe(false);
    expect(await eventsInClub()).toBe(n);
  });

  it("not a Guest of the club, though they are organizer of the tournament itself", async () => {
    await signInAs(users.guest, ids.source);
    const n = await eventsInClub();
    const res = await cloneEvent(ids.source, `${MARK} guest copy`, { startOn: DAY() });
    expect(res).toEqual({ ok: false, error: "Only the club's Commissioner or an Admin can copy its tournaments." });
    expect(await eventsInClub()).toBe(n);
  });

  it("not a plain member", async () => {
    await signInAs(users.member, ids.source);
    const res = await cloneEvent(ids.source, `${MARK} member copy`, { startOn: DAY() });
    expect(res.ok).toBe(false);
  });

  it("not on a day already gone at the CLUB — asked of the club's clock, not this machine's", async () => {
    await signInAs(users.owner, ids.source);
    const n = await eventsInClub();
    expect(await cloneEvent(ids.source, `${MARK} yesterday`, { startOn: addDays(CLUB_TODAY, -1) })).toEqual({ ok: false, error: COPY_DAY_GONE });
    if (CLUB_TODAY > SERVER_TODAY) {
      // The club is a day ahead: the server's today has gone at the club.
      expect((await cloneEvent(ids.source, `${MARK} server day`, { startOn: SERVER_TODAY })).ok).toBe(false);
    } else {
      // The club is a day behind: its today is the server's yesterday, and is still a day to play.
      expect(CLUB_TODAY < SERVER_TODAY, "CONTROL: the zone chosen is on another day").toBe(true);
    }
    expect(await eventsInClub()).toBe(n);
  });
});

describe("the copy, held to the source row", () => {
  beforeAll(async () => {
    await signInAs(users.owner, ids.source);
    const res = await cloneEvent(ids.source, COPY, { startOn: DAY(), endOn: addDays(DAY(), 1) });
    expect(res.ok, res.error ?? "the copy should be made").toBe(true);
    ids.copy = (await prisma.event.findFirstOrThrow({ where: { name: COPY, organizationId: ids.org } })).id;
  });

  it("carries every setting the policy names, each equal to the source's", async () => {
    const source = await prisma.event.findUniqueOrThrow({ where: { id: ids.source } });
    const copy = await prisma.event.findUniqueOrThrow({ where: { id: ids.copy } });
    for (const f of CLONED_EVENT_FIELDS) expect(copy[f], f).toEqual(source[f]);
    // And the ones the panel named, said out loud — each set off its default above.
    for (const f of ["format", "teePolicy", "registrationApproval", "requirePhone", "capacity", "leaderboardVisibility", "flightMode", "flightValue", "scoreEntryBy"] as const) {
      expect(copy[f], f).toEqual(source[f]);
    }
    expect(copy.teePolicy).toBe("flight");
    expect(copy.registrationApproval).toBe("approve");
  });

  it("carries each round's shape and allowance, from the source rounds", async () => {
    const was = await prisma.stage.findMany({ where: { eventId: ids.source }, orderBy: { position: "asc" } });
    const now = await prisma.stage.findMany({ where: { eventId: ids.copy }, orderBy: { position: "asc" } });
    expect(now).toHaveLength(was.length);
    for (const [i, s] of now.entries()) {
      for (const f of CLONED_STAGE_FIELDS) {
        if (f === "singleMatchRule") continue;
        expect(s[f], `round ${i + 1} ${f}`).toEqual(was[i][f]);
      }
    }
    expect(now.map((s) => s.handicapAllowance)).toEqual([90, 85]);
  });

  it("is dated from the day picked: the window and Round 2 keep their distance from the first day", async () => {
    const copy = await prisma.event.findUniqueOrThrow({ where: { id: ids.copy } });
    const rounds = await prisma.stage.findMany({ where: { eventId: ids.copy }, orderBy: { position: "asc" } });
    expect(copy.startOn).toBe(DAY());
    expect(copy.endOn).toBe(addDays(DAY(), 1));
    expect(copy.dates).toBe(formatDayRange(DAY(), addDays(DAY(), 1), "en-GB"));
    // 2026-06-13 → deadline 3 days before, opens 12 days before; Round 2 the day after.
    expect(daysBetween(copy.regDeadline, copy.startOn)).toBe(3);
    expect(daysBetween(copy.regOpens, copy.startOn)).toBe(12);
    expect(rounds.map((r) => r.playedOn)).toEqual([DAY(), addDays(DAY(), 1)]);
    expect(copy.datesTentative).toBe(false);
  });

  it("carries none of the field, the cards, the results, the money, the links or the codes", async () => {
    const source = await prisma.event.findUniqueOrThrow({ where: { id: ids.source } });
    const copy = await prisma.event.findUniqueOrThrow({ where: { id: ids.copy } });
    expect(await prisma.player.count({ where: { eventId: ids.copy } })).toBe(0);
    expect(await prisma.scorecard.count({ where: { eventId: ids.copy } })).toBe(0);
    expect(await prisma.contestEntry.count({ where: { contest: { eventId: ids.copy } } })).toBe(0);
    expect(await prisma.sideGameEntry.count({ where: { sideGame: { eventId: ids.copy } } })).toBe(0);
    expect(await prisma.skinsEntry.count({ where: { pot: { eventId: ids.copy } } })).toBe(0);
    expect(copy.status).toBe("draft");
    expect(copy.shareToken).not.toBe(source.shareToken);
    expect(copy.registrationToken).toBe("");
    expect(copy.registrationOpen).toBe(false);
    expect(copy.inviteMessage).toBe("");
    const rounds = await prisma.stage.findMany({ where: { eventId: ids.copy } });
    for (const r of rounds) {
      expect(r.teeSheet).toBe("");
      expect(r.teeSheetPublished).toBe(false);
      expect(["ZZ1234", "ZZ5678"]).not.toContain(r.accessCode);
    }
  });

  it("carries the side games as games, on the copy's own rounds, with nobody in them", async () => {
    const copyRounds = await prisma.stage.findMany({ where: { eventId: ids.copy }, orderBy: { position: "asc" } });
    const at = (stageId: string) => (stageId === ids.r1 ? copyRounds[0].id : stageId === ids.r2 ? copyRounds[1].id : stageId);

    const was = await prisma.contest.findMany({ where: { eventId: ids.source }, orderBy: { name: "asc" } });
    const now = await prisma.contest.findMany({ where: { eventId: ids.copy }, orderBy: { name: "asc" } });
    expect(now).toHaveLength(was.length);
    for (const [i, c] of now.entries()) {
      for (const f of CLONED_CONTEST_FIELDS) expect(c[f], `contest ${f}`).toEqual(was[i][f]);
      expect(c.stageId).toBe(at(was[i].stageId));
    }

    const games = await prisma.sideGame.findMany({ where: { eventId: ids.copy } });
    const fieldGame = await prisma.sideGame.findFirstOrThrow({ where: { eventId: ids.source, groupKey: "" } });
    expect(games).toHaveLength(1); // the fourball's own game stays behind with its tee sheet
    for (const f of CLONED_SIDE_GAME_FIELDS) expect(games[0][f], `side game ${f}`).toEqual(fieldGame[f]);
    expect(games[0].stageId).toBe(copyRounds[1].id);

    const pots = await prisma.skinsPot.findMany({ where: { eventId: ids.copy } });
    const pot = await prisma.skinsPot.findFirstOrThrow({ where: { eventId: ids.source } });
    expect(pots).toHaveLength(1);
    for (const f of CLONED_SKINS_POT_FIELDS) expect(pots[0][f], `skins ${f}`).toEqual(pot[f]);
    expect(pots[0].stageId).toBe(copyRounds[0].id);
  });

  it("leaves the original exactly as it was", async () => {
    expect(await snapshot(ids.source)).toBe(before);
  });

  it("opened for entries, its sign-up link is a NEW address", async () => {
    // cloneEvent opened the copy; publishing the link mints its token.
    const res = await setRegistrationOpen(true);
    expect(res.ok).toBe(true);
    const copy = await prisma.event.findUniqueOrThrow({ where: { id: ids.copy } });
    const source = await prisma.event.findUniqueOrThrow({ where: { id: ids.source } });
    expect(copy.registrationOpen).toBe(true);
    expect(copy.registrationToken.length).toBeGreaterThan(10);
    expect(copy.registrationToken).not.toBe(source.registrationToken);
    expect(await snapshot(ids.source)).toBe(before);
  });
});

describe("what's next, for the same people", () => {
  it("the Commissioner: the club's jobs, every one with the right to act, and nothing from next door", async () => {
    const home = await secretaryHomeFor(await signInAs(users.owner, ids.running));
    expect(home.mayAct).toBe(true);
    const mine = home.jobs.filter((j) => j.eventId === ids.running).map((j) => j.key);
    expect(mine).toContain("entries");
    expect(mine).toContain("cards");
    const entries = home.jobs.find((j) => j.eventId === ids.running && j.key === "entries")!;
    expect(entries.text).toMatch(/· 1 entry awaiting approval$/);
    const cards = home.jobs.find((j) => j.eventId === ids.running && j.key === "cards")!;
    // Two in the field, one card started and not certified: two not returned.
    expect(cards.text).toBe("Round 1: 2 cards not returned");
    expect(home.jobs.some((j) => j.eventId === ids.elsewhere)).toBe(false);
    // A completed tournament waits on nobody.
    expect(home.jobs.some((j) => j.eventId === ids.source)).toBe(false);
    // Last event first among what a copy may start from.
    expect(home.copyable.map((c) => c.id)).toContain(ids.source);
  });

  it("somebody who runs both clubs sees, on each club's home, that club's jobs and never the other's", async () => {
    const here = await secretaryHomeFor(await signInAs(users.both, ids.running));
    expect(here.jobs.some((j) => j.eventId === ids.running)).toBe(true);
    expect(here.jobs.some((j) => j.eventId === ids.elsewhere), "the other club's job is on this club's home").toBe(false);
    expect(here.copyable.some((c) => c.id === ids.elsewhere), "the other club's tournament is offered to copy here").toBe(false);
    const there = await secretaryHomeFor(await signInAs(users.both, ids.elsewhere));
    expect(there.jobs.map((j) => j.eventId)).toEqual([ids.elsewhere]);
  });

  it("CONTROL: the other club's own Commissioner does see next door's waiting entry", async () => {
    const home = await secretaryHomeFor(await signInAs(users.stranger, ids.elsewhere));
    expect(home.jobs.map((j) => `${j.eventId}:${j.key}`)).toEqual([`${ids.elsewhere}:entries`]);
    expect(home.jobs.some((j) => j.eventId === ids.running)).toBe(false);
  });

  it("a Guest organizer reads the jobs of the tournaments they were given, may act on none, and is offered no copy", async () => {
    const home = await secretaryHomeFor(await signInAs(users.guest, ids.running));
    expect(home.jobs.filter((j) => j.eventId === ids.running).map((j) => j.key).sort()).toEqual(["cards", "entries"]);
    expect(home.mayAct).toBe(false);
    expect(home.copyable).toEqual([]);
  });

  it("CONTROL: a plain member, who runs nothing, has no jobs at all", async () => {
    const home = await secretaryHomeFor(await signInAs(users.member, ids.running));
    expect(home.jobs).toEqual([]);
    expect(home.mayAct).toBe(false);
  });
});
