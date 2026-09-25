import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A member sets their OWN availability, in ANY of their tournaments — and in no
 * one else's.
 *
 * `setOwnAttendance` is the club-wide calendar's toggle, and it is the one
 * attendance writer that does NOT scope to the caller's active event: the whole
 * point is answering for a round in a tournament that is not the one open in
 * front of you. That makes the authorization the entire story, and it is a
 * decision made from three things at once — a session's email, the round posted
 * to it, and the event that round belongs to — so reading any one proves
 * nothing. Hence real rows.
 *
 * What it pins:
 *
 *   - a confirmed member may set their own round, whatever their active event
 *     is pointed at — the resolution is off the STAGE, not the cookie;
 *   - a member may NOT set a round in a tournament they hold no confirmed place
 *     in, even by posting its stage id directly (the IDOR the structural sweep
 *     checks, proved here against rows);
 *   - a waitlisted place is not a place: still refused;
 *   - captains, everyone, a passed deadline and a nonsense status are each
 *     refused, the same rules `setAttendance` enforces on its own surface.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-OWNATT";

type Session = { eventId: string; email: string; name: string; role: string; viewRole: string };
let session: Session | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/services/board-refresh", () => ({ boardChanged: () => {} }));

const { setOwnAttendance } = await import("@/app/actions/attendance");

const ANN = `${TAG}.ann@example.invalid`.toLowerCase();

let mineId = "";
let othersId = "";
let mineOpen = "";
let mineClosed = "";
let othersStage = "";
const annIn: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function makeEvent(suffix: string): Promise<string> {
  const org = await prisma.organization.create({ data: { name: `${TAG} ${suffix} org`, kind: "community" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} ${suffix}`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${suffix}-${process.pid}`,
      attendanceMode: "opt-out",
    },
  });
  return event.id;
}

const rowFor = (stageId: string, playerId: string) =>
  prisma.roundAttendance.findUnique({ where: { stageId_playerId: { stageId, playerId } } });

const setMode = (eventId: string, mode: string) =>
  prisma.event.update({ where: { id: eventId }, data: { attendanceMode: mode } });

beforeAll(async () => {
  await cleanup();

  // The member's OWN tournament, and a second one they are not in.
  mineId = await makeEvent("mine");
  othersId = await makeEvent("theirs");

  const open = await prisma.stage.create({
    data: { eventId: mineId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, optDeadline: "" },
  });
  const closed = await prisma.stage.create({
    data: {
      eventId: mineId,
      position: 1,
      type: "Stroke Play Round",
      format: "Stroke Play",
      holes: 18,
      optDeadline: "2020-01-01",
    },
  });
  const theirs = await prisma.stage.create({
    data: { eventId: othersId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, optDeadline: "" },
  });
  mineOpen = open.id;
  mineClosed = closed.id;
  othersStage = theirs.id;

  const ann = await prisma.player.create({
    data: { eventId: mineId, name: `${TAG} ann`, email: ANN, seed: 1, status: "confirmed" },
  });
  annIn.mine = ann.id;
});

beforeEach(async () => {
  await prisma.roundAttendance.deleteMany({ where: { eventId: { in: [mineId, othersId] } } });
  await setMode(mineId, "opt-out");
  await setMode(othersId, "opt-out");
  // A waitlisted-in-the-other-event row is created only by the test that needs
  // it, and cleared here so it never leaks into the "not in it at all" case.
  await prisma.player.deleteMany({ where: { eventId: othersId, email: ANN } });
  session = null;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a member setting their own availability", () => {
  it("sets their own round even when their active event is a DIFFERENT one", async () => {
    // The cookie points at the other tournament; the answer still lands on the
    // round posted, in the tournament that round belongs to. This is the whole
    // reason the action exists and does not read session.eventId.
    session = { eventId: othersId, email: ANN, name: "Zz Ann", role: "player", viewRole: "player" };
    const res = await setOwnAttendance(mineOpen, "out");
    expect(res.ok).toBe(true);
    const row = await rowFor(mineOpen, annIn.mine);
    expect(row?.status).toBe("out");
    expect(row?.eventId).toBe(mineId);
    expect(row?.decidedBy).toBe("Zz Ann");
  });

  it("REFUSES a round in a tournament they hold no place in, posted directly", async () => {
    // The IDOR. Ann is a real signed-in member; the stage is real; she is just
    // not in its event. Nothing may be written.
    session = { eventId: mineId, email: ANN, name: "Zz Ann", role: "player", viewRole: "player" };
    const res = await setOwnAttendance(othersStage, "in");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/aren't in this tournament/i);
    // Proven by rows, not by the message: no attendance exists for that round.
    expect(await prisma.roundAttendance.count({ where: { stageId: othersStage } })).toBe(0);
  });

  it("treats a waitlisted place as no place", async () => {
    // A place is a CONFIRMED place — the rule every card guard uses. An
    // applicant waiting on the organizer cannot set a round they may never play.
    await prisma.player.create({
      data: { eventId: othersId, name: `${TAG} ann waiting`, email: ANN, seed: 9, status: "waitlisted" },
    });
    session = { eventId: othersId, email: ANN, name: "Zz Ann", role: "player", viewRole: "player" };
    const res = await setOwnAttendance(othersStage, "in");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/aren't in this tournament/i);
    expect(await prisma.roundAttendance.count({ where: { stageId: othersStage } })).toBe(0);
  });

  it("takes over an answer it already set, keeping the member's name", async () => {
    session = { eventId: mineId, email: ANN, name: "Zz Ann", role: "player", viewRole: "player" };
    expect((await setOwnAttendance(mineOpen, "in")).ok).toBe(true);
    expect((await rowFor(mineOpen, annIn.mine))?.status).toBe("in");
    expect((await setOwnAttendance(mineOpen, "out")).ok).toBe(true);
    const row = await rowFor(mineOpen, annIn.mine);
    expect(row?.status).toBe("out");
    expect(row?.decidedBy).toBe("Zz Ann");
  });

  it("is refused under captains — the club holds the list", async () => {
    await setMode(mineId, "captains");
    session = { eventId: mineId, email: ANN, name: "Zz Ann", role: "player", viewRole: "player" };
    const res = await setOwnAttendance(mineOpen, "in");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/captain/i);
    expect(await rowFor(mineOpen, annIn.mine)).toBeNull();
  });

  it("is refused where the tournament tracks nothing", async () => {
    await setMode(mineId, "everyone");
    session = { eventId: mineId, email: ANN, name: "Zz Ann", role: "player", viewRole: "player" };
    const res = await setOwnAttendance(mineOpen, "out");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/doesn't use weekly sign-up/i);
    expect(await rowFor(mineOpen, annIn.mine)).toBeNull();
  });

  it("is stopped by the round's own deadline", async () => {
    session = { eventId: mineId, email: ANN, name: "Zz Ann", role: "player", viewRole: "player" };
    const res = await setOwnAttendance(mineClosed, "out");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/window for this round has closed/i);
    expect(await rowFor(mineClosed, annIn.mine)).toBeNull();
  });

  it("cannot invent a third answer", async () => {
    session = { eventId: mineId, email: ANN, name: "Zz Ann", role: "player", viewRole: "player" };
    const res = await setOwnAttendance(mineOpen, "maybe");
    expect(res.ok).toBe(false);
    expect(await rowFor(mineOpen, annIn.mine)).toBeNull();
  });
});
