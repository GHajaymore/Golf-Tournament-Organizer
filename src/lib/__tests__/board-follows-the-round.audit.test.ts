import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "@/lib/services/tournament";
import { readSource } from "./source";

/**
 * THE BOARD DESCRIBES THE ROUND IN FRONT OF YOU, NOT THE EVENT AROUND IT.
 *
 * `loadEventState` sets `isStroke` from `event.format`, which is ONE value for
 * a whole tournament — and every round carries its own. `setStageFormat` sets a
 * round's on its own and never touches the event's, so the two disagree by
 * design.
 *
 * Four boards read it to decide whether to print a score or a win-loss-halved
 * record, and whether to head the column with strokes or "match points". So:
 *
 *   - a STROKE round in a MATCH event showed a player who had just shot 75 a
 *     row reading "0-0-0" under "Ranked by match points";
 *   - a MATCH round in a STROKE event tried to print strokes for a result that
 *     is "3&2" — and that is the second half of an ordinary club
 *     championship, qualifier then bracket, which is the commonest format
 *     there is.
 *
 * Found by walking the player app on 2026-09-11.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-BOARDROUND";

let strokeInMatch = "";
let matchInStroke = "";
let matchInMatch = "";
let strokeInStroke = "";
let qualifierOnly = "";
let noRounds = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** An event of `eventFormat` holding one round of `stageType`, or none. */
async function tournament(name: string, eventFormat: string, stageType?: string, stageFormat?: string) {
  const org = await prisma.organization.create({
    data: { name: `${TAG} ${name} club`, kind: "club" },
    select: { id: true },
  });
  const event = await prisma.event.create({
    data: {
      name: `${TAG} ${name}`,
      organizationId: org.id,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}`,
      format: eventFormat,
      status: "live",
    },
    select: { id: true },
  });
  if (stageType) {
    await prisma.stage.create({
      data: {
        eventId: event.id,
        position: 1,
        type: stageType,
        format: stageFormat ?? "Stroke Play",
        scoringBasis: "gross",
        holes: 18,
      },
    });
  }
  return event.id;
}

beforeAll(async () => {
  await scrub();
  // The second half of a club championship: a bracket inside an event whose
  // format says stroke, because the qualifier came first.
  matchInStroke = await tournament("qualifier-then-bracket", "stroke", "Bracket Stage", "Match Play");
  // And the reverse: a medal round inside a match-format event, which is a
  // league playing one stroke-play week.
  strokeInMatch = await tournament("league-medal-week", "match", "Stroke Play Round", "Stroke Play");
  // The two that already agreed, as controls.
  matchInMatch = await tournament("plain-league", "match", "Round Robin", "Match Play");
  strokeInStroke = await tournament("plain-medal", "stroke", "Stroke Play Round", "Stroke Play");
  // The one type that is not a PLAYING round, so `activeStage` is null and
  // only the `?? stages[0]` fallback finds it.
  qualifierOnly = await tournament("qualifier-only", "match", "Qualification Stage", "Stroke Play");
  noRounds = await tournament("nothing-set-up-yet", "stroke");
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

const stateOf = async (id: string) => {
  const s = await loadEventState(id);
  expect(s, "no state at all").toBeTruthy();
  return s!;
};

describe("when the round and the event disagree", () => {
  it("calls a stroke-play round stroke play, inside a match-format event", async () => {
    const state = await stateOf(strokeInMatch);
    expect(state.boardIsStroke, "a Stroke Play round presented as match play").toBe(true);
    // And the event's own answer is untouched — the two are different
    // questions and both still have answers.
    expect(state.isStroke, "the event's format was changed, not just read").toBe(false);
  });

  it("calls a match-play round match play, inside a stroke-format event", async () => {
    /**
     * THE ONE THAT MATTERS. A stroke-play qualifier into a match-play bracket
     * is the commonest championship format in golf, and the board for its
     * second half was trying to print strokes for a result that is "3&2".
     */
    const state = await stateOf(matchInStroke);
    expect(state.boardIsStroke, "a Match Play round presented as stroke play").toBe(false);
    expect(state.isStroke, "the event's format was changed, not just read").toBe(true);
  });
});

describe("when they agree, nothing moves", () => {
  it("leaves a plain medal alone", async () => {
    const state = await stateOf(strokeInStroke);
    expect(state.boardIsStroke).toBe(true);
    expect(state.isStroke).toBe(true);
  });

  it("leaves a plain league alone", async () => {
    /**
     * THE CONTROL THAT KEEPS THIS FROM BEING A BEHAVIOUR CHANGE FOR ANYBODY.
     * Almost every tournament in the product has rounds of one kind, and for
     * all of them the new answer must equal the old one — or this "fix" is a
     * regression wearing a bug report.
     */
    const state = await stateOf(matchInMatch);
    expect(state.boardIsStroke).toBe(false);
    expect(state.isStroke).toBe(false);
  });

  it("still finds a stage when the only one is not a round at all", async () => {
    /**
     * THE FALLBACK, AND IT IS NOT DEAD CODE — which is what a mutation
     * suggested before this case existed.
     *
     * A QUALIFICATION STAGE IS A CUT, NOT A ROUND. `leaderboard/page.tsx`,
     * `stages/page.tsx` and `round-label.ts` all say so in those words, and
     * that is why it is the one type with `isPlayingRound: false` — nobody
     * plays it. `activeStage` is resolved from the Round Robin stages and then
     * from `playRounds`, so a tournament whose only stage is a cut has none,
     * and without `?? stages[0]` its board would fall back to the event's
     * format — the very thing this change is about.
     *
     * This fixture is therefore a DEGENERATE tournament: a cut with nothing
     * either side of it, which nobody sets up on purpose. It is here because
     * the fallback has to hold for it, not because it describes real golf.
     * What `boardIsStroke` says about a cut matters only in the sense that it
     * must not read the event instead.
     */
    const state = await stateOf(qualifierOnly);
    expect(state.activeStage, "the premise: a cut is not a playing round").toBeNull();
    expect(state.boardStage, "the fallback did not find it").not.toBeNull();
    expect(state.boardIsStroke, "read the event instead of the stage").toBe(true);
    expect(state.isStroke, "and the event around it says match").toBe(false);
  });

  it("falls back to the event when there is no round at all", async () => {
    // A tournament created and not yet set up. There is nothing to ask, and
    // the event's answer is the only honest one — which is also exactly what
    // every board did before.
    const state = await stateOf(noRounds);
    expect(state.boardStage).toBeNull();
    expect(state.boardIsStroke).toBe(state.isStroke);
  });
});

describe("every board reads the round's answer", () => {
  /**
   * THE FOUR THAT PRINT A PER-PLAYER RESULT, and they are the whole of the
   * change. Each used to write `state.activeStage ?? state.stages[0] ?? null`
   * for itself — the same expression four times — and then ask the event about
   * it. They read `boardStage` and `boardIsStroke` now, so they cannot come to
   * disagree about which round is on screen or how to score it.
   */
  const BOARDS = [
    ["src", "app", "(player)", "me", "board", "page.tsx"],
    ["src", "app", "(app)", "leaderboard", "page.tsx"],
    ["src", "lib", "services", "live-board.ts"],
    ["src", "lib", "services", "me.ts"],
  ];

  it("none of them asks the event", () => {
    // Absence, which is the comment-proof direction.
    for (const path of BOARDS) {
      const src = readSource(...path);
      expect(src, `${path.join("/")} still reads the event's format`).not.toMatch(/state\.isStroke/);
    }
  });

  it("none of them works out the round for itself", () => {
    for (const path of BOARDS) {
      const src = readSource(...path);
      expect(src, `${path.join("/")} still resolves its own stage`).not.toMatch(
        /state\.activeStage \?\? state\.stages\[0\]/,
      );
    }
  });

  it("all of them use the shared answer", () => {
    for (const path of BOARDS) {
      const src = readSource(...path);
      expect(src, `${path.join("/")} does not use boardIsStroke`).toMatch(/boardIsStroke/);
    }
  });
});
