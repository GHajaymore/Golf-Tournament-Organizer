import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * Two places that looked up the wrong id.
 *
 * From the 2026-08-27 exploratory audit.
 *
 * `confirmMatch` decided "did you play in this" from the individual player
 * columns alone. A TEAM match names two sides and leaves those columns
 * deliberately empty — `teams.ts` says so where it writes them — so the check
 * asked `id: { in: ["", ""] }`, found nobody, and told a player they could only
 * confirm a match they played in, about a match they had just played. Peer
 * confirmation was impossible for every four-ball and foursomes round in a
 * tournament whose own setting said players confirm.
 *
 * `deleteEvent` re-signed the session cookie with an ACCOUNT id where
 * `createSession` takes a USER id. The two are independent cuids, so the next
 * request looked the id up, found no User, and signed the organizer out —
 * deleting one tournament dropped them at the sign-in page.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
// deleteEvent ends in a redirect, which throws in Next. Caught at the call
// site so the assertions can look at what it did before leaving.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { createSession, setActiveEvent, getSession } from "@/lib/auth";
import { confirmMatch, deleteEvent } from "@/app/actions/tournament";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-TEAMCONFIRM";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

let orgId = "";
let eventId = "";
let stageId = "";
let matchId = "";
const player: Record<string, string> = {};
const userIds: Record<string, string> = {};

async function signIn(who: string, event = eventId) {
  jar.clear();
  await createSession(userIds[who]);
  await setActiveEvent(event);
}

/** deleteEvent always ends in a redirect; report where it went. */
async function deleteAndFollow(id: string): Promise<string> {
  try {
    await deleteEvent(id);
    return "(no redirect)";
  } catch (e) {
    const m = /NEXT_REDIRECT:(.*)/.exec(e instanceof Error ? e.message : "");
    return m ? m[1] : `(threw: ${e instanceof Error ? e.message : String(e)})`;
  }
}

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;

  for (const who of ["ann", "rob", "boss", "owner"]) {
    const u = await prisma.user.create({ data: { email: at(who), name: who, password: "x" } });
    userIds[who] = u.id;
  }
});

beforeEach(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });

  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} member-guest`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${Math.round(performance.now() * 1000)}`,
      // The setting whose whole promise is that PLAYERS confirm.
      scoreApproval: "players",
    },
  });
  eventId = event.id;

  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Round Robin", format: "Four-Ball", holes: 18 },
  });
  stageId = stage.id;
  const group = await prisma.group.create({
    data: { eventId, name: `${TAG} flight`, position: 0 },
  });

  for (const [i, who] of ["ann", "rob"].entries()) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: at(who), seed: i + 1, status: "confirmed" },
    });
    player[who] = p.id;
    await prisma.account.create({ data: { eventId, email: at(who), name: who, role: "player" } });
  }
  await prisma.account.create({ data: { eventId, email: at("boss"), name: "boss", role: "admin" } });

  const [sideA, sideB] = await Promise.all([
    prisma.team.create({ data: { eventId, name: `${TAG} A`, seed: 1, stageId } }),
    prisma.team.create({ data: { eventId, name: `${TAG} B`, seed: 2, stageId } }),
  ]);
  await prisma.teamMember.createMany({
    data: [
      { teamId: sideA.id, playerId: player.ann, position: 0 },
      { teamId: sideB.id, playerId: player.rob, position: 0 },
    ],
  });

  const match = await prisma.match.create({
    data: {
      eventId,
      stageId,
      groupId: group.id,
      round: 1,
      // Exactly as teams.ts writes them: the sides are teams, so these stay empty.
      playerAId: "",
      playerBId: "",
      teamAId: sideA.id,
      teamBId: sideB.id,
      holes: JSON.stringify(new Array(18).fill("A")),
      scoreStatus: "pending",
    },
  });
  matchId = match.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("confirming a team match you played in", () => {
  it("is allowed, where it used to be impossible", async () => {
    await signIn("ann");
    await expect(confirmMatch(matchId)).resolves.toBeUndefined();
  });

  it("actually moves the row, not just the screen", async () => {
    /**
     * The entry screen marks the row confirmed before awaiting and the throw
     * was swallowed inside `startTransition`, so it SAID confirmed while the
     * row stayed pending. The row is what the committee reads.
     */
    await signIn("ann");
    await confirmMatch(matchId);
    const row = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(row.scoreStatus).toBe("confirmed");
  });

  it("still refuses somebody who was not in it", async () => {
    // The guard has to keep guarding: peer review is only of your own match.
    const outsider = await prisma.player.create({
      data: { eventId, name: `${TAG} stranger`, email: at("owner"), seed: 9, status: "confirmed" },
    });
    await prisma.account.create({ data: { eventId, email: at("owner"), name: "owner", role: "player" } });
    await signIn("owner");
    await expect(confirmMatch(matchId)).rejects.toThrow(/only confirm a match you played in/i);
    const row = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(row.scoreStatus).toBe("pending");
    await prisma.player.delete({ where: { id: outsider.id } });
  });

  it("still lets an individual match be confirmed by its own player", async () => {
    // The path that always worked must go on working.
    const solo = await prisma.match.create({
      data: {
        eventId,
        stageId,
        groupId: (await prisma.group.findFirstOrThrow({ where: { eventId } })).id,
        round: 2,
        playerAId: player.ann,
        playerBId: player.rob,
        holes: JSON.stringify(new Array(18).fill("A")),
        scoreStatus: "pending",
      },
    });
    await signIn("rob");
    await expect(confirmMatch(solo.id)).resolves.toBeUndefined();
  });
});

describe("deleting a tournament", () => {
  it("leaves the organizer signed in", async () => {
    /**
     * It re-signed the cookie with an Account id where a User id belongs, so
     * the next request found no User and returned null — the organizer was
     * dropped at the sign-in page for deleting one of their tournaments.
     */
    const other = await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} survivor`,
        dates: "",
        course: "Home",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-surv-${Math.round(performance.now() * 1000)}`,
      },
    });
    await prisma.account.create({
      data: { eventId: other.id, email: at("boss"), name: "boss", role: "admin" },
    });

    await signIn("boss");
    const to = await deleteAndFollow(eventId);

    expect(to).toBe("/dashboard");
    const after = await getSession();
    expect(after, "the organizer must still be signed in").toBeTruthy();
    expect(after?.email).toBe(at("boss"));
  });

  it("lands them on a tournament that still exists", async () => {
    const other = await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} survivor two`,
        dates: "",
        course: "Home",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-surv2-${Math.round(performance.now() * 1000)}`,
      },
    });
    await prisma.account.create({
      data: { eventId: other.id, email: at("boss"), name: "boss", role: "admin" },
    });

    await signIn("boss");
    await deleteAndFollow(eventId);
    const after = await getSession();
    expect(after?.eventId).toBe(other.id);
  });

  it("keeps a CLUB OWNER signed in, who holds no Account rows at all", async () => {
    /**
     * Access can come from the organization instead of the event, which is
     * what this action's own permission check relies on. The anchor lookup
     * asked only for Accounts, found none, and took the destroySession branch:
     * an owner deleting one of ten club events was signed out while nine
     * remained.
     */
    await prisma.organizationMember.create({
      data: { organizationId: orgId, userId: userIds.owner, role: "owner" },
    });
    const other = await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} club event`,
        dates: "",
        course: "Home",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-club-${Math.round(performance.now() * 1000)}`,
      },
    });

    jar.clear();
    await createSession(userIds.owner);
    await setActiveEvent(eventId);
    const to = await deleteAndFollow(eventId);

    expect(to).toBe("/dashboard");
    const after = await getSession();
    expect(after, "an owner with nine events left must stay signed in").toBeTruthy();
    expect(after?.eventId).toBe(other.id);

    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
  });
});
