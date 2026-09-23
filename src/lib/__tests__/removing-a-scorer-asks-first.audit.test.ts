import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * TAKING SOMEBODY OUT OF A SIDE THEY HAVE SCORED FOR ASKS FIRST.
 *
 * `TeamScorecard` is keyed by team and player, not by membership, so deleting
 * the `TeamMember` row leaves the card behind — and `aggregateTeamCard` maps
 * over the MEMBERS, so it is simply no longer read. The side's score changes
 * and nothing says so. The same shape as the `BracketWinner` case: a
 * destructive action that discards a result in silence.
 *
 * WARN RATHER THAN REFUSE, on Ajay's call of 2026-09-23. A committee
 * re-drawing mid-round usually has a reason, and refusing outright makes them
 * delete a card to get at the membership — worse than the thing prevented.
 *
 * BOTH HALVES ARE ASSERTED, and the second is the one a refusal would fail:
 * the question is asked, and saying yes GOES THROUGH. A test that only
 * checked the warning would pass on an implementation that had quietly become
 * a refusal, which is the option Ajay did not pick.
 *
 * And the control: a member with no card is removed without a question, so
 * the warning is not simply always on.
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
import { removeTeamMember } from "@/app/actions/teams";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-REMOVE";

let eventId = "";
let teamId = "";
let scorer = "";
let bystander = "";

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
      name: `${TAG} four-ball`,
      organizationId: org.id,
      status: "live",
      // Teams are a structural change, so a launched tournament refuses them
      // until the organizer unlocks. This is the state a committee re-drawing
      // a side is actually in.
      configUnlocked: true,
      shape: "single",
      format: "stroke",
      sideStyle: "teams",
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
    data: {
      eventId,
      position: 0,
      description: "Four-ball",
      type: "Stroke Play Round",
      format: "Four-Ball",
      holes: 18,
    },
    select: { id: true },
  });

  const team = await prisma.team.create({
    data: { eventId, stageId: stage.id, name: `${TAG} pair`, seed: 1 },
    select: { id: true },
  });
  teamId = team.id;

  for (const who of ["scorer", "bystander"]) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: `${TAG.toLowerCase()}-${who}@example.invalid`,
        seed: who === "scorer" ? 1 : 2,
        status: "confirmed",
        handicap: 10,
      },
      select: { id: true },
    });
    if (who === "scorer") scorer = p.id;
    else bystander = p.id;
    await prisma.teamMember.create({ data: { teamId, playerId: p.id } });
  }

  // Only one of them has returned a card.
  await prisma.teamScorecard.create({
    data: {
      eventId,
      stageId: stage.id,
      teamId,
      playerId: scorer,
      strokes: JSON.stringify(new Array(18).fill(4)),
    },
  });

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

const isMember = (playerId: string) =>
  prisma.teamMember.count({ where: { teamId, playerId } }).then((n) => n > 0);

describe("removing somebody who has scored asks first", () => {
  it("asks, and does not remove them while it is asking", async () => {
    const res = await removeTeamMember(teamId, scorer);
    expect(res.ok).toBe(false);
    expect(res.needsConfirm, "went ahead without asking").toBe(true);
    expect(res.cards, "the count is the question the organizer is answering").toBe(1);
    expect(await isMember(scorer), "removed them while asking the question").toBe(true);
  });

  it("goes through once the organizer says yes — it is a warning, not a refusal", async () => {
    const res = await removeTeamMember(teamId, scorer, true);
    expect(res.ok, "a confirmed removal was still refused").toBe(true);
    expect(await isMember(scorer)).toBe(false);

    // The card survives, which is the thing the warning is about: it stops
    // counting rather than being deleted, so nothing is lost and a committee
    // can put them back.
    const cards = await prisma.teamScorecard.count({ where: { teamId, playerId: scorer } });
    expect(cards, "the card was destroyed rather than orphaned").toBe(1);
  });

  it("does not ask about somebody who has returned nothing", async () => {
    // THE CONTROL. Without it the cells above pass on an implementation that
    // asks every time, which would train an organizer to click through the
    // one that matters.
    const res = await removeTeamMember(teamId, bystander);
    expect(res.needsConfirm, "asked about a player with no card").toBeFalsy();
    expect(res.ok).toBe(true);
    expect(await isMember(bystander)).toBe(false);
  });
});
