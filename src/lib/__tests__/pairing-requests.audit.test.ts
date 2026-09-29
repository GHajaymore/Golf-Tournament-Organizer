import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * PAIRING REQUESTS (2026-09-28, Ajay: "go ahead with your recommendations as a
 * golf pro") — "can I play with Bea?", recorded by the committee or asked by
 * the player. What needs real rows: that every id is held to the caller's own
 * tournament and field, and that a request is one fact whichever side made it.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-PAIRING";
const session = { email: "zz-pairing-staff@example.invalid", name: "ZZ Secretary", eventId: "", role: "admin", viewRole: "admin", userId: "", accountId: "" };

vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { setPairingRequest, setMyPlayWith } = await import("@/app/actions/pairing");

const p: Record<string, string> = {};
let stranger = "";
const withOf = async (who: string) => (await prisma.player.findUniqueOrThrow({ where: { id: p[who] } })).playWith;
const asStaff = () => Object.assign(session, { role: "admin", email: "zz-pairing-staff@example.invalid", name: "ZZ Secretary" });
const asPlayer = (who: string) =>
  Object.assign(session, { role: "player", email: `zz-pairing-${who}@example.invalid`, name: `${TAG} ${who}` });

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} society` } });
  const mk = (name: string) =>
    prisma.event.create({
      data: { organizationId: org.id, name, dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${name}-${process.pid}` },
    });
  const ev = await mk(`${TAG} outing`);
  const other = await mk(`${TAG} another`);
  session.eventId = ev.id;
  const people = ["ann", "bea", "cal", "dee", "eve", "fay"] as const;
  for (const [i, who] of people.entries()) {
    const row = await prisma.player.create({
      data: { eventId: ev.id, name: `${TAG} ${who}`, email: `zz-pairing-${who}@example.invalid`, seed: i + 1, status: "confirmed" },
    });
    p[who] = row.id;
  }
  p.wait = (await prisma.player.create({
    data: { eventId: ev.id, name: `${TAG} wait`, email: "zz-pairing-wait@example.invalid", seed: 9, status: "waitlisted" },
  })).id;
  stranger = (await prisma.player.create({
    data: { eventId: other.id, name: `${TAG} elsewhere`, email: "zz-pairing-elsewhere@example.invalid", seed: 1, status: "confirmed" },
  })).id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the committee records a request", () => {
  it("stores it once, whichever way round it is asked again", async () => {
    asStaff();
    expect(await setPairingRequest(p.ann, p.bea, true)).toEqual({ ok: true });
    expect(await setPairingRequest(p.bea, p.ann, true)).toEqual({ ok: true });
    expect(await withOf("ann")).toEqual([p.bea]);
    expect(await withOf("bea")).toEqual([]);
    const log = await prisma.auditLog.findFirst({ where: { eventId: session.eventId, action: "pairing-request" }, orderBy: { createdAt: "desc" } });
    expect(log?.detail).toBe(`Pairing request: ${TAG} ann with ${TAG} bea`);
  });

  it("removing it clears both directions", async () => {
    asStaff();
    await prisma.player.update({ where: { id: p.bea }, data: { playWith: [p.ann] } });
    expect(await setPairingRequest(p.bea, p.ann, false)).toEqual({ ok: true });
    expect(await withOf("ann")).toEqual([]);
    expect(await withOf("bea")).toEqual([]);
  });

  it("holds a player to three — a group only holds four", async () => {
    asStaff();
    for (const w of ["bea", "cal", "dee"]) expect((await setPairingRequest(p.ann, p[w], true)).ok).toBe(true);
    const r = await setPairingRequest(p.ann, p.eve, true);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already asked for 3/);
    await prisma.player.update({ where: { id: p.ann }, data: { playWith: [] } });
  });

  it("refuses anybody outside this tournament's field", async () => {
    asStaff();
    expect((await setPairingRequest(p.ann, stranger, true)).error).toBe("Both players must be in this tournament's field.");
    expect((await setPairingRequest(p.ann, p.wait, true)).error).toBe("Both players must be in this tournament's field.");
    expect((await setPairingRequest(p.ann, p.ann, true)).error).toBe("Pick two different players.");
    expect(await withOf("ann")).toEqual([]);
  });

  it("refuses a player using the committee's door", async () => {
    asPlayer("ann");
    await expect(setPairingRequest(p.ann, p.bea, true)).rejects.toThrow(/organizer or assistant/);
    asStaff();
  });
});

describe("a player asks for themself", () => {
  it("sets their own request, replacing the last, and clears it with none", async () => {
    asPlayer("cal");
    expect(await setMyPlayWith([p.dee, p.eve])).toEqual({ ok: true });
    expect(await withOf("cal")).toEqual([p.dee, p.eve]);
    expect(await setMyPlayWith([p.fay])).toEqual({ ok: true });
    expect(await withOf("cal")).toEqual([p.fay]);
    expect(await setMyPlayWith([])).toEqual({ ok: true });
    expect(await withOf("cal")).toEqual([]);
  });

  it("writes only their OWN row — never the players they name", async () => {
    asPlayer("cal");
    await setMyPlayWith([p.dee]);
    expect(await withOf("dee")).toEqual([]);
    await setMyPlayWith([]);
  });

  it("refuses a name from outside the field, themself, and a fourth", async () => {
    asPlayer("cal");
    expect((await setMyPlayWith([stranger])).ok).toBe(false);
    expect((await setMyPlayWith([p.wait])).ok).toBe(false);
    expect((await setMyPlayWith([p.cal])).error).toMatch(/yourself/);
    expect((await setMyPlayWith([p.ann, p.bea, p.dee, p.eve])).error).toMatch(/up to 3/);
    expect(await withOf("cal")).toEqual([]);
  });

  it("CONTROL: somebody not in the field cannot ask at all", async () => {
    Object.assign(session, { role: "player", email: "zz-pairing-nobody@example.invalid", name: "Nobody" });
    expect((await setMyPlayWith([p.ann])).error).toMatch(/aren't in this tournament's field/);
    // …and a waitlisted entrant has no place to be drawn into yet.
    asPlayer("wait");
    expect((await setMyPlayWith([p.ann])).ok).toBe(false);
    asStaff();
  });
});
