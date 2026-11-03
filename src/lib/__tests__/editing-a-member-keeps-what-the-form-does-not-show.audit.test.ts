import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * EDITING A MEMBER CHANGES WHAT WAS EDITED (sweep 1, b7 and a4, 2026-10-10).
 *
 * The roster's form shows a name, an email, a phone, a GHIN number, a home
 * club, a member number, a handicap and some notes. Saving it also wrote three
 * things it never shows: the member's gender and preferred tee were blanked,
 * and "where this handicap came from" was reset to "typed by hand". So
 * correcting a phone number erased the tee a lady plays from — which the draw
 * and her course handicap both read — and turned a member with NO index into
 * a scratch golfer: no figure, now claimed as 0.
 *
 * A blank handicap box meant the same thing: 0, by hand. The guide has always
 * said the opposite — "a blank handicap is not scratch."
 *
 * And at a club that plays off GHIN, adding a member was refused outright,
 * because the form's own starting value (0) counted as an index typed by hand;
 * while editing one never asked the policy at all.
 *
 * Rules pinned here:
 *   - what the form does not send, the edit does not touch;
 *   - a blank index is "no index", on add and on edit;
 *   - a figure somebody typed is theirs ("manual"), and an unchanged figure
 *     keeps whoever it came from;
 *   - a GHIN club refuses a typed figure on edit as it does on add, and
 *     accepts a member added with no figure.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-MEMBEREDIT";
const EMAIL = `${TAG}.sec@example.invalid`.toLowerCase();
const session = { email: EMAIL, name: `${TAG} secretary`, eventId: "", role: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
// "A club that plays off GHIN" is the service-only rule, dormant while no
// federation link is live (the team's ruling, 2026-10-24: a stored "ghin" then
// reads as the club's own). That block forces the switch on, because it is the
// rule the day a link is live; `service-only-reads-as-the-clubs-own.audit.test.ts`
// holds today's behaviour.
const link = vi.hoisted(() => ({ live: false }));
vi.mock("@/lib/integrations/federation-link", () => ({ federationLinkLive: () => link.live }));

const { addMember, updateMember } = await import("@/app/actions/roster");

let orgId = "";
let ghinOrgId = "";
let eventId = "";
let ghinEventId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function club(name: string, handicapPolicy: string) {
  const org = await prisma.organization.create({ data: { name: `${TAG} ${name}`, kind: "club", handicapPolicy } });
  const event = await prisma.event.create({
    data: { organizationId: org.id, name: `${TAG} ${name} medal`, dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-${name}-${process.pid}` },
  });
  await prisma.account.create({ data: { eventId: event.id, email: EMAIL, name: `${TAG} secretary`, role: "admin" } });
  return { orgId: org.id, eventId: event.id };
}

beforeAll(async () => {
  await scrub();
  ({ orgId, eventId } = await club("own", "club"));
  ({ orgId: ghinOrgId, eventId: ghinEventId } = await club("ghin", "ghin"));
  session.eventId = eventId;
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

const make = (organizationId: string, name: string, extra: Record<string, unknown> = {}) =>
  prisma.member.create({ data: { organizationId, name: `${TAG} ${name}`, email: `${TAG}.${name}@example.invalid`.toLowerCase(), ...extra } });
const read = (id: string) =>
  prisma.member.findUnique({ where: { id }, select: { phone: true, gender: true, preferredTee: true, handicap: true, handicapSource: true } });

/** Exactly what the roster's form sends: these fields and no others. */
const form = (m: { name: string; email: string }, extra: Record<string, unknown> = {}) => ({
  name: m.name, email: m.email, phone: "", ghin: "", homeClub: "", memberNumber: "", handicapType: "18", notes: "", ...extra,
});

describe("editing a member on the roster", () => {
  it("correcting a phone number leaves her tee, her gender and her missing index alone", async () => {
    const m = await make(orgId, "noindex", { gender: "F", preferredTee: "Red", handicap: 0, handicapSource: "none" });
    const res = await updateMember(m.id, form(m, { phone: "07700 900123", handicap: undefined }));
    expect(res.ok).toBe(true);
    expect(await read(m.id)).toEqual({ phone: "07700 900123", gender: "F", preferredTee: "Red", handicap: 0, handicapSource: "none" });
  });

  it("an index nobody retyped keeps whoever it came from", async () => {
    const m = await make(orgId, "fetched", { handicap: 12.4, handicapSource: "ghin", ghin: "" });
    await updateMember(m.id, form(m, { phone: "1", handicap: 12.4 }));
    expect(await read(m.id)).toMatchObject({ handicap: 12.4, handicapSource: "ghin" });
  });

  it("an index the secretary types is the secretary's", async () => {
    const m = await make(orgId, "retyped", { handicap: 12.4, handicapSource: "ghin" });
    await updateMember(m.id, form(m, { handicap: 13.1 }));
    expect(await read(m.id)).toMatchObject({ handicap: 13.1, handicapSource: "manual" });
  });

  it("typing 0 for a member with no index makes a scratch golfer, on purpose", async () => {
    const m = await make(orgId, "scratch", { handicap: 0, handicapSource: "none" });
    await updateMember(m.id, form(m, { handicap: 0 }));
    expect(await read(m.id)).toMatchObject({ handicap: 0, handicapSource: "manual" });
  });

  it("clearing the box says there is no index — not scratch", async () => {
    const m = await make(orgId, "cleared", { handicap: 9.1, handicapSource: "manual" });
    await updateMember(m.id, form(m, { handicap: Number.NaN }));
    expect(await read(m.id)).toMatchObject({ handicap: 0, handicapSource: "none" });
  });

  it("CONTROL: a caller that does send the hidden fields still sets them", async () => {
    const m = await make(orgId, "explicit", { gender: "F", preferredTee: "Red" });
    await updateMember(m.id, form(m, { gender: "M", preferredTee: "White", handicap: 5 }));
    expect(await read(m.id)).toMatchObject({ gender: "M", preferredTee: "White", handicap: 5, handicapSource: "manual" });
  });
});

describe("adding a member", () => {
  it("with the handicap left blank has no index — not scratch", async () => {
    const email = `${TAG}.blank@example.invalid`.toLowerCase();
    const res = await addMember({ name: `${TAG} blank`, email, handicapType: "18" });
    expect(res.ok).toBe(true);
    const m = await prisma.member.findFirst({ where: { organizationId: orgId, email } });
    expect(m).toMatchObject({ handicap: 0, handicapSource: "none" });
  });

  it("with a figure typed is that figure, by hand", async () => {
    const email = `${TAG}.typed@example.invalid`.toLowerCase();
    await addMember({ name: `${TAG} typed`, email, handicap: 18.2, handicapType: "18" });
    const m = await prisma.member.findFirst({ where: { organizationId: orgId, email } });
    expect(m).toMatchObject({ handicap: 18.2, handicapSource: "manual" });
  });
});

describe("a club that plays off GHIN", () => {
  beforeAll(() => {
    link.live = true;
  });
  afterAll(() => {
    link.live = false;
  });

  it("can add a member with no figure — the form's empty box is not an index typed by hand", async () => {
    session.eventId = ghinEventId;
    const email = `${TAG}.g1@example.invalid`.toLowerCase();
    const res = await addMember({ name: `${TAG} g1`, email, ghin: "1234567", handicapType: "18" });
    expect(res.ok, res.ok ? "" : String(res.error)).toBe(true);
    const m = await prisma.member.findFirst({ where: { organizationId: ghinOrgId, email } });
    expect(m).toMatchObject({ handicapSource: "none", ghin: "1234567" });
    session.eventId = eventId;
  });

  it("refuses a figure typed on an edit, as it does on an add", async () => {
    session.eventId = ghinEventId;
    const m = await make(ghinOrgId, "g2", { handicap: 10.2, handicapSource: "ghin", ghin: "7654321" });
    const res = await updateMember(m.id, form(m, { ghin: "7654321", handicap: 4.0 }));
    expect(res.ok).toBe(false);
    expect(await read(m.id)).toMatchObject({ handicap: 10.2, handicapSource: "ghin" });
    // And still lets everything else about them be corrected.
    const ok = await updateMember(m.id, form(m, { ghin: "7654321", handicap: 10.2, phone: "555" }));
    expect(ok.ok).toBe(true);
    expect(await read(m.id)).toMatchObject({ phone: "555", handicap: 10.2, handicapSource: "ghin" });
    session.eventId = eventId;
  });
});
