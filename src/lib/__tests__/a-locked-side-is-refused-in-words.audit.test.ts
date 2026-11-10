import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A LOCKED SIDE IS REFUSED IN WORDS, NEVER THROWN (state machine PR 5a; J10).
 *
 * The ten lock sites in `actions/teams.ts` and `actions/setup-suggest.ts` THREW
 * "Configuration is locked" (`assertUnlocked`), and a throw inside a transition
 * is "This screen didn't load" — in production Next blanks the message anyway.
 * Each is pressed here on a LAUNCHED tournament, as the organizer would from a
 * Teams & pairs or Rounds & formats screen opened before the launch, and must
 * come back `{ ok: false }` with the machine's reason and way out, the lock it
 * came from, and nothing written.
 *
 * The control: unlocked on the day, the same press goes through — so the
 * refusals are the lock, not something else refusing everything.
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
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: <T,>(fn: T) => fn }));

import { createSession, setActiveEvent } from "@/lib/auth";
import {
  createTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  generateTeamMatches,
  autoDrawTeams,
  setStageAllowance,
  setStageCountBest,
  setStageAllowanceWeights,
} from "@/app/actions/teams";
import { applySetupProposal } from "@/app/actions/setup-suggest";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SM5A";

let eventId = "";
let fourBall = "";
let greensomes = "";
let teamId = "";
let memberId = "";
let reserveId = "";

beforeAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });

  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} invitational`,
      organizationId: org.id,
      // LAUNCHED, and setup not unlocked: the state a press from a stale screen meets.
      status: "live",
      launchedAt: new Date(),
      configUnlocked: false,
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
  fourBall = (
    await prisma.stage.create({
      data: { eventId, position: 0, type: "Stroke Play Round", format: "Four-Ball", holes: 18 },
      select: { id: true },
    })
  ).id;
  greensomes = (
    await prisma.stage.create({
      data: { eventId, position: 1, type: "Stroke Play Round", format: "Greensomes", holes: 18 },
      select: { id: true },
    })
  ).id;
  teamId = (await prisma.team.create({ data: { eventId, stageId: fourBall, name: `${TAG} pair`, seed: 1 }, select: { id: true } })).id;

  let seed = 0;
  const player = async (name: string) =>
    (
      await prisma.player.create({
        data: { eventId, name: `${TAG} ${name}`, email: `${TAG.toLowerCase()}-${name}@example.invalid`, seed: (seed += 1), status: "confirmed", handicap: 10 },
        select: { id: true },
      })
    ).id;
  memberId = await player("member");
  reserveId = await player("reserve");
  await prisma.teamMember.create({ data: { teamId, playerId: memberId, position: 0 } });

  const user = await prisma.user.create({
    data: { email: `${TAG.toLowerCase()}-admin@example.invalid`, name: `${TAG} Admin`, password: "x:unusable", emailVerifiedAt: new Date() },
    select: { id: true },
  });
  await prisma.account.create({
    data: { eventId, name: `${TAG} Admin`, email: `${TAG.toLowerCase()}-admin@example.invalid`, role: "admin" },
  });
  await createSession(user.id);
  await setActiveEvent(eventId);
});

afterAll(async () => {
  try {
    await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  } finally {
    await prisma.$disconnect();
  }
});

/** Everything a refused press could have written. */
async function snapshot() {
  const [teams, members, matches, stages] = await Promise.all([
    prisma.team.findMany({ where: { eventId }, select: { id: true, name: true }, orderBy: { id: "asc" } }),
    prisma.teamMember.findMany({ where: { team: { eventId } }, select: { teamId: true, playerId: true }, orderBy: { playerId: "asc" } }),
    prisma.match.count({ where: { eventId } }),
    prisma.stage.findMany({
      where: { eventId },
      select: { id: true, handicapAllowance: true, countBest: true, allowanceWeights: true },
      orderBy: { position: "asc" },
    }),
  ]);
  return { teams, members, matches, stages };
}

const LIVE = (what: string) => `Locked because the tournament is live. Make a committee correction to ${what}.`;

const PRESSES: { name: string; scope: string; what: string; press: () => Promise<{ ok: boolean; error?: string; lock?: { scope: string } }> }[] = [
  { name: "createTeam", scope: "sides", what: "change teams", press: () => createTeam(`${TAG} new side`, fourBall) },
  { name: "deleteTeam", scope: "sides", what: "change teams", press: () => deleteTeam(teamId) },
  { name: "addTeamMember", scope: "sides", what: "change teams", press: () => addTeamMember(teamId, reserveId) },
  { name: "removeTeamMember", scope: "sides", what: "change teams", press: () => removeTeamMember(teamId, memberId) },
  { name: "generateTeamMatches", scope: "sides", what: "change teams", press: () => generateTeamMatches(fourBall) },
  { name: "autoDrawTeams", scope: "sides", what: "change teams", press: () => autoDrawTeams(fourBall, true) },
  // The allowance and the split left this list in J12 PR 7b: they ask the rounds rule (below).
  { name: "setStageCountBest", scope: "rounds", what: "change how many scores count", press: () => setStageCountBest(fourBall, 2, true) },
];

/** The described tournament's rounds — refused ONLY once completed since PR 5b (TD ruling on 5a, Q2). */
const describeRounds = () => applySetupProposal([{ type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross", description: "" }]);

describe("on a launched tournament, every structural press on sides and rounds is refused in words", () => {
  for (const p of PRESSES) {
    it(`${p.name}: returned, not thrown — the machine's reason and way out, its lock, nothing written`, async () => {
      const before = await snapshot();
      const res = await p.press();
      expect(res).toEqual({ ok: false, error: LIVE(p.what), lock: expect.objectContaining({ scope: p.scope, by: "launch", correctable: true }) });
      expect(await snapshot(), `${p.name} wrote while refused`).toEqual(before);
    });
  }

  /**
   * THE ALLOWANCE AND THE SPLIT ARE THE ROUNDS RULE'S (J12, state machine PR 7b):
   * launch invalidates neither, so on a launched round with no cards they are
   * taken — and once the tournament is completed they are refused with Reopen.
   */
  it("the allowance and the split are not refused by launch on a round with no cards (the rounds rule)", async () => {
    expect(await setStageAllowance(fourBall, 100, true)).toEqual({ ok: true });
    expect(await setStageAllowanceWeights(greensomes, [50, 50], true)).toEqual({ ok: true });
  });

  it("a completed tournament's refusal names Reopen, the way out a completed one has — and only then are rounds refused to the described tournament", async () => {
    await prisma.event.update({ where: { id: eventId }, data: { status: "completed" } });
    try {
      const res = await createTeam(`${TAG} late side`, fourBall);
      expect(res).toMatchObject({ ok: false, error: "Locked because the tournament is completed. Reopen it on the dashboard to change teams." });
      const before = await snapshot();
      expect(await describeRounds()).toEqual({
        ok: false,
        error: "Locked because the tournament is completed. Reopen it on the dashboard to add a round.",
        lock: expect.objectContaining({ scope: "rounds", by: "completed", correctable: false }),
      });
      expect(await snapshot(), "a completed tournament took a described round").toEqual(before);
    } finally {
      await prisma.event.update({ where: { id: eventId }, data: { status: "live" } });
    }
  });

  it("LIVE, the described tournament's rounds go in — a live league adds next week's as it goes (TD ruling on 5a)", async () => {
    const before = await prisma.stage.count({ where: { eventId } });
    const res = await describeRounds();
    expect(res).toMatchObject({ ok: true });
    expect(await prisma.stage.count({ where: { eventId } })).toBe(before + 1);
    await prisma.stage.deleteMany({ where: { eventId, position: { gt: 1 } } });
  });

  it("THE CONTROL: unlocked on the day, the same presses go through", async () => {
    await prisma.event.update({ where: { id: eventId }, data: { configUnlocked: true } });
    try {
      expect(await createTeam(`${TAG} spare`, fourBall)).toEqual({ ok: true });
      expect(await addTeamMember(teamId, reserveId)).toEqual({ ok: true });
      expect(await setStageCountBest(fourBall, 2, true)).toEqual({ ok: true });
      expect((await prisma.stage.findUniqueOrThrow({ where: { id: fourBall } })).countBest).toBe(2);
    } finally {
      await prisma.event.update({ where: { id: eventId }, data: { configUnlocked: false } });
    }
  });
});
