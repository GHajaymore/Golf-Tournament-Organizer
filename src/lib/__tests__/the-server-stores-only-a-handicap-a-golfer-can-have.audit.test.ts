import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE SERVER STORES ONLY A HANDICAP A GOLFER CAN HAVE.
 *
 * A handicap index runs from +10 to 54. The forms checked that; the server did
 * not. Four actions — adding a player, correcting one, adding a member,
 * correcting one — stored whatever finite number they were handed, and one
 * box, on a casual round, sent what was typed without looking. 124 for 12.4 is
 * six strokes a hole, on every net card and in every pot that player is in,
 * and nothing anywhere would have called it wrong.
 *
 * An action is a public endpoint: the form in front of it is one caller among
 * any number. So this calls the four as a caller with no form would, with each
 * figure a form would have refused, and reads the row back.
 *
 * `a-typed-figure-is-read-one-way.test.ts` holds the reading of the text and
 * that each action ASKS; this holds what is in the database afterwards.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-INDEXRANGE";
const EMAIL = `${TAG}.sec@example.invalid`.toLowerCase();
const session = { email: EMAIL, name: `${TAG} secretary`, eventId: "", role: "admin", viewRole: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { addSignup, updateSignup } = await import("@/app/actions/tournament");
const { addMember, updateMember } = await import("@/app/actions/roster");

let orgId = "";
let eventId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club", handicapPolicy: "club" } });
  orgId = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} medal`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      format: "stroke",
      capacity: 40,
      configUnlocked: true,
    },
  });
  eventId = event.id;
  session.eventId = eventId;
  await prisma.account.create({ data: { eventId, email: EMAIL, name: `${TAG} secretary`, role: "admin" } });
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

/** Figures no golfer has, each of which is a perfectly good number. */
const IMPOSSIBLE = [124, 54.1, -10.1, 999, -500, 1e9];
/** And the edges of the range, which are real. */
const REAL = [-10, -2.4, 0, 12.4, 54];

describe("adding a player to the field", () => {
  it("refuses a figure outside +10 to 54, and adds nobody", async () => {
    for (const handicap of IMPOSSIBLE) {
      const res = await addSignup({ name: `${TAG} typo ${handicap}`, handicap, email: `${TAG}.typo${Math.abs(handicap)}@example.invalid`.toLowerCase() });
      expect(res.ok, `${handicap} was stored as a handicap`).toBe(false);
      expect(res.ok === false && res.error).toMatch(/\+10 to 54/);
    }
    expect(await prisma.player.count({ where: { eventId, name: { contains: "typo" } } })).toBe(0);
  });

  it("takes every figure in the range, and a blank as no index", async () => {
    for (const handicap of REAL) {
      const res = await addSignup({ name: `${TAG} real ${handicap}`, handicap, email: `${TAG}.real${String(handicap).replace(/[^0-9]/g, "")}${handicap < 0 ? "p" : ""}@example.invalid`.toLowerCase(), phone: "07700 900120" });
      expect(res.ok, `${handicap} was refused: ${res.ok === false ? res.error : ""}`).toBe(true);
    }
    const blank = await addSignup({ name: `${TAG} no index`, handicap: Number.NaN, email: `${TAG}.none@example.invalid`.toLowerCase(), phone: "07700 900121" });
    expect(blank.ok, `a blank was refused: ${blank.ok === false ? blank.error : ""}`).toBe(true);
    const row = await prisma.player.findFirstOrThrow({ where: { eventId, name: `${TAG} no index` } });
    expect([row.handicap, row.handicapSource]).toEqual([0, "none"]);
  });
});

describe("correcting a player's handicap", () => {
  it("refuses an impossible figure and leaves the one they had", async () => {
    const player = await prisma.player.create({
      data: { eventId, name: `${TAG} Bob`, email: `${TAG}.bob@example.invalid`.toLowerCase(), seed: 90, status: "confirmed", handicap: 12.4 },
    });
    for (const handicap of IMPOSSIBLE) {
      const res = await updateSignup(player.id, { handicap });
      expect(res.ok, `${handicap} was stored`).toBe(false);
      expect(res.ok === false && res.error).toMatch(/\+10 to 54/);
      expect((await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).handicap).toBe(12.4);
    }
    // CONTROL: the action does store a real one, so the refusals above were about the figure.
    const ok = await updateSignup(player.id, { handicap: 9.8 });
    expect(ok.ok).toBe(true);
    expect((await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).handicap).toBe(9.8);
  });
});

describe("the club's roster", () => {
  it("adds nobody with an impossible index", async () => {
    for (const handicap of IMPOSSIBLE) {
      const res = await addMember({ name: `${TAG} member typo ${handicap}`, handicap });
      expect(res.ok, `${handicap} was stored on the roster`).toBe(false);
      expect(res.ok === false && res.error).toMatch(/\+10 to 54/);
    }
    expect(await prisma.member.count({ where: { organizationId: orgId, name: { contains: "member typo" } } })).toBe(0);
  });

  it("does not let a correction make one impossible, and keeps the index it had", async () => {
    const member = await prisma.member.create({
      data: { organizationId: orgId, name: `${TAG} Cat`, email: `${TAG}.cat@example.invalid`.toLowerCase(), handicap: 18.2, handicapSource: "manual" },
    });
    for (const handicap of IMPOSSIBLE) {
      const res = await updateMember(member.id, { name: member.name, email: member.email, handicap });
      expect(res.ok, `${handicap} was stored on the roster`).toBe(false);
      expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).handicap).toBe(18.2);
    }
    // CONTROLS: a real figure is stored; and a member with no index can still be added.
    const ok = await updateMember(member.id, { name: member.name, email: member.email, handicap: 17.9 });
    expect(ok.ok, `a real index was refused: ${ok.ok === false ? ok.error : ""}`).toBe(true);
    expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).handicap).toBe(17.9);
    const none = await addMember({ name: `${TAG} Dee no index`, handicap: Number.NaN });
    expect(none.ok, `a member with no index was refused: ${none.ok === false ? none.error : ""}`).toBe(true);
  });
});
