import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A DISQUALIFIED PLAYER HAS LEFT THE FIELD, FOR EVERY READER THAT ASKS
 * (sweep 1, b15, 2026-10-10).
 *
 * Disqualification was added on 2026-10-08 as a second way out of the field,
 * and `hasLeftTheField` says so in one place. But a dozen readers had been
 * written when "withdrawn" was the only way out, and each spelled the
 * question as `status === "withdrawn"` or `status: { not: "withdrawn" }` —
 * which a disqualified player answers the wrong way round:
 *
 *   a side's handicap    still priced off a partner who has been disqualified,
 *                        with no "substitute or play short" warning
 *   splitting a cost     refused a disqualified player's share — "isn't in
 *                        this tournament" — though the money screen lists them
 *                        and they can still owe for a cart already hired
 *   round codes          counted them as an entrant who would be locked out
 *   adding to a side     "is not in the field yet. Confirm their place first."
 *
 * Each case here is asked of a WITHDRAWN player as well, and the two must
 * answer alike: that is the rule, and it is also the control — the withdrawn
 * half has worked since it was written.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-DQLEFT";
const EMAIL = `${TAG}.sec@example.invalid`.toLowerCase();
const session = { email: EMAIL, name: `${TAG} secretary`, eventId: "", role: "admin", viewRole: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { teamsForStage, teamProblems } = await import("@/lib/services/teams");
const { addTeamMember } = await import("@/app/actions/teams");
const { addExpense } = await import("@/app/actions/expenses");
const { strandedEntrantCount } = await import("@/lib/services/round-codes");

let orgId = "";
let made = 0;

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/**
 * A foursomes pair — a 4 and a 24 — whose higher handicap has `left` by the
 * given route, beside a pair still whole, and one spare player in the field.
 */
async function tournament(left: "withdrawn" | "disqualified" | "confirmed") {
  const event = await prisma.event.create({
    data: {
      organizationId: orgId, name: `${TAG} ${left}`, dates: "", course: "", city: "", address: "", regDeadline: "",
      shareToken: `${TAG}-${left}-${process.pid}-${++made}`, format: "stroke", moneyMode: "split", configUnlocked: true, playerAccess: "code",
    },
  });
  session.eventId = event.id;
  await prisma.account.create({ data: { eventId: event.id, email: EMAIL, name: `${TAG} secretary`, role: "admin" } });
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Foursomes", holes: 18, scoringBasis: "net" },
  });
  // No email on anybody: a tournament signing in by round code.
  const player = (name: string, handicap: number, status: string, seed: number) =>
    prisma.player.create({ data: { eventId: event.id, name: `${TAG} ${name}`, email: "", handicap, seed, status } });
  const low = await player("low", 4, "confirmed", 1);
  const high = await player("high", 24, left, 2);
  const spare = await player("spare", 12, "confirmed", 3);
  const team = await prisma.team.create({ data: { eventId: event.id, stageId: stage.id, name: `${TAG} pair`, seed: 0 } });
  await prisma.teamMember.createMany({
    data: [
      { teamId: team.id, playerId: low.id, position: 0 },
      { teamId: team.id, playerId: high.id, position: 1 },
    ],
  });
  const other = await prisma.team.create({ data: { eventId: event.id, stageId: stage.id, name: `${TAG} other`, seed: 1 } });
  const [side] = (await teamsForStage(event.id, stage.id, "Foursomes")).filter((t) => t.id === team.id);
  return { eventId: event.id, stageId: stage.id, low, high, spare, side, otherTeamId: other.id };
}

beforeAll(async () => {
  await scrub();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } })).id;
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a side whose partner has been disqualified", () => {
  it("is priced off who is still playing — as it is when the partner withdraws", async () => {
    const whole = await tournament("confirmed");
    const withdrawn = await tournament("withdrawn");
    const disqualified = await tournament("disqualified");
    expect(whole.side.playingHandicap, "CONTROL: the fixture cannot tell a pair from half of one").not.toBe(withdrawn.side.playingHandicap);
    expect(disqualified.side.playingHandicap).toBe(withdrawn.side.playingHandicap);
  });

  it("is reported to the committee, by name and by what happened", async () => {
    const disqualified = await tournament("disqualified");
    const problems = teamProblems([disqualified.side], "Foursomes").map((p) => p.problem);
    expect(problems.join(" | ")).toMatch(/high has been disqualified/);
    expect(problems.join(" | "), "a pair reduced to one still read as a complete pair").toMatch(/1 of 2 players/);
  });

  it("cannot be joined by the disqualified player, and the refusal says why", async () => {
    const t = await tournament("disqualified");
    const res = await addTeamMember(t.otherTeamId, t.high.id);
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.error).toMatch(/disqualified/);
  });
});

describe("a cost already spent", () => {
  for (const left of ["withdrawn", "disqualified"] as const) {
    it(`can still be shared with a player who has since been ${left}`, async () => {
      const t = await tournament(left);
      const res = await addExpense({
        description: "Buggy hire", amountCents: 3000, paidBy: t.low.id,
        shares: [{ playerId: t.low.id, weight: 1 }, { playerId: t.high.id, weight: 1 }],
      });
      expect(res.ok, res.ok ? "" : String(res.error)).toBe(true);
      const shares = await prisma.expenseShare.count({ where: { expense: { eventId: t.eventId }, playerId: t.high.id } });
      expect(shares).toBe(1);
    });

    it(`but "everyone, evenly" does not charge a player who has been ${left}`, async () => {
      // Omitting the shares means everyone PLAYING — the rule the money screen
      // states — and somebody who has left is not.
      const t = await tournament(left);
      const res = await addExpense({ description: "Range balls", amountCents: 2000, paidBy: t.low.id });
      expect(res.ok, res.ok ? "" : String(res.error)).toBe(true);
      const charged = await prisma.expenseShare.findMany({ where: { expense: { eventId: t.eventId } }, select: { playerId: true } });
      expect(charged.map((s) => s.playerId).sort()).toEqual([t.low.id, t.spare.id].sort());
    });
  }
});

describe("who would be locked out if round codes were switched off", () => {
  it("does not count a disqualified player, any more than a withdrawn one", async () => {
    const whole = await tournament("confirmed");
    const withdrawn = await tournament("withdrawn");
    const disqualified = await tournament("disqualified");
    expect(await strandedEntrantCount(whole.eventId), "CONTROL: all three have no email").toBe(3);
    expect(await strandedEntrantCount(withdrawn.eventId)).toBe(2);
    expect(await strandedEntrantCount(disqualified.eventId)).toBe(2);
  });
});
