import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A CLUB WITH NO TOURNAMENT YET CAN KEEP ITS COURSES (R2a).
 *
 * Every library action asked `requireOrganizerOrg`: an admin of an OPEN
 * tournament. A secretary who has just made the club has none, and arrives as
 * `role: "player"` with `eventId: ""`, so the first tournament's "Where?" and
 * the Courses screen would both have refused the one person who must use them.
 * `requireCourseKeeper("add" | "change")` now answers for the ten library
 * actions. What is held here, against real rows:
 *
 *   - no tournament open: the club the person runs, and `canEdit` of it;
 *   - a tournament open: its admin, as always; a CHANGE (home course, a delete,
 *     a card overwritten, a confirmation withdrawn) also needs `canEdit` of the
 *     club, so a guest organizer, who holds no membership, cannot reach up into
 *     the club's own courses; an ADD (an away day) stays open to them;
 *   - "has a tournament and is not its admin" is refused, never sent on to the
 *     club branch;
 *   - the two directory doors stay as they were ("themselves"), except that a
 *     no-event secretary's import lands in the CLUB and makes no organization;
 *   - a bad payload is refused in words and writes nothing.
 *
 * THE FENCE (Hard rule 1): every row here is one this file creates and keeps
 * the id of. The session is a mock of `getSession`, never a real account.
 * Cleanup is by those ids, in `afterAll`, and nothing finds a row by looking
 * for existing clubs or events.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/the-club-keeps-its-courses-without-an-event.audit.test.ts
 */

const prisma = new PrismaClient();
const MARK = "zz-r2a";
const addr = (who: string) => `${MARK}-${who}-${process.pid}@example.invalid`;

interface Sess {
  eventId: string;
  email: string;
  viewRole: string;
  name: string;
  role: string;
  userId: string;
  accountId: string;
}
let session: Sess | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const actions = await import("@/app/actions/courses");

const made = { orgs: [] as string[], users: [] as string[], events: [] as string[] };

const PARS = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];
const YARDS = [380, 410, 170, 520, 400, 390, 160, 540, 420, 385, 405, 165, 525, 395, 385, 155, 535, 415];
const SI = [7, 1, 15, 5, 11, 3, 17, 9, 13, 8, 2, 16, 6, 12, 4, 18, 10, 14];
const card = (name: string, extra: Record<string, unknown> = {}) => ({ name, city: "Nowhere", pars: PARS, yards: YARDS, strokeIndex: SI, ...extra });
const TEE = { name: "Blue", gender: "any", courseRating: 71.5, slopeRating: 125, par: 72 };

async function user(who: string) {
  const u = await prisma.user.create({ data: { email: addr(who), name: `${MARK} ${who}`, emailVerifiedAt: new Date() } });
  made.users.push(u.id);
  return u;
}
async function club(who: string, members: Array<{ userId: string; role: string }>, over: Record<string, unknown> = {}) {
  const o = await prisma.organization.create({
    data: { name: `${MARK} ${who} ${process.pid}`, kind: "club", ...over, members: { create: members } },
  });
  made.orgs.push(o.id);
  return o;
}
async function event(organizationId: string, who: string, over: Record<string, unknown> = {}) {
  const e = await prisma.event.create({
    data: {
      organizationId,
      name: `${MARK} ${who}`,
      status: "live",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${MARK}-${who}-${process.pid}`,
      ...over,
    },
  });
  made.events.push(e.id);
  return e;
}
async function course(organizationId: string, name: string) {
  return prisma.course.create({
    data: { organizationId, name: `${MARK} ${name}`, pars: JSON.stringify(PARS), yards: JSON.stringify(YARDS), strokeIndex: JSON.stringify(SI) },
  });
}
const asNoEvent = (u: { id: string; email: string }): Sess => ({ eventId: "", email: u.email, viewRole: "player", name: "zz", role: "player", userId: u.id, accountId: "" });
const inEvent = (u: { id: string; email: string }, eventId: string, role: string): Sess => ({ eventId, email: u.email, viewRole: role, name: "zz", role, userId: u.id, accountId: "" });

const f: Record<string, string> = {};
let users: Record<string, { id: string; email: string }> = {};

beforeAll(async () => {
  const [adminA, memberA, loner, adminB, ownerC, guest, assistant, dual, twoOwner] = await Promise.all(
    ["adminA", "memberA", "loner", "adminB", "ownerC", "guest", "assistant", "dual", "two"].map(user),
  );
  const A = await club("A", [{ userId: adminA.id, role: "admin" }, { userId: memberA.id, role: "member" }]);
  const B = await club("B", [{ userId: adminB.id, role: "owner" }]);
  const C = await club("C", [{ userId: ownerC.id, role: "owner" }]);
  const D = await club("D", [{ userId: dual.id, role: "owner" }]);
  const demo = await club("demo", [], { isDemo: true });
  const T1 = await club("T1", [{ userId: twoOwner.id, role: "owner" }]);
  await new Promise((r) => setTimeout(r, 15));
  const T2 = await club("T2", [{ userId: twoOwner.id, role: "owner" }]);

  const evB = await event(B.id, "evB");
  const evC = await event(C.id, "evC");
  const evCarch = await event(C.id, "evCarch", { archivedAt: new Date() });
  await prisma.account.create({ data: { eventId: evC.id, email: guest.email, name: "zz guest", role: "admin" } });
  await prisma.account.create({ data: { eventId: evC.id, email: assistant.email, name: "zz assistant", role: "assistant" } });
  await prisma.account.create({ data: { eventId: evCarch.id, email: ownerC.email, name: "zz owner", role: "admin" } });
  await prisma.account.create({ data: { eventId: evB.id, email: dual.email, name: "zz dual", role: "player" } });
  const stageB = await prisma.stage.create({ data: { eventId: evB.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } });
  const playerB = await prisma.player.create({ data: { eventId: evB.id, name: `${MARK} p`, email: addr("pB"), seed: 1, status: "confirmed" } });

  const cA = await course(A.id, "cA");
  const cA2 = await course(A.id, "cA2");
  const cB = await course(B.id, "cB");
  const cC = await course(C.id, "cC");
  const cD = await course(D.id, "cD");
  const cDemo = await course(demo.id, "cDemo");
  const cT2 = await course(T2.id, "cT2");
  const tA = await prisma.tee.create({ data: { courseId: cA.id, name: "White", par: 72, slopeRating: 120, courseRating: 70 } });
  const tB = await prisma.tee.create({ data: { courseId: cB.id, name: "White", par: 72, slopeRating: 120, courseRating: 70 } });
  const tC = await prisma.tee.create({ data: { courseId: cC.id, name: "White", par: 72, slopeRating: 120, courseRating: 70 } });
  const tD = await prisma.tee.create({ data: { courseId: cD.id, name: "White", par: 72, slopeRating: 120, courseRating: 70 } });

  Object.assign(f, {
    adminA: adminA.id, memberA: memberA.id, loner: loner.id, adminB: adminB.id, ownerC: ownerC.id, guest: guest.id,
    assistant: assistant.id, dual: dual.id, two: twoOwner.id,
    A: A.id, B: B.id, C: C.id, D: D.id, demo: demo.id, T1: T1.id, T2: T2.id,
    evB: evB.id, evC: evC.id, evCarch: evCarch.id, stageB: stageB.id, playerB: playerB.id,
    cA: cA.id, cA2: cA2.id, cB: cB.id, cC: cC.id, cD: cD.id, cDemo: cDemo.id, cT2: cT2.id,
    tA: tA.id, tB: tB.id, tC: tC.id, tD: tD.id,
  });
  users = { adminA, memberA, loner, adminB, ownerC, guest, assistant, dual, two: twoOwner };
});

afterAll(async () => {
  try {
    // By the ids this file made, and nothing else (Hard rule 1).
    await prisma.player.deleteMany({ where: { eventId: { in: made.events } } });
    await prisma.stage.deleteMany({ where: { eventId: { in: made.events } } });
    await prisma.account.deleteMany({ where: { eventId: { in: made.events } } });
    await prisma.event.deleteMany({ where: { id: { in: made.events } } });
    await prisma.tee.deleteMany({ where: { course: { organizationId: { in: made.orgs } } } });
    await prisma.course.deleteMany({ where: { organizationId: { in: made.orgs } } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: { in: made.orgs } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: MARK }, id: { in: made.orgs } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
  } finally {
    await prisma.$disconnect();
  }
});

/** Everything a refused press must leave alone. */
async function snapshot() {
  const [courses, tees, orgs, stage, player, home] = await Promise.all([
    prisma.course.findMany({ where: { organizationId: { in: made.orgs } }, orderBy: { id: "asc" }, select: { id: true, name: true, pars: true, verifiedAt: true } }),
    prisma.tee.findMany({ where: { course: { organizationId: { in: made.orgs } } }, orderBy: { id: "asc" }, select: { id: true, name: true } }),
    prisma.organization.count({ where: { id: { in: made.orgs } } }),
    prisma.stage.findUnique({ where: { id: f.stageB }, select: { courseId: true } }),
    prisma.player.findUnique({ where: { id: f.playerB }, select: { teeId: true } }),
    prisma.organization.findMany({ where: { id: { in: made.orgs } }, orderBy: { id: "asc" }, select: { id: true, defaultCourseId: true } }),
  ]);
  return JSON.stringify({ courses, tees, orgs, stage, player, home });
}

type Result = { ok: boolean; error?: string };
/** The press was refused: it said so in words (or threw), and it said it as a refusal, not "Course not found". */
async function pressed(fn: () => Promise<Result>): Promise<{ ok: boolean; error: string }> {
  try {
    const r = await fn();
    return { ok: r.ok, error: r.error ?? "" };
  } catch (e) {
    return { ok: false, error: `THROWN ${(e as Error).message}` };
  }
}

/** The ten library actions, aimed at a course and a tee set of the club under test. */
const LIBRARY: Array<{ name: string; kind: "add" | "change"; run: (c: string, t: string) => Promise<Result> }> = [
  { name: "saveClubCourse (new)", kind: "add", run: () => actions.saveClubCourse(card(`${MARK} new ${Math.random()}`)) },
  { name: "saveClubCourse (edit)", kind: "change", run: (c) => actions.saveClubCourse(card(`${MARK} renamed ${Math.random()}`, { id: c })) },
  { name: "deleteClubCourse", kind: "change", run: (c) => actions.deleteClubCourse(c) },
  { name: "setHomeCourse", kind: "change", run: (c) => actions.setHomeCourse(c) },
  { name: "saveTee (new)", kind: "add", run: (c) => actions.saveTee(c, TEE) },
  { name: "saveTee (edit)", kind: "change", run: (c, t) => actions.saveTee(c, TEE, t) },
  { name: "deleteTee", kind: "change", run: (_c, t) => actions.deleteTee(t) },
  { name: "verifyCourseCard", kind: "add", run: (c) => actions.verifyCourseCard(c) },
  { name: "unverifyCourseCard", kind: "change", run: (c) => actions.unverifyCourseCard(c) },
  {
    name: "importClubCourseCard",
    kind: "add",
    run: () =>
      actions.importClubCourseCard({
        name: `${MARK} pasted ${Math.random()}`,
        pars: PARS.join(" "),
        yards: YARDS.join(" "),
        strokeIndex: SI.join(" "),
      }),
  },
  { name: "checkCourseAgainstSource", kind: "add", run: (c) => actions.checkCourseAgainstSource(c) },
  { name: "applySourceCard", kind: "change", run: (c) => actions.applySourceCard(c) },
];

const GATE_WORDS = /Only a Commissioner or Admin|Only the tournament's organizer|Not authenticated|Organizer access required|Staff access required/;
const isGateRefusal = (r: { error: string }) => GATE_WORDS.test(r.error);

describe("no tournament open: the club's owner or admin keeps its courses", () => {
  it("allowed: the club's admin, on every one of the library actions", async () => {
    // A fresh course and tee per action, so one delete cannot starve the next.
    for (const a of LIBRARY) {
      session = asNoEvent(users.adminA);
      const c = await course(f.A, `allow-${a.name}`);
      const t = await prisma.tee.create({ data: { courseId: c.id, name: "Red", par: 72, slopeRating: 120, courseRating: 70 } });
      const r = await pressed(() => a.run(c.id, t.id));
      // checkCourseAgainstSource and applySourceCard have no directory source on a typed card: their
      // own words, never the gate's.
      expect(isGateRefusal(r), `${a.name}: ${r.error}`).toBe(false);
      if (a.name !== "checkCourseAgainstSource" && a.name !== "applySourceCard") expect(r.ok, `${a.name}: ${r.error}`).toBe(true);
    }
  });

  it("the saved course is in the CLUB, and a verified card is stamped", async () => {
    session = asNoEvent(users.adminA);
    const made1 = await actions.saveClubCourse(card(`${MARK} lands ${Math.random()}`));
    expect(made1.ok).toBe(true);
    const row = await prisma.course.findUnique({ where: { id: made1.courseId! } });
    expect(row?.organizationId).toBe(f.A);
    expect((await actions.verifyCourseCard(made1.courseId!)).ok).toBe(true);
    expect((await prisma.course.findUnique({ where: { id: made1.courseId! } }))?.verifiedAt).not.toBeNull();
  });

  it("refused, in words: a member who is not owner or admin, and a person who runs no club", async () => {
    for (const who of ["memberA", "loner"]) {
      for (const a of LIBRARY) {
        session = asNoEvent(users[who]);
        const before = await snapshot();
        const r = await pressed(() => a.run(f.cA, f.tA));
        expect(r.ok, `${who} ${a.name}`).toBe(false);
        expect(r.error, `${who} ${a.name} must be refused in words, not thrown`).toMatch(/Only a Commissioner or Admin/);
        expect(await snapshot(), `${who} ${a.name} wrote`).toBe(before);
      }
    }
  });

  it("IDOR: another club's admin with this club's course id AND tee id", async () => {
    for (const a of LIBRARY) {
      session = asNoEvent(users.adminB);
      const before = await snapshot();
      const r = await pressed(() => a.run(f.cA, f.tA));
      // Adds that take no id (new course, new card) succeed in THEIR OWN club; everything that names this
      // club's rows is "not found" and changes nothing of A's.
      if (a.name === "saveClubCourse (new)" || a.name === "importClubCourseCard") {
        expect(r.ok).toBe(true);
        continue;
      }
      expect(r.ok, `adminB ${a.name} reached club A's row`).toBe(false);
      expect(r.error).toMatch(/not found/i);
      const after = JSON.parse(await snapshot());
      const was = JSON.parse(before);
      expect(after.courses.filter((c: { id: string }) => [f.cA, f.cA2].includes(c.id))).toEqual(was.courses.filter((c: { id: string }) => [f.cA, f.cA2].includes(c.id)));
      expect(after.tees.filter((t: { id: string }) => t.id === f.tA)).toEqual(was.tees.filter((t: { id: string }) => t.id === f.tA));
    }
  });

  it("a no-event admin calling EVERY event action: refused, and every row unchanged", async () => {
    const calls: Array<[string, () => Promise<Result>]> = [
      ["setEventCourses", () => actions.setEventCourses([f.cA])],
      ["setEventDefaultTee", () => actions.setEventDefaultTee(f.tA)],
      ["setFlightTee", () => actions.setFlightTee("zz-none", f.tA)],
      ["setStageCourse", () => actions.setStageCourse(f.stageB, f.cA)],
      ["setPlayerTee", () => actions.setPlayerTee(f.playerB, f.tA)],
      ["setMatchCourse", () => actions.setMatchCourse("zz-none", f.cA)],
      ["nameMatchVenue", () => actions.nameMatchVenue("zz-none", { courseId: f.cA })],
    ];
    for (const [name, run] of calls) {
      session = asNoEvent(users.adminA);
      const before = await snapshot();
      const r = await pressed(run);
      expect(r.ok, `${name} must refuse a person with no tournament`).toBe(false);
      expect(await snapshot(), `${name} wrote`).toBe(before);
    }
  });

  it("two clubs, no event: the write lands in the club the screen shows; the other's course id is not found", async () => {
    session = asNoEvent(users.two);
    const added = await actions.saveClubCourse(card(`${MARK} two ${Math.random()}`));
    expect(added.ok).toBe(true);
    expect((await prisma.course.findUnique({ where: { id: added.courseId! } }))?.organizationId).toBe(f.T1);
    const other = await pressed(() => actions.deleteClubCourse(f.cT2));
    expect(other.ok).toBe(false);
    expect(other.error).toMatch(/not found/i);
    expect(await prisma.course.findUnique({ where: { id: f.cT2 } })).not.toBeNull();
  });

  it("a club marked isDemo with no members: nobody without an event writes to it", async () => {
    for (const who of ["adminA", "loner", "memberA"]) {
      session = asNoEvent(users[who]);
      const before = await snapshot();
      const r = await pressed(() => actions.saveClubCourse(card(`${MARK} hijack`, { id: f.cDemo })));
      expect(r.ok, who).toBe(false);
      expect(await snapshot(), who).toBe(before);
      expect((await pressed(() => actions.setHomeCourse(f.cDemo))).ok, who).toBe(false);
    }
  });
});

describe("a tournament open: its admin, and a CHANGE also needs the club", () => {
  it("refused: an assistant, on every library action", async () => {
    for (const a of LIBRARY) {
      session = inEvent(users.assistant, f.evC, "assistant");
      const before = await snapshot();
      const r = await pressed(() => a.run(f.cC, f.tC));
      expect(r.ok, `assistant ${a.name}`).toBe(false);
      expect(r.error).toMatch(/Only the tournament's organizer/);
      expect(await snapshot(), `assistant ${a.name} wrote`).toBe(before);
    }
  });

  it("refused: a player in another club's tournament who also runs an event-less club", async () => {
    // Has a tournament (evB), is not its admin: refused. NOT sent on to the club branch, where they ARE owner of D.
    for (const a of LIBRARY) {
      session = inEvent(users.dual, f.evB, "player");
      const before = await snapshot();
      const r = await pressed(() => a.run(f.cD, f.tD));
      expect(r.ok, `dual ${a.name}`).toBe(false);
      expect(r.error).toMatch(/Only the tournament's organizer/);
      expect(await snapshot(), `dual ${a.name} wrote`).toBe(before);
    }
  });

  it("refused: a guest organizer on each CHANGE action; allowed on each ADD (an away day)", async () => {
    for (const a of LIBRARY.filter((x) => x.kind === "change")) {
      session = inEvent(users.guest, f.evC, "admin");
      const before = await snapshot();
      const r = await pressed(() => a.run(f.cC, f.tC));
      expect(r.ok, `guest ${a.name}`).toBe(false);
      expect(r.error, `guest ${a.name}`).toMatch(/Only a Commissioner or Admin/);
      expect(await snapshot(), `guest ${a.name} wrote`).toBe(before);
    }
    session = inEvent(users.guest, f.evC, "admin");
    const away = await actions.saveClubCourse(card(`${MARK} away day ${Math.random()}`));
    expect(away.ok).toBe(true);
    const tee = await actions.saveTee(away.courseId!, TEE);
    expect(tee.ok).toBe(true);
    expect((await actions.verifyCourseCard(away.courseId!)).ok).toBe(true);
  });

  it("allowed: the club's own owner, with the tournament open, on a change", async () => {
    session = inEvent(users.ownerC, f.evC, "admin");
    const c = await course(f.C, "owner-change");
    expect((await actions.setHomeCourse(c.id)).ok).toBe(true);
    expect((await actions.deleteClubCourse(c.id)).ok).toBe(true);
  });

  it("refused in words: an archived open tournament, on an add and on a change", async () => {
    session = inEvent(users.ownerC, f.evCarch, "admin");
    const before = await snapshot();
    const add = await pressed(() => actions.saveClubCourse(card(`${MARK} archived`)));
    const change = await pressed(() => actions.setHomeCourse(f.cC));
    for (const r of [add, change]) {
      expect(r.ok).toBe(false);
      expect(r.error).not.toMatch(/^THROWN/);
      expect(r.error.length).toBeGreaterThan(20);
    }
    expect(await snapshot()).toBe(before);
  });
});

describe("the two directory doors stay 'themselves'; a no-event secretary's import lands in the club", () => {
  it("source: neither takes the gate", async () => {
    const { readSource } = await import("./source");
    const src = readSource("src/app/actions/courses.ts").replace(/\r\n/g, "\n");
    for (const name of ["searchCourseDirectory", "importCourseFromDirectory"]) {
      const body = src.slice(src.indexOf(`export async function ${name}(`)).split("\nexport ")[0];
      expect(body, name).not.toContain("requireCourseKeeper(");
      expect(body, name).not.toContain("requireOrganizerOrg(");
    }
  });

  it("a no-event admin's import is in the CLUB, and their organizations are unchanged", async () => {
    // Its OWN catalogue row (CI's database holds none). A cell that returns
    // when there is nothing to press passes on nothing.
    const dirId = `${MARK}-dir-${process.pid}`;
    await prisma.courseCatalog.create({
      data: {
        id: dirId, name: `${MARK} Directory Links`, city: "Nowhere",
        par: PARS.reduce((a, b) => a + b, 0),
        pars: JSON.stringify(PARS), yards: JSON.stringify(YARDS), strokeIndex: JSON.stringify(SI),
      },
    });
    try {
      expect(await prisma.courseCatalog.count({ where: { id: dirId } })).toBe(1);
      session = asNoEvent(users.adminA);
      const orgsBefore = await prisma.organizationMember.count({ where: { userId: f.adminA } });
      const clubsBefore = await prisma.organization.count({ where: { members: { some: { userId: f.adminA } } } });
      const r = await actions.importCourseFromDirectory(dirId);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r.courseId).toBeTruthy();
      const row = await prisma.course.findUnique({ where: { id: r.courseId as string }, select: { organizationId: true } });
      expect(row?.organizationId).toBe(f.A);
      // Created by this press, so it goes by this id.
      await prisma.tee.deleteMany({ where: { courseId: r.courseId as string } });
      await prisma.course.deleteMany({ where: { id: r.courseId as string, organizationId: f.A } });
      expect(await prisma.organizationMember.count({ where: { userId: f.adminA } })).toBe(orgsBefore);
      expect(await prisma.organization.count({ where: { members: { some: { userId: f.adminA } } } })).toBe(clubsBefore);
    } finally {
      await prisma.courseCatalog.deleteMany({ where: { id: dirId } });
    }
  });
});

describe("the payload is checked at the boundary", () => {
  it("`played` that is not one of the three is the question, never a re-score", async () => {
    const { playedChoice } = await import("@/lib/domain/course-payload");
    for (const bad of ["rescorE", "", "RESCORE", null, undefined, 7, {}, "keep_history"]) expect(playedChoice(bad)).toBe("ask");
    for (const good of ["ask", "keep-history", "rescore"]) expect(playedChoice(good)).toBe(good);
  });

  it("a bad payload is refused in words and writes nothing", async () => {
    session = asNoEvent(users.adminA);
    const before = await snapshot();
    const bad: Array<[string, () => Promise<Result>]> = [
      ["name is a number", () => actions.saveClubCourse({ ...card("x"), name: 5 as unknown as string })],
      ["name is huge", () => actions.saveClubCourse(card("x".repeat(5000)))],
      ["pars is not an array", () => actions.saveClubCourse({ ...card("x"), pars: "4,4" as unknown as number[] })],
      ["city is an object", () => actions.saveClubCourse({ ...card("x"), city: {} as unknown as string })],
      ["tee par NaN", () => actions.saveTee(f.cA, { ...TEE, par: NaN })],
      ["tee slope NaN beside a real rating", () => actions.saveTee(f.cA, { ...TEE, slopeRating: NaN })],
      ["tee rating Infinity", () => actions.saveTee(f.cA, { ...TEE, courseRating: Infinity })],
      ["tee name is a number", () => actions.saveTee(f.cA, { ...TEE, name: 3 as unknown as string })],
      ["card name is a number", () => actions.importClubCourseCard({ name: 1 as unknown as string, pars: "4", strokeIndex: "1" })],
      ["card rows are huge", () => actions.importClubCourseCard({ name: "x", pars: "4 ".repeat(5000), strokeIndex: "1" })],
      ["card rows are arrays", () => actions.importClubCourseCard({ name: "x", pars: PARS as unknown as string, strokeIndex: "1" })],
    ];
    for (const [what, run] of bad) {
      const r = await pressed(run);
      expect(r.ok, what).toBe(false);
      expect(r.error, `${what} must be refused in words`).not.toMatch(/^THROWN/);
      expect(r.error.length, what).toBeGreaterThan(5);
    }
    expect(await snapshot()).toBe(before);
  });
});
