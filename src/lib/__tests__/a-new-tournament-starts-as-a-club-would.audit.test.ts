import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE DEFAULTS A NEW TOURNAMENT STARTS WITH (Ajay, 2026-09-28, left to my
 * recommendation):
 *
 *   - flights by handicap for stroke and Stableford — Division A the lowest;
 *   - one bracket for a knockout;
 *   - Round Codes when the list an organizer hands over has no addresses.
 *
 * And the halves that make a default safe to have: an organizer's own choice
 * is never overwritten, and drawn flights are never redrawn under anybody.
 * Driven through the real actions against real rows.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-DEFAULTS";
const EMAIL = "zz-audit-defaults@example.invalid";
const session = { email: EMAIL, name: `${TAG} organizer`, eventId: "", role: "admin", viewRole: "admin", userId: "", accountId: "" };

vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { createEvent, addStage, setStageFormat, importCsvSignups } = await import("@/app/actions/tournament");

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

/** Create a tournament and make it the session's one. */
async function make(name: string, template = "custom") {
  await createEvent(`${TAG} ${name}`, template, "single");
  const ev = await prisma.event.findFirst({ where: { name: `${TAG} ${name}` } });
  expect(ev, `${name} was created`).not.toBeNull();
  session.eventId = ev!.id;
  return ev!;
}
const rule = async (id: string) => (await prisma.event.findUnique({ where: { id } }))!.formationRule;

/**
 * An organizer whose club PREDATES the published terms (2026-09-29), as every
 * club in production does — so its Free plan limits nothing. Without this,
 * `createEvent` makes a new club on the terms, and its one-tournament-at-a-time
 * limit refuses this file's second tournament, which is a test of the limit
 * and not of the defaults.
 */
async function grandfatheredOrganizer() {
  const user = await prisma.user.create({ data: { email: EMAIL, name: session.name } });
  await prisma.organization.create({
    data: {
      name: `${TAG} organizer`,
      kind: "personal",
      subscription: { create: { plan: "free", planTermsApply: false } },
      members: { create: { userId: user.id, role: "owner" } },
    },
  });
}

beforeAll(async () => {
  await scrub();
  await grandfatheredOrganizer();
});
afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

describe("flights follow what the rounds are, until somebody chooses", () => {
  it("a medal template starts on handicap divisions, and in one bracket", async () => {
    const ev = await make("champs", "club-championship");
    expect(ev.bracketMode).toBe("single");
    expect(await rule(ev.id)).toBe("divisions");
  });

  it("a blank tournament moves to divisions when its first round is Stableford", async () => {
    const ev = await make("stableford");
    expect(await rule(ev.id), "no rounds yet").toBe("balanced");
    await addStage("Stroke Play Round", { format: "Stableford" });
    expect(await rule(ev.id)).toBe("divisions");
  });

  it("CONTROL: a match-play tournament keeps balanced flights", async () => {
    const ev = await make("matchplay");
    await addStage("Round Robin", { format: "Match Play" });
    expect(await rule(ev.id)).toBe("balanced");
  });

  it("follows a format change back to match play, because nobody chose divisions", async () => {
    const ev = await make("changes");
    await addStage("Stroke Play Round", { format: "Stroke Play" });
    expect(await rule(ev.id)).toBe("divisions");
    const stage = await prisma.stage.findFirst({ where: { eventId: ev.id } });
    await setStageFormat(stage!.id, "Four-Ball");
    expect(await rule(ev.id)).toBe("balanced");
  });

  it("never overwrites a rule the organizer chose", async () => {
    const ev = await make("chosen");
    // What `regenGroups` writes when an organizer picks a rule.
    await prisma.event.update({ where: { id: ev.id }, data: { formationRule: "seeding" } });
    await addStage("Stroke Play Round", { format: "Stroke Play" });
    expect(await rule(ev.id)).toBe("seeding");
  });

  it("never changes the rule under flights already drawn", async () => {
    const ev = await make("drawn");
    await prisma.group.create({ data: { eventId: ev.id, name: "A", position: 0 } });
    await addStage("Stroke Play Round", { format: "Stroke Play" });
    expect(await rule(ev.id)).toBe("balanced");
  });
});

describe("how the tournament is decided follows its first round, when that round has no opponents", () => {
  const decided = async (id: string) => (await prisma.event.findUnique({ where: { id } }))!.format;

  it("a blank tournament whose first round is a medal is decided on strokes", async () => {
    // Walked 2026-09-30: the column default (match) survived the first stroke
    // round, and the next screen said the rounds "cannot be scored as set".
    const ev = await make("first-medal");
    expect(await decided(ev.id), "the column default, which nobody chose").toBe("match");
    await addStage("Stroke Play Round", { format: "Stroke Play" });
    expect(await decided(ev.id)).toBe("stroke");
  });

  it("a Stableford first round too — it has no opponents either", async () => {
    const ev = await make("first-stableford");
    await addStage("Stroke Play Round", { format: "Stableford" });
    expect(await decided(ev.id)).toBe("stroke");
  });

  it("CONTROL: a head-to-head first round leaves the setting alone", async () => {
    const ev = await make("first-matches");
    await addStage("Round Robin", { format: "Match Play" });
    expect(await decided(ev.id)).toBe("match");
  });

  it("CONTROL: only the FIRST round decides — a later stroke round changes nothing", async () => {
    const ev = await make("later-medal");
    await addStage("Round Robin", { format: "Match Play" });
    await addStage("Stroke Play Round", { format: "Stroke Play" });
    expect(await decided(ev.id), "a match-play event with a medal round added later").toBe("match");
  });
});

describe("a names-only list turns Round Codes on instead of being refused", () => {
  it("switches an email-only tournament to email and codes, and imports everybody", async () => {
    const ev = await make("names-only");
    expect(ev.playerAccess).toBe("email");
    await addStage("Stroke Play Round", { format: "Stroke Play" });

    // Phone numbers from Ofcom's reserved drama range: nobody's real number.
    const r = await importCsvSignups(
      "name,handicap,phone\nzz-defaults Ann Example,10,07700 900001\nzz-defaults Ben Example,14,07700 900002\n",
    );
    expect(r.error).toBeUndefined();
    expect(r.imported).toBe(2);
    expect(r.codesTurnedOn).toBe(true);

    const after = await prisma.event.findUnique({ where: { id: ev.id }, select: { playerAccess: true } });
    expect(after!.playerAccess).toBe("both");
    // And the round has a code, or "Round Codes are on" would be a promise.
    const stage = await prisma.stage.findFirst({ where: { eventId: ev.id }, select: { accessCode: true } });
    expect(stage!.accessCode).not.toBe("");
  });

  it("CONTROL: a list with SOME addresses keeps email sign-in and skips the gaps", async () => {
    const ev = await make("gaps");
    const r = await importCsvSignups(
      "name,email,phone\nzz-defaults Cy Example,zz-defaults-cy@example.invalid,07700 900003\nzz-defaults Di Example,,07700 900004\n",
    );
    expect(r.codesTurnedOn).toBeUndefined();
    expect(r.imported).toBe(1);
    expect(r.skippedInvalid).toBe(1);
    const after = await prisma.event.findUnique({ where: { id: ev.id }, select: { playerAccess: true } });
    expect(after!.playerAccess).toBe("email");
  });
});
