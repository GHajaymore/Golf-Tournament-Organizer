import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { roundMoneyFor } from "@/lib/services/expenses";

/**
 * A TEAM round is finished when the TEAM's cards are in.
 *
 * The fourth instance of one defect, and the first on the screen the PLAYER
 * looks at. A round's scores live in three tables — `Scorecard` for a stroke
 * round, `MatchScorecard` for a match played on full gross cards,
 * `TeamScorecard` for a team round — and every money reader that asked
 * `prisma.scorecard` alone was silently asking what the stroke players did.
 *
 * Skins was fixed for match play and four-balls on 2026-09-08. The derived
 * pots were fixed on 2026-09-09, which is when `roundStrokes` was written to
 * be the one reader all of them share — see `derived-pot-cards.audit.test.ts`,
 * whose whole point is that the next pot written cannot inherit the bug.
 *
 * `roundMoneyFor` was not converted. It still read `prisma.scorecard` directly
 * and handed the result to `roundMoneyFinality`, so on a four-ball it counted
 * ZERO holes returned on a round every side had finished.
 *
 * WHAT THAT LOOKED LIKE, and why nothing caught it: not a wrong number, an
 * unfinished one. The round stays not-final, so `gameNets` correctly declines
 * to settle and the player is shown their EXPOSURE instead — the screen for a
 * round still being played, on a round that is over. `/me/money` reported
 * "0 of 18 holes in" under a completed four-ball, and went on doing so until
 * somebody closed the whole tournament, which is the one other thing that
 * makes a round final.
 *
 * An empty money screen reads as "nothing to report" rather than as a fault,
 * which is the same reason the match-play version of this survived — see the
 * note at the top of `round-finality.audit.test.ts`.
 *
 * THE STROKE CASE IS THE CONTROL. This is money code, and what makes the
 * change safe is that the new source only ever FILLS A GAP: an ordinary stroke
 * round must read exactly as it always did.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-team-money-final";

const FULL_CARD = JSON.stringify(new Array(18).fill(4));

interface Round {
  eventId: string;
  stageId: string;
  email: string;
}


/**
 * A finished round of `format`, with both players' cards written to whichever
 * table `write` says — the one axis this file is about.
 */
async function finishedRound(
  label: string,
  format: string,
  write: (r: { eventId: string; stageId: string; ids: string[] }) => Promise<void>,
): Promise<Round> {
  const org = await prisma.organization.create({
    data: { name: `${TAG}-${label}`, kind: "club" },
    select: { id: true },
  });

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG}-${label}-ev`,
      // NOT "completed": a closed tournament makes every round final on its
      // own, which would settle this whether the cards were read or not.
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      // Unique per run: both carry a unique index, so a fixed value would make
      // the second run of this file fail on the fixture rather than the rule.
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
    },
    select: { id: true },
  });

  const stage = await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 0,
      type: "Stroke Play Round",
      format,
      holes: 18,
      scoringBasis: "gross",
      handicapAllowance: 100,
    },
    select: { id: true },
  });

  const ids: string[] = [];
  let mine = "";
  for (let i = 0; i < 2; i += 1) {
    const address = `${TAG}-${label}-p${i}@example.invalid`;
    if (i === 0) mine = address;
    const p = await prisma.player.create({
      data: {
        eventId: event.id,
        name: `${TAG} P${i}`,
        email: address,
        handicap: 8 + i * 6,
        seed: i + 1,
        status: "confirmed",
      },
      select: { id: true },
    });
    ids.push(p.id);
  }

  await write({ eventId: event.id, stageId: stage.id, ids });
  return { eventId: event.id, stageId: stage.id, email: mine };
}

async function roundRow(r: Round) {
  const view = await roundMoneyFor(r.eventId, r.email);
  const row = view.rounds.find((x) => x.stageId === r.stageId);
  expect(row, "the round is missing from the player's money screen").toBeTruthy();
  return row!;
}

/**
 * COLLECTED BY THE MARK, not by ids held in a variable.
 *
 * `audit-guards.test.ts` enforces this and caught the first version of this
 * file, which tracked org ids in an array. The reason is the one that matters
 * here: a run that DIES before its teardown — killed, or failing in
 * `beforeAll` — takes the variable with it and leaves a club in the
 * development database forever. Deleting by the mark collects those too, so
 * the next run cleans up after the last one.
 */
afterAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } }).catch(() => {});
  await prisma.$disconnect();
});

let fourBall: Round;
let stroke: Round;

beforeAll(async () => {
  fourBall = await finishedRound("fourball", "Four-Ball", async ({ eventId, stageId, ids }) => {
    /**
     * `TeamScorecard` carries its own `playerId` — a four-ball is two cards a
     * side, one per player, which is what makes each card a thing a person
     * returned rather than a side's single ball.
     */
    const team = await prisma.team.create({
      data: { eventId, stageId, name: `${TAG} pair`, seed: 1 },
      select: { id: true },
    });
    for (const [i, playerId] of ids.entries()) {
      await prisma.teamMember.create({ data: { teamId: team.id, playerId, position: i } });
      await prisma.teamScorecard.create({
        data: { eventId, stageId, teamId: team.id, playerId, strokes: FULL_CARD },
      });
    }
  });

  stroke = await finishedRound("stroke", "Stroke Play", async ({ eventId, stageId, ids }) => {
    for (const playerId of ids) {
      await prisma.scorecard.create({
        data: { eventId, stageId, playerId, strokes: FULL_CARD },
      });
    }
  });
});

describe("a finished four-ball, on the player's own money screen", () => {
  it("counts the holes the side actually returned", async () => {
    const row = await roundRow(fourBall);
    expect(
      row.holesReturned,
      "eighteen holes are in TeamScorecard; the screen said none were played",
    ).toBe(18);
  });

  it("reads as finished, so the player is not shown an exposure for it", async () => {
    const row = await roundRow(fourBall);
    expect(row.final, "a four-ball every side has finished is a finished round").toBe(true);
  });
});

describe("an ordinary stroke round", () => {
  it("still reads exactly as it always did", async () => {
    // The control. If this breaks, the change did more than fill a gap — and
    // without it every assertion above is satisfied by a reader that returns
    // eighteen for anything at all.
    const row = await roundRow(stroke);
    expect(row.holesReturned).toBe(18);
    expect(row.final).toBe(true);
  });
});
