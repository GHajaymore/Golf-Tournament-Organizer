import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A SOCIETY CANNOT CREATE ITS FIRST TOURNAMENT WHILE IT IS STILL CALLED AFTER
 * ITS SECRETARY.
 *
 * The name goes on every scorecard, the console header and the public
 * leaderboard, and it is set once for every tournament the outfit will ever
 * run. `CreateFirstTournament` disables its button, which is worth having and
 * proves nothing: a `"use server"` export is a public HTTP endpoint and will be
 * called with whatever the caller likes.
 *
 * So this drives the real `createEvent` against real rows, which is the only
 * place the question is settled. The three tests that matter are the ones
 * asserting it does NOT fire — a gate that stops somebody's actual golf is a
 * worse failure than the one it was built to prevent.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CLUBFIRST";
const SECRETARY = `${TAG}-secretary@example.invalid`.toLowerCase();
/** What the app would have derived, so `organizationWasNamed` reads false. */
const DERIVED = `${TAG} secretary`;

const session = { email: SECRETARY, name: DERIVED, eventId: "", role: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { createEvent } = await import("@/app/actions/tournament");

/**
 * Everything this file made, whatever it ended up called.
 *
 * TWO SWEEPS, and the order matters. The second is by OWNERSHIP, because this
 * file's subject is RENAMING an organization and a fixture the test under test
 * is expected to rename cannot be found again by the name it was given — ten
 * strays called "Bushwood Society" accumulated in the development database on
 * 2026-09-11 before that was noticed. Every name this file writes now carries
 * the mark, including the renamed one, so that sweep should find nothing; it
 * is the backstop for the next person who forgets.
 *
 * The first is BY THE MARK, and it is not redundant. The ownership walk starts
 * from the user row, so a run that dies after the user is deleted — or that
 * never created one — can find nothing that way. `audit-guards.test.ts`
 * requires this shape for exactly that reason, and it caught this file before
 * it was committed.
 */
async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });

  const user = await prisma.user.findUnique({ where: { email: SECRETARY }, select: { id: true } });
  if (user) {
    const owned = (
      await prisma.organizationMember.findMany({
        where: { userId: user.id },
        select: { organizationId: true },
      })
    ).map((m) => m.organizationId);
    await prisma.event.deleteMany({ where: { organizationId: { in: owned } } });
    await prisma.organization.deleteMany({ where: { id: { in: owned } } });
  }
  await prisma.user.deleteMany({ where: { email: SECRETARY } });
}

/**
 * One organization owned by the secretary, replacing whatever the last test
 * left. `unnamed` gives it exactly the name sign-up would have derived.
 */
async function outfit(kind: string, unnamed: boolean) {
  await scrub();
  const user = await prisma.user.upsert({
    where: { email: SECRETARY },
    update: {},
    create: { email: SECRETARY, name: DERIVED },
    select: { id: true },
  });
  const org = await prisma.organization.create({
    data: { name: unnamed ? DERIVED : `${TAG} Bushwood Society`, kind },
    select: { id: true },
  });
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: user.id, role: "owner" },
  });
  return org.id;
}

/** Tournaments that actually landed in this organization. */
const eventsIn = (organizationId: string) => prisma.event.count({ where: { organizationId } });

beforeAll(scrub);
afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a brand-new outfit that has not named itself", () => {
  it("is refused, and told what to do and where", async () => {
    const orgId = await outfit("community", true);
    const res = await createEvent(`${TAG} spring meeting`, "custom", "single");

    expect(res.ok, "created a tournament for an unnamed society").toBe(false);
    // The refusal says the thing that makes it worth obeying — that this is a
    // one-time decision with a long reach — and names the screen.
    expect(res.ok ? "" : res.error).toMatch(/society/i);
    expect(res.ok ? "" : res.error).toContain("Society settings");
    expect(await eventsIn(orgId), "nothing was created").toBe(0);
  });

  it("calls a golf club a club", async () => {
    await outfit("club", true);
    const res = await createEvent(`${TAG} club medal`, "custom", "single");
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.error).toContain("Club settings");
  });

  it("and is let straight through once it answers in the same breath", async () => {
    /**
     * THE REASON THIS IS A REQUIRED FIELD AND NOT A REDIRECT. The picker's
     * "Who's running this?" answer is passed as `orgName`, and
     * `organizationForNewEvent` names the organization with it on the way
     * through — so by the time the gate reads the row it is named, and nobody
     * is sent to another screen and back to do the thing they just did.
     */
    const orgId = await outfit("community", true);
    /**
     * MARKED, because this one is a RENAME. The name typed here replaces the
     * derived one, so an unmarked "Bushwood Society" would be an organization
     * `scrub` no longer recognises — ten of them accumulated in the
     * development database on 2026-09-11 before this was noticed, which is
     * exactly the "a fixture left in the database is a fixture someone will
     * later mistake for real" that the house rule is about.
     */
    const res = await createEvent(`${TAG} spring meeting`, "custom", "single", `${TAG} Bushwood Society`);
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    expect(await eventsIn(orgId)).toBe(1);
    expect(
      (await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }))?.name,
    ).toBe(`${TAG} Bushwood Society`);
  });
});

describe("who is never stopped", () => {
  it("never a society that already runs tournaments", async () => {
    /**
     * THE ASSERTION THAT KEEPS THIS SAFE FOR EVERY EXISTING CUSTOMER. One
     * tournament is enough to prove an outfit is a going concern, and a gate
     * that stopped one mid-season to collect a field it had skipped would be
     * the app interrupting real golf to tidy its own records.
     *
     * Note the organization here is STILL unnamed — so this is not passing
     * because the name got filled in somewhere. It is the event count alone.
     */
    const orgId = await outfit("community", false);
    // Last year's meeting, made the way a real one is — so this is a genuine
    // going concern rather than a row assembled to look like one.
    expect((await createEvent(`${TAG} last year's meeting`, "custom", "single")).ok).toBe(true);
    // And now put the name back to the derived one, which is the state an
    // outfit that never named itself is actually in.
    await prisma.organization.update({ where: { id: orgId }, data: { name: DERIVED } });

    const res = await createEvent(`${TAG} this year's meeting`, "custom", "single");
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    expect(await eventsIn(orgId), "the new one landed beside the old").toBe(2);
  });

  it("never somebody running a one-off outing with friends", async () => {
    /**
     * The escape hatch, and it is not a new one: "A one-off outing with
     * friends" is a real answer at sign-up and `kind = "personal"` is what it
     * writes. There is no club to set up, so there is nothing to require.
     *
     * It is also the kind a LAZILY created organization gets — the schema
     * default — so this is the path anybody who never answered the sign-up
     * question is on, and they must not be stopped by a question they were
     * never asked.
     */
    const orgId = await outfit("personal", true);
    const res = await createEvent(`${TAG} saturday fourball`, "custom", "single");
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    expect(await eventsIn(orgId)).toBe(1);
  });

  it("never a society that named itself earlier, on Society settings", async () => {
    const orgId = await outfit("community", false);
    const res = await createEvent(`${TAG} spring meeting`, "custom", "single");
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    expect(await eventsIn(orgId)).toBe(1);
  });
});
