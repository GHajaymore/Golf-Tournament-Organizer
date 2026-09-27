import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

const session = { email: "", name: "", id: "" };
vi.mock("@/lib/auth", () => ({
  getSession: async () => (session.email ? { ...session } : null),
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));
// The promoted player is told by email; nothing leaves the test.
vi.mock("@/lib/services/field-notify", () => ({ notifyFieldChange: async () => {} }));

import { withdrawMyEntry } from "@/app/actions/enter";

/**
 * A MEMBER TAKES THEIR OWN NAME OFF, UNTIL ENTRIES CLOSE (Ajay, 2026-09-26).
 *
 * `withdrawMyEntry` is the organizer's `removeSignup` for the member's own
 * entry, so what is asserted is that it does what that does — and nothing the
 * caller could stretch it into:
 *
 *   - a confirmed place freed in a FULL field goes to the waiting list, and the
 *     member's tournament sign-in goes with their entry;
 *   - a member who has PLAYED is kept as `withdrawn`, their card intact —
 *     a delete there loses a result, whichever door it came through;
 *   - after entries close, nothing moves: the organizer makes changes then;
 *   - only THEIR OWN row, in a tournament they can reach.
 *
 * Five calls, from a fresh address: the limiter allows six an hour per email
 * and is shared with Enter (see `a-member-enters-in-one-tap.audit.test.ts`).
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-withdraw-self";
const WHO = `${TAG}-${randomBytes(4).toString("hex")}`;

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

async function tournament(orgId: string, name: string, extra: Record<string, unknown> = {}) {
  return (
    await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} ${name}`,
        status: "registration",
        shape: "single",
        format: "stroke",
        formationRule: "balanced",
        dates: "",
        course: `${TAG} Course`,
        city: `${TAG} Town`,
        address: "",
        regDeadline: "",
        capacity: 40,
        registrationOpen: true,
        registrationApproval: "auto",
        registrationToken: randomBytes(6).toString("hex"),
        shareToken: randomBytes(10).toString("hex"),
        ...extra,
      },
      select: { id: true },
    })
  ).id;
}

const entrant = (eventId: string, email: string, seed: number, status: string) =>
  prisma.player.create({
    data: { eventId, name: `${TAG} ${email.split("@")[0]}`, email, handicap: 10, seed, status },
    select: { id: true },
  });

let me = "";
let full = "";
let played = "";
let closed = "";
let othersOnly = "";
let otherClub = "";
let waiterId = "";
let playedRowId = "";
let closedRowId = "";
let neighbourId = "";

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} home`, kind: "club" }, select: { id: true } });
  const away = await prisma.organization.create({ data: { name: `${TAG} away`, kind: "club" }, select: { id: true } });
  const user = await prisma.user.create({
    data: { email: `${WHO}@example.invalid`, name: `${TAG} Member` },
    select: { id: true, email: true, name: true },
  });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "member" } });
  session.email = me = user.email;
  session.name = user.name;
  session.id = user.id;

  // FULL: one place, mine, and somebody queuing for it.
  full = await tournament(org.id, "full", { capacity: 1 });
  await entrant(full, me, 1, "confirmed");
  waiterId = (await entrant(full, `${TAG}-waiter@example.invalid`, 2, "waitlisted")).id;
  await prisma.account.create({ data: { eventId: full, email: me.toLowerCase(), name: "me", role: "player" } });

  // PLAYED: I have a card in, so a delete would lose a result.
  played = await tournament(org.id, "played");
  playedRowId = (await entrant(played, me, 1, "confirmed")).id;
  const stage = await prisma.stage.create({
    data: { eventId: played, position: 0, type: "Stroke Play Round", format: "Stroke Play" },
    select: { id: true },
  });
  await prisma.scorecard.create({
    data: { eventId: played, stageId: stage.id, playerId: playedRowId, strokes: JSON.stringify([4, 5, 3]) },
  });

  // CLOSED: the deadline has passed.
  closed = await tournament(org.id, "closed", { regDeadline: "2020-01-01" });
  closedRowId = (await entrant(closed, me, 1, "confirmed")).id;

  // SOMEBODY ELSE'S ENTRY in a tournament I can see but am not in.
  othersOnly = await tournament(org.id, "not mine");
  neighbourId = (await entrant(othersOnly, `${TAG}-neighbour@example.invalid`, 1, "confirmed")).id;

  // Another club entirely.
  otherClub = await tournament(away.id, "another club");
  await entrant(otherClub, me, 1, "confirmed");
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a member withdrawing while entries are open", () => {
  it("frees a full field's place for the waiting list, and takes their sign-in with it", async () => {
    const res = await withdrawMyEntry(full);
    expect(res).toEqual({ ok: true });

    expect(await prisma.player.count({ where: { eventId: full, email: me } }), "their entry is still there").toBe(0);
    const waiter = await prisma.player.findUnique({ where: { id: waiterId }, select: { status: true } });
    expect(waiter!.status, "the next person on the waiting list was not promoted").toBe("confirmed");
    expect(
      await prisma.account.count({ where: { eventId: full, email: me.toLowerCase(), role: "player" } }),
      "their tournament sign-in outlived their entry",
    ).toBe(0);

    // And the organizer can see who did it.
    const line = await prisma.auditLog.findFirst({ where: { eventId: full, action: "withdrawn" } });
    expect(line?.detail).toContain("withdrew their own entry");
  });

  it("keeps a member who has played as withdrawn, with their card, rather than deleting them", async () => {
    const res = await withdrawMyEntry(played);
    expect(res).toEqual({ ok: true });

    const row = await prisma.player.findUnique({ where: { id: playedRowId }, select: { status: true } });
    expect(row, "a player with a card in was DELETED").toBeTruthy();
    expect(row!.status).toBe("withdrawn");
    expect(await prisma.scorecard.count({ where: { eventId: played, playerId: playedRowId } })).toBe(1);
  });
});

describe("what it will not do", () => {
  it("moves nothing once entries have closed", async () => {
    const res = await withdrawMyEntry(closed);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/organizer/);
    const row = await prisma.player.findUnique({ where: { id: closedRowId }, select: { status: true } });
    expect(row!.status, "a closed tournament lost an entry").toBe("confirmed");
  });

  it("touches nobody else's entry", async () => {
    /**
     * The rows are found by the SESSION's email, never by an id the caller
     * gives — so a member cannot remove a neighbour by naming their tournament.
     */
    const res = await withdrawMyEntry(othersOnly);
    expect(res.ok).toBe(false);
    const row = await prisma.player.findUnique({ where: { id: neighbourId }, select: { status: true } });
    expect(row, "someone else's entry was removed").toBeTruthy();
    expect(row!.status).toBe("confirmed");
  });

  it("refuses a tournament belonging to a club they are not in", async () => {
    const res = await withdrawMyEntry(otherClub);
    expect(res.ok).toBe(false);
    expect(await prisma.player.count({ where: { eventId: otherClub, email: me } })).toBe(1);
  });

  it("refuses when nobody is signed in (the control on the whole file)", async () => {
    const held = session.email;
    session.email = "";
    try {
      const res = await withdrawMyEntry(othersOnly);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("Sign in");
    } finally {
      session.email = held;
    }
  });
});
