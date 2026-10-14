import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

/**
 * THE ORGANIZER DECIDES THE TEES, ON REAL ROWS.
 *
 * `the-organizer-decides-the-tees.test.ts` has the ruling, the order of the
 * three levels and a sweep of the source. This is the same thing done to a
 * database, by the actions a person would actually reach:
 *
 *   an entry lands with NO tees of its own, whichever door it came through —
 *   the public form (with "Red" typed in the old Preferred tee field, as a
 *   caller who kept the old form would send it), a member entering themselves,
 *   and the organizer adding a member from the roster;
 *
 *   only staff can put a player on a set;
 *
 *   and a woman with nothing set plays the course's ladies' tees on EVERY
 *   reader of the round — the board, the round's own handicap list, the list a
 *   card's tee name is read from — then her flight's when the organizer sets
 *   one, then her own when the organizer moves her, then the tournament's when
 *   the committee says one set for everyone.
 *
 * Each figure is worked from the tees' ratings in whole numbers, so that a
 * reader on the wrong tees prints a different number and not merely a
 * different name.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

type Session = { email: string; name: string; id?: string; userId?: string; accountId?: string; eventId: string; role: string; viewRole?: string };
const session: { current: Session | null } = { current: null };
vi.mock("@/lib/auth", () => ({ getSession: async () => session.current, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { registerForEvent } = await import("@/app/actions/register");
const { enterThisTournament } = await import("@/app/actions/enter");
const { addMembersToEvent } = await import("@/app/actions/roster");
const { setPlayerTee, setFlightTee } = await import("@/app/actions/courses");
const { loadEventState } = await import("@/lib/services/tournament");
const { roundHandicapsFor } = await import("@/lib/services/round-handicap");
const { handicapsForRound } = await import("@/lib/services/handicaps");

const prisma = new PrismaClient();
const TAG = "zz-organizer-tees";
const RUN = randomBytes(4).toString("hex");

type Rating = { courseRating: number; slopeRating: number; par: number };
const WHITE: Rating = { courseRating: 70.8, slopeRating: 129, par: 71 };
const RED: Rating = { courseRating: 72.9, slopeRating: 127, par: 72 };
const YELLOW: Rating = { courseRating: 68.0, slopeRating: 118, par: 70 };

/** The course handicap of a 12.0 by the Rule, in whole numbers (1,130ths of a stroke), rounded once. */
const course = (t: Rating, indexTenths = 120) => {
  const n = indexTenths * t.slopeRating + (Math.round(t.courseRating * 10) - t.par * 10) * 113;
  return Math.floor((2 * n + 1130) / 2260);
};

const ids = { org: "", event: "", stage: "", white: "", red: "", yellow: "", token: "", flight: "" };
const who: Record<string, string> = {};
let admin: Session;
let member: Session;

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  ids.org = org.id;
  const links = await prisma.course.create({
    data: {
      organizationId: org.id,
      name: `${TAG} links`,
      city: "",
      pars: JSON.stringify(new Array(18).fill(4)),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  // Named as a golfer would type them, so the old door WOULD have matched "Red".
  ids.white = (await prisma.tee.create({ data: { courseId: links.id, name: "White", gender: "any", ...WHITE, position: 0 } })).id;
  ids.red = (await prisma.tee.create({ data: { courseId: links.id, name: "Red", gender: "women", ...RED, position: 1 } })).id;
  ids.yellow = (await prisma.tee.create({ data: { courseId: links.id, name: "Yellow", gender: "any", ...YELLOW, position: 2 } })).id;

  ids.token = randomBytes(6).toString("hex");
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} mixed open`,
      status: "registration",
      shape: "single",
      format: "stroke",
      formationRule: "balanced",
      dates: "",
      course: `${TAG} links`,
      city: "",
      address: "",
      regDeadline: "",
      capacity: 40,
      registrationOpen: true,
      registrationApproval: "auto",
      registrationToken: ids.token,
      shareToken: randomBytes(10).toString("hex"),
      courseId: links.id,
      defaultTeeId: ids.white,
      teePolicy: "own",
      configUnlocked: true,
    },
  });
  ids.event = event.id;
  await prisma.eventCourse.create({ data: { eventId: event.id, courseId: links.id } });
  ids.stage = (
    await prisma.stage.create({
      data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "net", handicapAllowance: 100 },
    })
  ).id;

  const adminEmail = `${TAG}-sec-${RUN}@example.invalid`;
  await prisma.account.create({ data: { eventId: event.id, email: adminEmail, name: `${TAG} secretary`, role: "admin" } });
  admin = { email: adminEmail, name: `${TAG} secretary`, eventId: event.id, role: "admin", viewRole: "admin", userId: "", accountId: "" };

  // A member with an account: a woman whose record says she usually plays the reds.
  const user = await prisma.user.create({ data: { email: `${TAG}-ann-${RUN}@example.invalid`, name: `${TAG} Ann` } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "member" } });
  await prisma.member.create({
    data: { organizationId: org.id, name: `${TAG} Ann`, email: user.email, handicap: 12, handicapType: "18", handicapSource: "manual", gender: "F", preferredTee: "Red", phone: "07700 900123" },
  });
  member = { email: user.email, name: user.name ?? "", id: user.id, eventId: event.id, role: "player" };

  // And two on the roster with no account, for the organizer to add: a man who
  // usually plays the yellows, and a woman who usually plays the whites.
  for (const [key, gender, tee] of [
    ["bob", "male", "Yellow"],
    ["cat", "female", "White"],
  ] as const) {
    const m = await prisma.member.create({
      data: { organizationId: org.id, name: `${TAG} ${key}`, email: `${TAG}-${key}-${RUN}@example.invalid`, handicap: 12, handicapType: "18", handicapSource: "manual", gender, preferredTee: tee, phone: "07700 900124" },
    });
    who[`${key}Member`] = m.id;
  }
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const entry = (name: string) => prisma.player.findFirst({ where: { eventId: ids.event, name: { contains: name } } });

describe("an entry lands with no tees of its own, whichever door it came through", () => {
  it("CONTROL: the tees are named so that what an entrant typed would have matched one", async () => {
    const tees = await prisma.tee.findMany({ where: { course: { events: { some: { eventId: ids.event } } } }, select: { name: true } });
    expect(tees.map((t) => t.name).sort()).toEqual(["Red", "White", "Yellow"]);
  });

  it("the public form: a stranger who sends a tee is not put on it", async () => {
    session.current = null;
    const res = await registerForEvent(ids.token, {
      name: `${TAG} Dee ${RUN}`,
      email: `${TAG}-dee-${RUN}@example.invalid`,
      handicap: "12",
      handicapType: "18",
      phone: "15551234567",
      // The form no longer has the box. A caller who kept the old page open does.
      preferredTee: "Red",
    });
    expect(res.ok, `refused: ${res.ok === false ? res.error : ""}`).toBe(true);
    const row = await entry("Dee");
    expect(row, "no entry was written").toBeTruthy();
    expect(row!.teeId, "the entrant chose their own tees").toBeNull();
    who.dee = row!.id;
  });

  it("a member entering themselves: what their record says they usually play is kept as words, not as tees", async () => {
    session.current = member;
    const res = await enterThisTournament(ids.event);
    expect(res.ok, `refused: ${res.ok === false ? res.error : ""}`).toBe(true);
    const row = await entry("Ann");
    expect(row!.teeId, "the member's usual tee was written as her own").toBeNull();
    expect(row!.preferredTee).toBe("Red");
    // And what the default needs came across.
    expect(row!.gender).toBe("F");
    who.ann = row!.id;
  });

  it("the organizer adding from the roster: the same, for a man and a woman", async () => {
    session.current = admin;
    const res = await addMembersToEvent([who.bobMember, who.catMember]);
    expect(res.ok, `refused: ${res.ok === false ? res.error : ""}`).toBe(true);
    expect(res.added).toBe(2);
    const [bob, cat] = [await entry("bob"), await entry("cat")];
    expect([bob!.teeId, cat!.teeId]).toEqual([null, null]);
    expect([bob!.preferredTee, cat!.preferredTee]).toEqual(["Yellow", "White"]);
    expect([bob!.gender, cat!.gender]).toEqual(["male", "female"]);
    who.bob = bob!.id;
    who.cat = cat!.id;
  });
});

describe("only staff can put a player on a set", () => {
  it("a player is turned away, for their own entry as for anybody's", async () => {
    session.current = member;
    for (const target of [who.ann, who.bob]) {
      const res = await setPlayerTee(target, ids.yellow);
      expect(res.ok).toBe(false);
      expect(res.ok === false && res.error).toBe("The organizer sets which tees you play from.");
    }
    const rows = await prisma.player.findMany({ where: { id: { in: [who.ann, who.bob] } }, select: { teeId: true } });
    expect(rows.map((r) => r.teeId)).toEqual([null, null]);
  });

  it("nobody signed in is turned away too", async () => {
    session.current = null;
    expect((await setPlayerTee(who.ann, ids.yellow)).ok).toBe(false);
    expect((await prisma.player.findUniqueOrThrow({ where: { id: who.ann } })).teeId).toBeNull();
  });
});

/** What each reader says one player plays off, at a 100% allowance: the board, the round's list, and the card's list. */
async function readers(playerId: string) {
  const state = await loadEventState(ids.event);
  const list = await roundHandicapsFor(ids.event, ids.stage);
  const card = await handicapsForRound(ids.event, 18, ids.white, 100);
  const onList = list.find((r) => r.playerId === playerId)!;
  const onCard = card.find((r) => r.playerId === playerId)!;
  return {
    board: state!.strokeHandicapFor(playerId, ids.stage),
    list: onList.playing,
    listCourse: onList.member,
    card: onCard.courseHandicap,
    tee: onCard.teeName,
  };
}
/** The lowest par the confirmed field is playing, for the strokes Rule 6.2b adds on the board and the list. */
const LOWEST_PAR = 71;
const expectOn = (t: Rating, name: string, lowestPar = LOWEST_PAR) => ({
  board: course(t) + Math.max(0, t.par - lowestPar),
  list: course(t) + Math.max(0, t.par - lowestPar),
  listCourse: course(t),
  card: course(t),
  tee: name,
});

describe("a woman nobody has put anywhere plays the ladies' tees, on every reader", () => {
  it("CONTROL: the three sets give a 12.0 three different course handicaps", () => {
    expect(new Set([course(WHITE), course(RED), course(YELLOW)]).size).toBe(3);
  });

  it("Ann and Cat are on the reds; Bob and Dee, who has not said, are on the tournament's whites", async () => {
    for (const key of ["ann", "cat"]) expect(await readers(who[key]), key).toEqual(expectOn(RED, "Red"));
    for (const key of ["bob", "dee"]) expect(await readers(who[key]), key).toEqual(expectOn(WHITE, "White"));
  });
});

describe("each level the organizer sets beats the one before it", () => {
  it("a flight's tees beat the ladies' default, for everybody in the flight", async () => {
    session.current = admin;
    const flight = await prisma.group.create({ data: { eventId: ids.event, name: `${TAG} seniors`, position: 0 } });
    ids.flight = flight.id;
    await prisma.player.updateMany({ where: { id: { in: [who.ann, who.bob] } }, data: { groupId: flight.id } });
    const res = await setFlightTee(flight.id, ids.yellow);
    expect(res.ok, `refused: ${res.ok === false ? res.error : ""}`).toBe(true);
    // The yellows are par 70, so they are now the lowest par in the field.
    for (const key of ["ann", "bob"]) expect(await readers(who[key]), key).toEqual(expectOn(YELLOW, "Yellow", 70));
    // Cat is in no flight: still the ladies' set. Dee: still the tournament's.
    expect(await readers(who.cat)).toEqual(expectOn(RED, "Red", 70));
    expect(await readers(who.dee)).toEqual(expectOn(WHITE, "White", 70));
  });

  it("one player moved by the organizer beats her flight's", async () => {
    session.current = admin;
    const res = await setPlayerTee(who.ann, ids.white);
    expect(res.ok, `refused: ${res.ok === false ? res.error : ""}`).toBe(true);
    expect(await readers(who.ann)).toEqual(expectOn(WHITE, "White", 70));
    // Bob, in the same flight and not moved, is still on the flight's.
    expect(await readers(who.bob)).toEqual(expectOn(YELLOW, "Yellow", 70));
  });

  it("and one set for everyone puts the whole field on the tournament's, men and women alike", async () => {
    await prisma.event.update({ where: { id: ids.event }, data: { teePolicy: "one" } });
    for (const key of ["ann", "bob", "cat", "dee"]) expect(await readers(who[key]), key).toEqual(expectOn(WHITE, "White", 71));
    // And under it the organizer is told a player's own set would not count, rather than having it stored.
    session.current = admin;
    const res = await setPlayerTee(who.cat, ids.yellow);
    expect(res.ok).toBe(false);
    expect((await prisma.player.findUniqueOrThrow({ where: { id: who.cat } })).teeId).toBeNull();
  });

  it("a tournament stored with the retired setting is scored as 'a flight or a player may play their own'", async () => {
    await prisma.event.update({ where: { id: ids.event }, data: { teePolicy: "player" } });
    expect(await readers(who.ann)).toEqual(expectOn(WHITE, "White", 70));
    expect(await readers(who.bob)).toEqual(expectOn(YELLOW, "Yellow", 70));
    expect(await readers(who.cat)).toEqual(expectOn(RED, "Red", 70));
    // And a player still cannot choose their own under it.
    session.current = member;
    expect((await setPlayerTee(who.ann, ids.red)).ok).toBe(false);
    expect((await prisma.player.findUniqueOrThrow({ where: { id: who.ann } })).teeId).toBe(ids.white);
  });
});
