import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState, standingRows } from "../services/tournament";
import { isManualFormat, boardKind } from "../formats";
import { meFor } from "../services/me";

/**
 * A hand-scored round is not ranked, on any screen, including the player's own.
 *
 * "Other (scored by hand)" exists so a club can run a Flag day or its own
 * invention in this app: the round, the field and the tee sheet are kept here
 * and the committee works out the result. `isManualFormat` is the only thing
 * standing between it and a scoring engine, and CLAUDE.md names it as the
 * example of the wrong shape — "a guard you must remember to call is a guard
 * that will be forgotten".
 *
 * It was forgotten. Six of the seven callers of `standingRows` asked
 * `boardKind` or `usesStandardBoard` first; `services/me.ts` did not. So the
 * leaderboard rendered a ManualRoundBoard and the PLAYER'S own screen showed
 * them a rank, a "T2" and a to-par for a round the app refuses to score. The
 * comment above that call said it used the same standingRows as the leaderboard
 * "never a second calculation, which is how two screens come to disagree about
 * who is winning" — and for this format the leaderboard never reaches
 * standingRows at all, so that is precisely what happened. The screen
 * contradicting the organizer was the one the player looks at.
 *
 * Real rows, because the bug lives in the seam between a stage's format and
 * what a service does with the cards under it.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-MANUAL";
const MANUAL_FORMAT = "Other (scored by hand)";

const PARS = new Array(18).fill(4);
/** Two clearly different cards, so any ranking at all would order them. */
const LOW = new Array(18).fill(3);
const HIGH = new Array(18).fill(5);

let eventId = "";
let stageId = "";
const player: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} flag day`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      format: "stroke",
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  eventId = event.id;

  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: MANUAL_FORMAT, holes: 18 },
  });
  stageId = stage.id;

  // Cards ARE returned. That is the whole difficulty: the app holds a manual
  // round's scores, so anything that adds them up will happily produce a
  // confident, wrong answer.
  for (const [i, [who, card]] of ([["low", LOW], ["high", HIGH]] as const).entries()) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: `${TAG}.${who}@example.invalid`.toLowerCase(),
        seed: i + 1,
        status: "confirmed",
        handicap: 0,
      },
    });
    player[who] = p.id;
    await prisma.scorecard.create({
      data: { eventId, stageId: stage.id, playerId: p.id, strokes: JSON.stringify(card) },
    });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the fixture really is a manual round with real cards", () => {
  it("uses a format the app refuses to score", () => {
    // If this stopped being true every assertion below would pass for the
    // wrong reason.
    expect(isManualFormat(MANUAL_FORMAT)).toBe(true);
    expect(boardKind(MANUAL_FORMAT)).toBe("manual");
  });

  it("has two cards that any ranking would separate", async () => {
    const cards = await prisma.scorecard.count({ where: { stageId } });
    expect(cards).toBe(2);
    expect(LOW.reduce((a, b) => a + b, 0)).toBeLessThan(HIGH.reduce((a, b) => a + b, 0));
  });
});

describe("standingRows refuses a hand-scored round", () => {
  it("returns nothing to rank", async () => {
    /**
     * At the sink rather than in each caller. Every existing caller already
     * avoids reaching here for a manual round, so this changes none of them;
     * what it changes is that a caller written LATER is correct without
     * knowing the rule exists.
     */
    const state = await loadEventState(eventId);
    expect(state).not.toBeNull();
    expect(standingRows(state!)).toEqual([]);
  });
});

describe("the player's own screen agrees with the leaderboard", () => {
  const emailFor = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

  it("shows no standing for a hand-scored round", async () => {
    /**
     * The regression. This returned a rank, a position label and a to-par —
     * the leaderboard showed a ManualRoundBoard for the same round, so the two
     * screens contradicted each other and the player's was the confident one.
     */
    const state = await loadEventState(eventId);
    const mine = await meFor(state!, emailFor("low"));
    expect(mine.standing).toBeNull();
  });

  it("still tells them which round it is", async () => {
    // Refusing to RANK is not refusing to show. The round, the field and the
    // tee sheet are exactly what this format keeps in the app.
    const state = await loadEventState(eventId);
    const mine = await meFor(state!, emailFor("low"));
    // Asserted separately: a null round would make the stageId check vacuous,
    // and "the player sees nothing at all" is a different bug from the one
    // being fixed.
    expect(mine.round).not.toBeNull();
    expect(mine.round!.stageId).toBe(stageId);
    expect(mine.name).toContain("low");
  });

  it("gives the same answer for the player who scored better", async () => {
    // No accidental ordering survives: neither card is ranked, not merely the
    // one that happened to be looked at first.
    const state = await loadEventState(eventId);
    const better = await meFor(state!, emailFor("low"));
    const worse = await meFor(state!, emailFor("high"));
    expect(better.standing).toBeNull();
    expect(worse.standing).toBeNull();
  });
});
