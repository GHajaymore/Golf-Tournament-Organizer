import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A CLUB IS SET UP BEFORE ITS FIRST TOURNAMENT, NOT ALONGSIDE IT.
 *
 * A club is set up ONCE and its tournaments are MANY, so the club's answers —
 * its name, who its members are — are the ground every tournament stands on.
 * The setup checklist presented "Create your first tournament" as an equal
 * fifth row, live beside three unanswered club questions, which invited
 * exactly the order that produces a tournament called after its secretary with
 * an empty roster. Raised on 2026-09-11 from the screen itself.
 *
 * `CreateFirstTournament` disables its button, which is worth having and
 * proves nothing: a `"use server"` export is a public HTTP endpoint and will
 * be called with whatever the caller likes. So this drives the real
 * `createEvent` against real rows, which is the only place the question is
 * settled.
 *
 * THE TESTS THAT MATTER ARE THE ONES ASSERTING IT DOES NOT FIRE — an existing
 * club, a one-off outing with friends, a convenience step. A gate that stops
 * somebody's actual golf is a worse failure than the one it was built to
 * prevent.
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
 * file's subject includes RENAMING an organization and a fixture the test
 * under test is expected to rename cannot be found again by the name it was
 * given — ten strays called "Bushwood Society" accumulated in the development
 * database on 2026-09-11 before that was noticed. Every name this file writes
 * now carries the mark, including the renamed one, so that sweep should find
 * nothing; it is the backstop for the next person who forgets.
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
 * left. `unnamed` gives it exactly the name sign-up would have derived;
 * `members` is how many are on its roster.
 */
async function outfit(kind: string, opts: { unnamed?: boolean; members?: number } = {}) {
  const { unnamed = true, members = 0 } = opts;
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
  for (let i = 0; i < members; i++) {
    await prisma.member.create({
      data: {
        organizationId: org.id,
        name: `${TAG} Member ${i + 1}`,
        email: `${TAG}-member-${i + 1}@example.invalid`.toLowerCase(),
      },
    });
  }
  return org.id;
}

/** Tournaments that actually landed in this organization. */
const eventsIn = (organizationId: string) => prisma.event.count({ where: { organizationId } });
const errorOf = (r: { ok: boolean; error?: string }) => (r.ok ? "" : (r.error ?? ""));

beforeAll(scrub);
afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a brand-new outfit that has not set itself up", () => {
  it("is refused, and told which answers are outstanding", async () => {
    const orgId = await outfit("community");
    const res = await createEvent(`${TAG} spring meeting`, "custom", "single");

    expect(res.ok, "created a tournament for an unset-up society").toBe(false);
    /**
     * NAMES THE STEPS, rather than saying "finish your setup first". Two or
     * three club answers can be outstanding at once, and a refusal that does
     * not say which leaves somebody hunting — which is the same fault as a
     * disabled control with no reason.
     */
    expect(errorOf(res)).toContain("name your society");
    expect(errorOf(res)).toContain("add your members");
    expect(await eventsIn(orgId), "nothing was created").toBe(0);
  });

  it("calls a golf club a club", async () => {
    await outfit("club");
    expect(errorOf(await createEvent(`${TAG} club medal`, "custom", "single"))).toContain("your club");
  });

  it("still refuses when only the members are missing", async () => {
    /**
     * The half that cannot be answered on the picker. Naming the club is a
     * field on the create form — see the next test — but the member list has
     * its own screen, so this is the case where the organizer really is sent
     * somewhere before coming back.
     */
    const orgId = await outfit("community", { unnamed: false });
    const res = await createEvent(`${TAG} spring meeting`, "custom", "single");
    expect(res.ok).toBe(false);
    expect(errorOf(res)).toContain("add your members");
    expect(errorOf(res), "does not ask for a name it already has").not.toContain("name your society");
    expect(await eventsIn(orgId)).toBe(0);
  });

  it("lets the name be answered in the same breath", async () => {
    /**
     * THE REASON THE NAME IS A REQUIRED FIELD AND NOT A REDIRECT. The picker's
     * "Who's running this?" answer is passed as `orgName`, and
     * `organizationForNewEvent` names the organization with it on the way
     * through — so by the time the gate reads the row it is named, and nobody
     * is sent to another screen and back to do the thing they just did.
     *
     * MARKED, because this one is a RENAME and an unmarked name is one `scrub`
     * no longer recognises.
     */
    const orgId = await outfit("community", { members: 4 });
    const res = await createEvent(`${TAG} spring meeting`, "custom", "single", `${TAG} Bushwood Society`);
    expect(res.ok, errorOf(res)).toBe(true);
    expect(await eventsIn(orgId)).toBe(1);
    expect(
      (await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }))?.name,
    ).toBe(`${TAG} Bushwood Society`);
  });
});

describe("who is never stopped", () => {
  it("never an outfit that already runs tournaments", async () => {
    /**
     * THE ASSERTION THAT KEEPS THIS SAFE FOR EVERY EXISTING CUSTOMER. One
     * tournament is enough to prove an outfit is a going concern, and a gate
     * that stopped one mid-season to collect a field it had skipped would be
     * the app interrupting real golf to tidy its own records.
     *
     * The organization is put back to UNSET-UP afterwards — derived name, no
     * members — so this cannot be passing because the setup got done. It is
     * the event count alone.
     */
    const orgId = await outfit("community", { unnamed: false, members: 2 });
    expect((await createEvent(`${TAG} last year's meeting`, "custom", "single")).ok).toBe(true);
    await prisma.organization.update({ where: { id: orgId }, data: { name: DERIVED } });
    await prisma.member.deleteMany({ where: { organizationId: orgId } });

    const res = await createEvent(`${TAG} this year's meeting`, "custom", "single");
    expect(res.ok, errorOf(res)).toBe(true);
    expect(await eventsIn(orgId), "the new one landed beside the old").toBe(2);
  });

  it("never somebody running a one-off outing with friends", async () => {
    /**
     * THE STANDALONE ESCAPE, and it is derived rather than a `kind ===
     * "personal"` special case. A personal organizer has no shared roster, so
     * no members step exists for them; their name step is already done,
     * because nobody else ever sees the organization's name; and money is not
     * a prerequisite. Nothing required is outstanding, so nothing is asked.
     *
     * It is also the kind a LAZILY created organization gets — the schema
     * default — so this is the path anybody who never answered the sign-up
     * question is on, and they must not be stopped by a question they were
     * never asked.
     */
    const orgId = await outfit("personal");
    const res = await createEvent(`${TAG} saturday fourball`, "custom", "single");
    expect(res.ok, errorOf(res)).toBe(true);
    expect(await eventsIn(orgId)).toBe(1);
  });

  it("never over a course card or a money setting", async () => {
    /**
     * NEITHER IS A PREREQUISITE, and both are real steps on the checklist. A
     * tournament carries its own pars and stroke index, and `resolveMoneyMode`
     * is event → club → kind, so a tournament answers the money question for
     * itself. Gating on a convenience is how a gate stops being believed.
     *
     * A club, deliberately: it is the kind that gets a course step at all.
     */
    const orgId = await outfit("club", { unnamed: false, members: 1 });
    const res = await createEvent(`${TAG} club medal`, "custom", "single");
    expect(res.ok, errorOf(res)).toBe(true);
    expect(await eventsIn(orgId)).toBe(1);
  });
});
