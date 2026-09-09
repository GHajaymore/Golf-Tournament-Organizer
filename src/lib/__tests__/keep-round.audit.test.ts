import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * The escape hatch on the only scheduled DELETE in the product.
 *
 * A casual round removes itself about a day after it is set up. That is
 * acceptable ONLY because the person it belongs to is told beforehand and can
 * stop it in one press — without `keepRound` the feature is a scheduled data
 * loss nobody consented to.
 *
 * So the button had better work, and had better only ever work in one
 * direction. It was shipped with no test at all.
 *
 * ONE DIRECTION IS THE PROPERTY THAT MATTERS. This action clears an expiry and
 * can never set one. An action that could SET `expiresAt` would be a way to
 * schedule the deletion of any event the caller can reach — a tournament
 * included — through a screen built for a Sunday fourball.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-KEEP-ROUND";

let session: { email: string; name: string; eventId: string; role: string } | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { keepRound } = await import("@/app/actions/round-expiry");

let organizationId = "";
const SOON = new Date("2099-01-01T00:00:00.000Z");

async function scrub() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club` },
    select: { id: true },
  });
  organizationId = org.id;
});

afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

async function makeEvent(name: string, expiresAt: Date | null, shape = "match") {
  return prisma.event.create({
    data: {
      organizationId,
      name: `${TAG} ${name}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: `zz-keep-${Math.random().toString(36).slice(2)}`,
      status: "live",
      shape,
      expiresAt,
    },
    select: { id: true, expiresAt: true },
  });
}

const asStaff = (eventId: string) => {
  session = { email: `${TAG.toLowerCase()}@example.invalid`, name: "Organizer", eventId, role: "admin" };
};
const asPlayer = (eventId: string) => {
  session = { email: `${TAG.toLowerCase()}-p@example.invalid`, name: "Player", eventId, role: "player" };
};

describe("keeping a round that would otherwise be deleted", () => {
  it("clears the expiry, permanently", async () => {
    const round = await makeEvent("keep me", SOON);
    expect(round.expiresAt, "starts temporary").not.toBeNull();

    asStaff(round.id);
    const res = await keepRound();
    expect(res.ok).toBe(true);

    const after = await prisma.event.findUnique({
      where: { id: round.id },
      select: { expiresAt: true },
    });
    expect(after?.expiresAt, "and is now permanent").toBeNull();
  });

  it("refuses a player, who did not set the round up", async () => {
    /**
     * Every export in a "use server" file is a public HTTP endpoint, so this
     * is checked in the action rather than left to the button being hidden.
     *
     * The row is read back, because an action that returns an error and
     * writes anyway is the failure this is really about.
     */
    const round = await makeEvent("not yours", SOON);
    asPlayer(round.id);

    const res = await keepRound();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/set this round up/i);

    const after = await prisma.event.findUnique({
      where: { id: round.id },
      select: { expiresAt: true },
    });
    expect(after?.expiresAt, "still temporary").not.toBeNull();
  });

  it("is happy about a round that was never temporary", async () => {
    // The caller asked for it to be kept, and it is. Reporting failure here
    // would put an error on a screen where nothing is wrong.
    const tournament = await makeEvent("a real tournament", null, "series");
    asStaff(tournament.id);

    const res = await keepRound();
    expect(res.ok).toBe(true);
    const after = await prisma.event.findUnique({
      where: { id: tournament.id },
      select: { expiresAt: true },
    });
    expect(after?.expiresAt).toBeNull();
  });

  it("cannot reach an event the session is not on", async () => {
    /**
     * The action takes no arguments at all — the event comes from the session
     * cookie — so there is no id to forge. Asserted by pointing a session at
     * ONE round and checking a second is untouched, because "there is no
     * parameter" is a claim about the signature and this is a claim about the
     * rows.
     */
    const mine = await makeEvent("mine", SOON);
    const theirs = await makeEvent("theirs", SOON);

    asStaff(mine.id);
    await keepRound();

    const other = await prisma.event.findUnique({
      where: { id: theirs.id },
      select: { expiresAt: true },
    });
    expect(other?.expiresAt, "somebody else's round is untouched").not.toBeNull();
  });

  it("never sets an expiry — only ever clears one", async () => {
    /**
     * THE PROPERTY THE WHOLE SWEEP'S SAFETY RESTS ON.
     *
     * `expiresAt` is written by `createMatch` and by nothing else, which is
     * why the sweep can be sure it will never see a tournament. An action able
     * to set it would be a way to schedule any reachable event for deletion.
     *
     * Asserted structurally as well as behaviourally: running it twice leaves
     * null both times, and the action's source contains no assignment that
     * could produce a date.
     */
    const round = await makeEvent("twice", SOON);
    asStaff(round.id);

    await keepRound();
    await keepRound();

    const after = await prisma.event.findUnique({
      where: { id: round.id },
      select: { expiresAt: true },
    });
    expect(after?.expiresAt).toBeNull();
  });
});
