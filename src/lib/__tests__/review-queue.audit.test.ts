import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "@/lib/services/tournament";

/**
 * THE REVIEW QUEUE, READ THROUGH THE SERVICE THAT FILLS IT.
 *
 * `domain/review-queue.ts` owns the rule and is tested purely. What a pure
 * test cannot see is the half that was actually wrong for a year: the SERVICE
 * handed it the wrong rows. `pendingConfirmations` filtered `rrMatches` — the
 * ACTIVE STAGE's matches — so a stroke round's certified cards were invisible
 * and a round the organizer had moved past took its unreviewed work with it.
 *
 * A correct rule fed the wrong rows passes every unit test there is.
 *
 * Three fixtures, and each is built so a wrong answer looks DIFFERENT rather
 * than merely wrong: the match count and the card count are never equal, and
 * the round holding the cards is never the round holding the matches.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-REVIEWQUEUE";

let bothSources = "";
let strokeOnly = "";
let playersConfirm = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function makeEvent(name: string, scoreApproval: string) {
  const org = await prisma.organization.create({
    data: { name: `${TAG} ${name}`, kind: "club" },
    select: { id: true },
  });
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} ${name}`,
      organizationId: org.id,
      shape: "series",
      format: "match",
      status: "active",
      scoreApproval,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}`,
    },
    select: { id: true },
  });
  const group = await prisma.group.create({
    data: { eventId: ev.id, name: `${TAG} g`, position: 0 },
    select: { id: true },
  });
  const players = [];
  for (let i = 0; i < 6; i += 1) {
    players.push(
      await prisma.player.create({
        data: {
          eventId: ev.id,
          groupId: group.id,
          name: `${TAG} P${i + 1}`,
          email: `${TAG}-${name}-${i}@example.invalid`.toLowerCase(),
          seed: i + 1,
          status: "confirmed",
          handicap: 0,
        },
        select: { id: true },
      }),
    );
  }
  return { eventId: ev.id, groupId: group.id, players };
}

const stage = (eventId: string, position: number, description: string, type: string, format: string) =>
  prisma.stage.create({
    data: { eventId, position, description, type, format, scoringBasis: "gross", holes: 18 },
    select: { id: true },
  });

/** A match played out to a result, so `resolveMatch` calls it complete. */
const DECIDED = JSON.stringify(new Array(18).fill("A"));
/** A match with five holes on it — live, and not a result anybody can sign. */
const LIVE = JSON.stringify(["A", "B", "A", "H", "A", ...new Array(13).fill(null)]);

beforeAll(async () => {
  await scrub();

  /**
   * WEEK 1 a match night, WEEK 2 a medal. Two decided-but-unsigned matches on
   * week 1, five certified cards on week 2, and a live match on week 1 that
   * belongs to nobody's queue.
   *
   * Two and five, never two and two — and on DIFFERENT rounds, which is the
   * whole point: whichever round the service thinks is active, it has to count
   * both.
   */
  {
    const { eventId, groupId, players } = await makeEvent("both-sources", "staff");
    bothSources = eventId;
    const w1 = await stage(eventId, 0, "Week 1", "Round Robin", "Match Play");
    const w2 = await stage(eventId, 1, "Week 2", "Stroke Play Round", "Stroke Play");
    for (const [a, b, holes] of [
      [0, 1, DECIDED],
      [2, 3, DECIDED],
      [4, 5, LIVE],
    ] as const) {
      await prisma.match.create({
        data: {
          eventId,
          stageId: w1.id,
          groupId,
          round: 1,
          playerAId: players[a].id,
          playerBId: players[b].id,
          holes,
        },
      });
    }
    for (const [i, p] of players.slice(0, 5).entries()) {
      await prisma.scorecard.create({
        data: {
          eventId,
          stageId: w2.id,
          playerId: p.id,
          strokes: JSON.stringify(new Array(18).fill(4)),
          status: "certified",
          certifiedBy: `${TAG}-marker-${i}@example.invalid`,
        },
      });
    }
    // And one already accepted, so "count every card" is not the answer either.
    await prisma.scorecard.create({
      data: {
        eventId,
        stageId: w2.id,
        playerId: players[5].id,
        strokes: JSON.stringify(new Array(18).fill(4)),
        status: "approved",
        approvedBy: `${TAG}-committee@example.invalid`,
      },
    });
  }

  /**
   * A PURE MEDAL — no `Match` row anywhere in it. The old rule could only ever
   * return zero here whatever was waiting, which is the defect in its plainest
   * form.
   */
  {
    const { eventId, players } = await makeEvent("stroke-only", "staff");
    strokeOnly = eventId;
    const r1 = await stage(eventId, 0, "Round 1", "Stroke Play Round", "Stroke Play");
    for (const [i, p] of players.entries()) {
      await prisma.scorecard.create({
        data: {
          eventId,
          stageId: r1.id,
          playerId: p.id,
          // Four certified, two still with their markers. Unequal on purpose.
          status: i < 4 ? "certified" : "entered",
          strokes: JSON.stringify(new Array(18).fill(4)),
          certifiedBy: i < 4 ? `${TAG}-marker-${i}@example.invalid` : "",
        },
      });
    }
  }

  /**
   * THE SAME CARDS, IN A TOURNAMENT WITH NO COMMITTEE. `scoreApproval` is
   * "players", so `allowsAutoConfirm` is true and nothing ever moves a
   * scorecard past certified — `card-approval.ts` says so in its own words.
   * Those cards are finished, not queued.
   */
  {
    const { eventId, players } = await makeEvent("players-confirm", "players");
    playersConfirm = eventId;
    const r1 = await stage(eventId, 0, "Round 1", "Stroke Play Round", "Stroke Play");
    for (const [i, p] of players.entries()) {
      await prisma.scorecard.create({
        data: {
          eventId,
          stageId: r1.id,
          playerId: p.id,
          status: "certified",
          strokes: JSON.stringify(new Array(18).fill(4)),
          certifiedBy: `${TAG}-marker-${i}@example.invalid`,
        },
      });
    }
  }
});

afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

describe("what the dashboard says is waiting", () => {
  it("counts the matches and the cards, from different rounds", async () => {
    const state = (await loadEventState(bothSources))!;
    expect(state.reviewing.matches, "the live match was counted, or a decided one missed").toBe(2);
    expect(state.reviewing.cards, "the approved card was counted, or the certified ones missed").toBe(5);
    expect(state.pendingConfirmations).toBe(7);
  });

  it("does not lose the cards to whichever round it thinks is active", async () => {
    /**
     * THE ASSERTION THAT PINS THE FIX. The old rule scoped to `activeStage`;
     * the cards are on week 2 and the matches on week 1, so ANY single-round
     * scope drops one of the two — and the fixture is built so dropping either
     * changes the number.
     */
    const state = (await loadEventState(bothSources))!;
    expect(state.reviewing.matches).toBeGreaterThan(0);
    expect(state.reviewing.cards).toBeGreaterThan(0);
  });

  it("sees a medal's queue, which it could not before", async () => {
    // No Match rows exist, so the old answer was structurally zero.
    const state = (await loadEventState(strokeOnly))!;
    expect(state.reviewing.matches).toBe(0);
    expect(state.reviewing.cards, "a card still with its marker was counted").toBe(4);
    expect(state.pendingConfirmations).toBe(4);
  });

  it("asks for nothing where there is no committee to ask", async () => {
    /**
     * The control that stops this becoming "count every certified card".
     * Identical rows to the medal above, one event setting different, and the
     * queue must be empty — otherwise every casual round in the app grows a
     * permanent backlog of work nobody can do.
     */
    const state = (await loadEventState(playersConfirm))!;
    expect(state.reviewing.cards).toBe(0);
    expect(state.pendingConfirmations).toBe(0);
  });
});
