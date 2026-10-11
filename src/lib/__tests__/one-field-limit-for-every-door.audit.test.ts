import "dotenv/config";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * ONE FIELD LIMIT, WHICHEVER DOOR SOMEBODY COMES IN BY (sweep 1, b9, 2026-10-10).
 *
 * A tournament's field is limited by one of two columns, and a mode flag says
 * which: `capacity` while the size comes from registrations, and
 * `manualPlayerCount` once the organizer has typed a target. The waiting list
 * has read the flag since 2026-09-02 (`fieldLimitOf`). Every way INTO the
 * field read `capacity` regardless.
 *
 * So: capacity 32, target set to 16. The field is trimmed to sixteen and the
 * rest are told they are on the waiting list. The next person the organizer
 * adds by hand is confirmed as number seventeen — past the limit, and past
 * everybody waiting, which is the one thing a waiting list exists to prevent.
 * The next withdrawal then promotes nobody, because the list says the field
 * is over-full.
 *
 * Every door now asks `fieldLimitFor`, which is the list's own number under
 * the plan's cap.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ONELIMIT";
const EMAIL = `${TAG}.sec@example.invalid`.toLowerCase();
const session = { email: EMAIL, name: `${TAG} secretary`, eventId: "", role: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { addSignup, approveSignup } = await import("@/app/actions/tournament");
const { addMembersToEvent } = await import("@/app/actions/roster");

let eventId = "";
let orgId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/**
 * A field of two with one person waiting behind them. `capacity` says there
 * is room for thirty more; in manual mode the target says there is none.
 */
async function field(mode: "manual" | "registration") {
  await scrub();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id, name: `${TAG} open`, dates: "", course: "", city: "", address: "", regDeadline: "",
      shareToken: `${TAG}-${process.pid}-${mode}`, format: "stroke", capacity: 32, playerCountMode: mode, manualPlayerCount: 2,
      configUnlocked: true,
    },
  });
  eventId = event.id;
  session.eventId = eventId;
  await prisma.account.create({ data: { eventId, email: EMAIL, name: `${TAG} secretary`, role: "admin" } });
  const player = (name: string, seed: number, status: string) =>
    prisma.player.create({ data: { eventId, name: `${TAG} ${name}`, email: `${TAG}.${name}@example.invalid`.toLowerCase(), seed, status, handicap: 10 } });
  await player("in1", 1, "confirmed");
  await player("in2", 2, "confirmed");
  await player("waiting", 3, "waitlisted");
  return player;
}

const statusOf = async (name: string) =>
  (await prisma.player.findFirst({ where: { eventId, name: `${TAG} ${name}` }, select: { status: true } }))?.status;

beforeEach(() => {
  session.eventId = "";
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a field at its manual target is full, whichever door is tried", () => {
  it("a player added by hand waits, behind the one already waiting", async () => {
    await field("manual");
    const res = await addSignup({ name: `${TAG} late`, email: `${TAG}.late@example.invalid`.toLowerCase(), handicap: 12, phone: "07700 900111" });
    expect(res.ok, res.ok ? "" : String(res.error)).toBe(true);
    expect(await statusOf("late")).toBe("waitlisted");
  });

  it("an entry approved by the organizer waits too", async () => {
    const player = await field("manual");
    const pending = await player("asked", 4, "pending");
    expect((await approveSignup(pending.id)).ok).toBe(true);
    expect(await statusOf("asked")).toBe("waitlisted");
  });

  it("a member added from the club roster waits too", async () => {
    await field("manual");
    const member = await prisma.member.create({
      data: { organizationId: orgId, name: `${TAG} member`, email: `${TAG}.member@example.invalid`.toLowerCase(), handicap: 9, handicapSource: "manual", phone: "07700 900112" },
    });
    const res = await addMembersToEvent([member.id]);
    expect(res.ok, res.ok ? "" : String(res.error)).toBe(true);
    expect(await statusOf("member")).toBe("waitlisted");
  });
});

describe("CONTROL: the same field measured by registrations has thirty places left", () => {
  it("a player added by hand is confirmed", async () => {
    // Otherwise the cases above pass on a fixture that waitlists everybody.
    await field("registration");
    const res = await addSignup({ name: `${TAG} late`, email: `${TAG}.late@example.invalid`.toLowerCase(), handicap: 12, phone: "07700 900111" });
    expect(res.ok, res.ok ? "" : String(res.error)).toBe(true);
    expect(await statusOf("late")).toBe("confirmed");
  });

  it("an approved entry is confirmed", async () => {
    const player = await field("registration");
    const pending = await player("asked", 4, "pending");
    await approveSignup(pending.id);
    expect(await statusOf("asked")).toBe("confirmed");
  });
});

/**
 * A BLANK HANDICAP ON THE REGISTRATION FORM IS NO HANDICAP (sweep 1, b17).
 *
 * The roster learned this on 2026-10-10 (`editing-a-member-keeps…`); the
 * Registration add form had the same fault. An empty box was parsed as 0 and
 * sent with the source radio's default, "manual" — a player nobody gave a
 * handicap to, stored as a scratch golfer by the organizer's own hand, and
 * given no strokes in a net round with nothing on screen to say why.
 */
describe("a player added by hand with the handicap box empty", () => {
  const read = (name: string) =>
    prisma.player.findFirst({ where: { eventId, name: `${TAG} ${name}` }, select: { handicap: true, handicapSource: true } });

  it("has no handicap — not scratch by hand", async () => {
    await field("registration");
    const res = await addSignup({
      name: `${TAG} blank`, email: `${TAG}.blank@example.invalid`.toLowerCase(), phone: "07700 900113",
      handicap: Number.NaN, handicapSource: "manual",
    });
    expect(res.ok, res.ok ? "" : String(res.error)).toBe(true);
    expect(await read("blank")).toEqual({ handicap: 0, handicapSource: "none" });
    // And on the club's roster, where the same add creates their member row.
    const member = await prisma.member.findFirst({ where: { organizationId: orgId, name: `${TAG} blank` }, select: { handicap: true, handicapSource: true } });
    expect(member, "the add did not put them on the roster").not.toBeNull();
    expect(member).toEqual({ handicap: 0, handicapSource: "none" });
  });

  it("CONTROL: a zero somebody typed is a scratch golfer, on purpose", async () => {
    await field("registration");
    await addSignup({
      name: `${TAG} scratch`, email: `${TAG}.scratch@example.invalid`.toLowerCase(), phone: "07700 900114",
      handicap: 0, handicapSource: "manual",
    });
    expect(await read("scratch")).toEqual({ handicap: 0, handicapSource: "manual" });
  });

  it("the form sends an empty box as empty, not as nought", async () => {
    const { readSource } = await import("./source");
    expect(readSource("src/components/RegistrationClient.tsx")).toContain('handicap: h.source === "none" ? Number.NaN : h.value');
  });
});
