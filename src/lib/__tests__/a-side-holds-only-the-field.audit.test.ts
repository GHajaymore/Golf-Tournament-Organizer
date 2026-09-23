import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A SIDE HOLDS ONLY PEOPLE WHO ARE IN THE FIELD.
 *
 * The substitute, which is the commonest last-minute change a club makes: a
 * player pulls out on the morning, `removeSignup` marks them `withdrawn` and
 * promotes the earliest reserve, and the committee puts the reserve into the
 * vacated side.
 *
 * `addTeamMember` checked that the player belonged to the EVENT and nothing
 * else. So a still WAITLISTED reserve, or somebody who had already withdrawn,
 * could be put into a side — and would then be scored, counted towards the
 * side's size and printed on its card while not being in the field at all.
 *
 * `unassignedPlayers` offers confirmed players and nothing else, so the screen
 * never presented this. That is exactly why the rule belongs on the ACTION: a
 * `"use server"` export is a public HTTP endpoint and will be called with
 * whatever the caller likes, which CLAUDE.md records as the reason payloads are
 * validated at the boundary rather than trusted from the UI that usually calls
 * them.
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

import { createSession, setActiveEvent } from "@/lib/auth";
import { addTeamMember } from "@/app/actions/teams";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SIDEFIELD";

let eventId = "";
let teamId = "";
const player: Record<string, string> = {};

beforeAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });

  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} invitational`,
      organizationId: org.id,
      status: "active",
      /**
       * The state a committee is actually in when it substitutes. Teams are a
       * structural change, so a LAUNCHED tournament refuses them until the
       * organizer unlocks — `configurationLocked` is `isLaunched && !unlocked`
       * — which is the deliberate step that stops a mid-round accident. This
       * test is about who may be added once they have taken it.
       */
      configUnlocked: true,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-share`,
    },
    select: { id: true },
  });
  eventId = ev.id;
  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Four-Ball", holes: 18 },
    select: { id: true },
  });
  const team = await prisma.team.create({
    data: { eventId, stageId: stage.id, name: `${TAG} pair`, seed: 1 },
    select: { id: true },
  });
  teamId = team.id;

  // One of each state a club actually has on the morning.
  let seed = 0;
  for (const status of ["confirmed", "waitlisted", "withdrawn"]) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${status}`,
        email: `${TAG.toLowerCase()}-${status}@example.invalid`,
        seed: (seed += 1),
        status,
        handicap: 10,
      },
      select: { id: true },
    });
    player[status] = p.id;
  }

  const user = await prisma.user.create({
    data: {
      email: `${TAG.toLowerCase()}-admin@example.invalid`,
      name: `${TAG} Admin`,
      password: "x:unusable",
    },
    select: { id: true },
  });
  await prisma.account.create({
    data: {
      eventId,
      name: `${TAG} Admin`,
      email: `${TAG.toLowerCase()}-admin@example.invalid`,
      role: "admin",
    },
  });
  await createSession(user.id);
  await setActiveEvent(eventId);
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.$disconnect();
});

const membersOf = () => prisma.teamMember.count({ where: { teamId } });

describe("only somebody in the field may be put into a side", () => {
  it("THE CONTROL: a confirmed player goes in", async () => {
    // Without this the refusals below would pass on an action that refuses
    // everybody, which would break the substitute rather than guard it.
    const res = await addTeamMember(teamId, player.confirmed);
    expect(res.ok).toBe(true);
    expect(await membersOf()).toBe(1);
  });

  it("refuses a reserve who has not been promoted, and says what to do", async () => {
    const before = await membersOf();
    const res = await addTeamMember(teamId, player.waitlisted);
    expect(res.ok).toBe(false);
    expect(res.ok === false ? res.error : "").toMatch(/not in the field yet/i);
    // The refusal is the point: nothing was written.
    expect(await membersOf()).toBe(before);
  });

  it("refuses somebody who has already withdrawn", async () => {
    const before = await membersOf();
    const res = await addTeamMember(teamId, player.withdrawn);
    expect(res.ok).toBe(false);
    expect(res.ok === false ? res.error : "").toMatch(/withdrawn/i);
    expect(await membersOf()).toBe(before);
  });

  it("names the player, so a committee knows which one", async () => {
    // Two sides being re-drawn at once is the state this is read in, and
    // "Player is not in the field" would not say whom to promote.
    const res = await addTeamMember(teamId, player.waitlisted);
    expect(res.ok === false ? res.error : "").toContain(`${TAG} waitlisted`);
  });
});
