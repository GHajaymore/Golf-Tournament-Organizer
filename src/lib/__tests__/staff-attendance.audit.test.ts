import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * The organizer records the week's field, and the player still cannot.
 *
 * `setAttendance` was written to allow both halves of this from the start and
 * only one of them was ever reachable. The player's availability card was the
 * sole caller in the app, so under `captains` — where the help text promises
 * that captains send their pairs in and the club enters them — there was no
 * writer at all, every player resolved to OUT, and the tee sheet drew from an
 * empty field over a full roster.
 *
 * Adding a staff surface is the kind of change that fixes a hole by opening
 * one, so what this pins is both directions at once:
 *
 *   - staff may mark anybody in or out, in any mode that tracks attendance,
 *     past the sign-up deadline, and the row records WHO;
 *   - a player may still only answer for themself, may not answer at all
 *     under `captains`, and may not answer past the deadline.
 *
 * Against real rows rather than the source, because every one of those is a
 * decision made from a session, an Event column and a Stage column together,
 * and reading any one of them proves nothing about the other two.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-STAFFATT";

type Session = { eventId: string; email: string; name: string; role: string; viewRole: string };
let session: Session | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/services/board-refresh", () => ({ boardChanged: () => {} }));

const { setAttendance } = await import("@/app/actions/attendance");

let eventId = "";
let openStage = "";
let closedStage = "";
const player: Record<string, string> = {};

const ANN = `${TAG}.ann@example.invalid`.toLowerCase();
const BEA = `${TAG}.bea@example.invalid`.toLowerCase();

const staff: Session = {
  eventId: "",
  email: `${TAG}.sec@example.invalid`.toLowerCase(),
  name: "Zz Secretary",
  role: "admin",
  viewRole: "admin",
};
const asAnn: Session = { eventId: "", email: ANN, name: "Zz Ann", role: "player", viewRole: "player" };

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** What the mode column says today. Changed per test rather than per fixture. */
async function setMode(mode: string) {
  await prisma.event.update({ where: { id: eventId }, data: { attendanceMode: mode } });
}

const rowFor = (stageId: string, playerId: string) =>
  prisma.roundAttendance.findUnique({ where: { stageId_playerId: { stageId, playerId } } });

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} society`, kind: "community" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} winter league`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      attendanceMode: "opt-out",
    },
  });
  eventId = event.id;
  staff.eventId = eventId;
  asAnn.eventId = eventId;

  // Two rounds: one whose sign-up window is open, one whose deadline has gone.
  // The closed one is what separates "staff are never bound by it" from "the
  // deadline is not enforced at all".
  const open = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, optDeadline: "" },
  });
  const closed = await prisma.stage.create({
    data: {
      eventId,
      position: 1,
      type: "Stroke Play Round",
      format: "Stroke Play",
      holes: 18,
      optDeadline: "2020-01-01",
    },
  });
  openStage = open.id;
  closedStage = closed.id;

  for (const [i, [who, addr]] of ([["ann", ANN], ["bea", BEA]] as const).entries()) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: addr, seed: i + 1, status: "confirmed" },
    });
    player[who] = p.id;
  }
});

beforeEach(async () => {
  await prisma.roundAttendance.deleteMany({ where: { eventId } });
  await setMode("opt-out");
  session = null;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("an organizer recording the week", () => {
  it("marks a player out, and the row says who did it", async () => {
    session = staff;
    const res = await setAttendance(openStage, player.ann, "out");
    expect(res.ok).toBe(true);
    const row = await rowFor(openStage, player.ann);
    expect(row?.status).toBe("out");
    // "Why am I not playing this week" has to have a name in the answer.
    expect(row?.decidedBy).toBe("Zz Secretary");
  });

  it("takes over an answer the player already gave, and takes the name with it", async () => {
    /**
     * The case the feature actually exists for, and the one a create-only test
     * misses entirely. Ann opts in on Sunday and rings in sick on Wednesday;
     * the committee changes it. `setAttendance` upserts, so this is the UPDATE
     * branch — a different line, with its own copy of `decidedBy`, which a
     * mutation of the create branch alone leaves untouched.
     *
     * The name is the point. A row still crediting Ann for a change the office
     * made is a record that answers "who took me out" with the wrong person.
     */
    session = asAnn;
    expect((await setAttendance(openStage, player.ann, "in")).ok).toBe(true);
    expect((await rowFor(openStage, player.ann))?.decidedBy).toBe("Zz Ann");

    session = staff;
    expect((await setAttendance(openStage, player.ann, "out")).ok).toBe(true);
    const row = await rowFor(openStage, player.ann);
    expect(row?.status).toBe("out");
    expect(row?.decidedBy).toBe("Zz Secretary");
  });

  it("is not bound by the sign-up deadline", async () => {
    // The whole point of the freeze: it protects the organizer marking a
    // Wednesday-morning no-show, it does not obstruct them.
    session = staff;
    const res = await setAttendance(closedStage, player.ann, "out");
    expect(res.ok).toBe(true);
    expect((await rowFor(closedStage, player.ann))?.status).toBe("out");
  });

  it("puts a player IN under captains, which nothing else in the app can do", async () => {
    await setMode("captains");
    session = staff;
    const res = await setAttendance(openStage, player.bea, "in");
    expect(res.ok).toBe(true);
    expect((await rowFor(openStage, player.bea))?.status).toBe("in");
  });

  it("is still refused where the tournament tracks nothing", async () => {
    // `everyone` is the feature switched off. A stored row there would be a
    // fact about a question the tournament does not ask.
    await setMode("everyone");
    session = staff;
    const res = await setAttendance(openStage, player.ann, "out");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/doesn't use weekly sign-up/i);
    expect(await rowFor(openStage, player.ann)).toBeNull();
  });

  it("cannot invent a third answer", async () => {
    session = staff;
    const res = await setAttendance(openStage, player.ann, "maybe");
    expect(res.ok).toBe(false);
    expect(await rowFor(openStage, player.ann)).toBeNull();
  });
});

describe("a player, with the staff surface now in the app", () => {
  it("still answers only for themself", async () => {
    session = asAnn;
    const res = await setAttendance(openStage, player.bea, "out");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/only answer for yourself/i);
    expect(await rowFor(openStage, player.bea)).toBeNull();
  });

  it("still answers for themself, or the league has no sign-up", async () => {
    // The control. Without it every refusal above passes on a surface that
    // simply stopped working for players.
    session = asAnn;
    const res = await setAttendance(openStage, player.ann, "out");
    expect(res.ok).toBe(true);
    expect((await rowFor(openStage, player.ann))?.status).toBe("out");
  });

  it("is still stopped by their own deadline", async () => {
    session = asAnn;
    const res = await setAttendance(closedStage, player.ann, "out");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/window for this round has closed/i);
    expect(await rowFor(closedStage, player.ann)).toBeNull();
  });

  it("is still shut out of captains mode entirely", async () => {
    // A "use server" export is a public HTTP endpoint. A player whose screen
    // never offers the question can still call it, and if it were allowed they
    // could contradict the list their captain sent with no way to tell which
    // the club meant.
    await setMode("captains");
    session = asAnn;
    const res = await setAttendance(openStage, player.ann, "in");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/captain/i);
    expect(await rowFor(openStage, player.ann)).toBeNull();
  });
});
