import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

/**
 * A PLAYER WITH NO HANDICAP INDEX IS CAUGHT WHICHEVER DOOR THEY COME IN BY (review of #1144, design §8).
 *
 * The catch is on STATE: `playersNeedingFigure` reads every confirmed player and asks the one rule, so a door
 * is caught exactly when it stores "no index" as `handicapSource: "none"`. The audit beside this one writes
 * that row with Prisma, so no test would have seen a door that stored something else — and one did: a member
 * entering themselves with no roster row was stored as 0 "manual", a scratch golfer nobody declared, and was
 * on no list (C1). So here every door is PRESSED, as the person who uses it, with the handicap left blank,
 * into a tournament whose one round is scored net, and the list must name each of them:
 *
 *   the organizer adds a player (`addSignup`)            the organizer imports a CSV (`importCsvSignups`)
 *   a member added to the roster, then to the field       a roster CSV, then to the field (`addMembersToEvent`)
 *   the public entry form, signed in as the entrant       a member entering themselves with a roster row
 *   a member entering themselves with NO roster row (C1)
 *
 * and, as the CONTROL, the organizer adding a player with an index is on no list.
 *
 * Fixtures: a zz-marked club and tournament, invented names, @example.invalid with a fresh suffix every run
 * (the entry limiter's counters outlive the rows), deleted in a `finally`.
 *
 *   npx vitest run --config vitest.audit.config.ts no-index-every-door
 */

const session = { userId: "", accountId: "", eventId: "", name: "", email: "", role: "player", viewRole: "player" };
vi.mock("@/lib/auth", () => ({
  getSession: async () => (session.email ? { ...session } : null),
  setActiveEvent: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

import { addSignup, importCsvSignups } from "@/app/actions/tournament";
import { addMember, addMembersToEvent, importCsvMembers } from "@/app/actions/roster";
import { registerForEvent } from "@/app/actions/register";
import { enterThisTournament } from "@/app/actions/enter";
import { playersNeedingFigure } from "@/lib/services/committee-figure";

const prisma = new PrismaClient();
const TAG = "zz-audit-noindexdoor";
const RUN = randomBytes(4).toString("hex");
const at = (who: string) => `${TAG}-${RUN}.${who}@example.invalid`;
let orgId = "";
let eventId = "";
let token = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

function asStaff() {
  Object.assign(session, { userId: "", eventId, name: `${TAG} secretary`, email: at("secretary"), role: "admin", viewRole: "admin" });
}
async function asMember(who: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: at(who) }, select: { id: true, name: true } });
  Object.assign(session, { userId: user.id, eventId: "", name: user.name, email: at(who), role: "player", viewRole: "player" });
}

/** The player the door made, by name, and whether the one list names them. */
async function caught(name: string): Promise<{ source: string | null; listed: boolean }> {
  const p = await prisma.player.findFirstOrThrow({ where: { eventId, name }, select: { id: true, handicapSource: true, status: true } });
  expect(p.status, `${name} is in the field`).toBe("confirmed");
  const listed = (await playersNeedingFigure(eventId)).some((r) => r.players.some((x) => x.id === p.id));
  return { source: p.handicapSource, listed };
}

beforeAll(async () => {
  await cleanup();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club", timeZone: "UTC" } })).id;
  token = `${TAG}-${RUN}`;
  eventId = (
    await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} medal`,
        status: "draft",
        format: "stroke",
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        capacity: 40,
        // A draft is never locked, so it needs no correction opened (9b retired the blanket flag).
        registrationOpen: true,
        registrationApproval: "auto",
        registrationToken: token,
        shareToken: `${TAG}-share-${RUN}`,
      },
    })
  ).id;
  await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "net", handicapAllowance: 95 } });
  await prisma.account.create({ data: { eventId, email: at("secretary"), name: `${TAG} secretary`, role: "admin" } });
  // Members of the club who will enter themselves, and an entrant on the public link.
  for (const who of ["bare", "rostered", "public"]) {
    const user = await prisma.user.create({ data: { email: at(who), name: `${TAG} ${who} account`, emailVerifiedAt: new Date() } });
    if (who !== "public") await prisma.organizationMember.create({ data: { organizationId: orgId, userId: user.id, role: "member" } });
  }
  await prisma.member.create({ data: { organizationId: orgId, name: `${TAG} Rostered Rafa`, email: at("rostered"), handicap: 0, handicapSource: "none" } });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("every door, with the handicap left blank, puts the player on the list", () => {
  it("the organizer adds a player", async () => {
    asStaff();
    const r = await addSignup({ name: `${TAG} Added Ada`, handicap: Number.NaN });
    expect(r.ok, String(r.error ?? "")).toBe(true);
    expect(await caught(`${TAG} Added Ada`)).toEqual({ source: "none", listed: true });
  });

  it("the organizer imports a CSV", async () => {
    asStaff();
    const r = await importCsvSignups(`name,handicap\n${TAG} Imported Ines,\n`);
    expect(r.imported, JSON.stringify(r)).toBe(1);
    expect(await caught(`${TAG} Imported Ines`)).toEqual({ source: "none", listed: true });
  });

  it("a member added to the roster, then to the field", async () => {
    asStaff();
    expect((await addMember({ name: `${TAG} Roster Rui`, email: at("rui") })).ok).toBe(true);
    const m = await prisma.member.findFirstOrThrow({ where: { organizationId: orgId, name: `${TAG} Roster Rui` }, select: { id: true } });
    const r = await addMembersToEvent([m.id]);
    expect(r.ok, String(r.error ?? "")).toBe(true);
    expect(await caught(`${TAG} Roster Rui`)).toEqual({ source: "none", listed: true });
  });

  it("a roster CSV, then to the field", async () => {
    asStaff();
    const r = await importCsvMembers(`name,email,handicap\n${TAG} Csv Cato,${at("cato")},\n`);
    expect(r.imported, JSON.stringify(r)).toBe(1);
    const m = await prisma.member.findFirstOrThrow({ where: { organizationId: orgId, name: `${TAG} Csv Cato` }, select: { id: true } });
    expect((await addMembersToEvent([m.id])).ok).toBe(true);
    expect(await caught(`${TAG} Csv Cato`)).toEqual({ source: "none", listed: true });
  });

  it("the public entry form, signed in as the entrant", async () => {
    await asMember("public");
    const r = await registerForEvent(token, { name: `${TAG} Public Pia`, email: at("public"), handicap: "" });
    expect(r.ok, String(r.error ?? "")).toBe(true);
    expect(await caught(`${TAG} Public Pia`)).toEqual({ source: "none", listed: true });
  });

  it("a member entering themselves, whose roster row says no index", async () => {
    await asMember("rostered");
    const r = await enterThisTournament(eventId);
    expect(r.ok, String(r.error ?? "")).toBe(true);
    expect(await caught(`${TAG} Rostered Rafa`)).toEqual({ source: "none", listed: true });
  });

  it("a member entering themselves with NO roster row: no index, not a scratch golfer (C1)", async () => {
    await asMember("bare");
    const r = await enterThisTournament(eventId);
    expect(r.ok, String(r.error ?? "")).toBe(true);
    expect(await caught(`${TAG} bare account`)).toEqual({ source: "none", listed: true });
  });
});

describe("CONTROL: a player with an index, by the same door, is on no list", () => {
  it("the organizer adds a player off 12", async () => {
    asStaff();
    expect((await addSignup({ name: `${TAG} Indexed Ivo`, handicap: 12 })).ok).toBe(true);
    expect(await caught(`${TAG} Indexed Ivo`)).toEqual({ source: "manual", listed: false });
  });
});
