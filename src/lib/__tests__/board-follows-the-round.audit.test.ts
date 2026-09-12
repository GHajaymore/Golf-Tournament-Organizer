import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadEventState, standingRows } from "@/lib/services/tournament";
import { readSource } from "./source";

/** Every source file under `src`, tests excluded. Swept, not listed — see below. */
function sourceFiles(dir = "src", out: string[] = []): string[] {
  for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      sourceFiles(rel, out);
    } else if (/\.tsx?$/.test(entry.name) && statSync(join(process.cwd(), rel)).isFile()) {
      out.push(rel);
    }
  }
  return out;
}

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
let legacyMedal = "";
let noRounds = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/**
 * An event of `eventFormat` holding one round of `stageType`, or none.
 *
 * `grosses` seeds a player per score and a full eighteen-hole card for each,
 * which is what it takes to assert that a board prints a NUMBER rather than
 * only that it thinks it should. Pass none and the event has no field, which
 * is all the `boardIsStroke` cells below need.
 */
async function tournament(
  name: string,
  eventFormat: string,
  stageType?: string,
  stageFormat?: string,
  grosses: number[] = [],
) {
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
  let stageId = "";
  if (stageType) {
    const stage = await prisma.stage.create({
      data: {
        eventId: event.id,
        position: 1,
        type: stageType,
        format: stageFormat ?? "Stroke Play",
        scoringBasis: "gross",
        holes: 18,
      },
      select: { id: true },
    });
    stageId = stage.id;
  }
  for (const [i, gross] of grosses.entries()) {
    const player = await prisma.player.create({
      data: {
        eventId: event.id,
        name: `${TAG} P${i + 1}`,
        email: `${TAG}-${name}-${i}@example.invalid`.toLowerCase(),
        seed: i + 1,
        status: "confirmed",
        handicap: 0,
      },
      select: { id: true },
    });
    if (!stageId) continue;
    // A whole round, so nothing downstream can call the card part-played. The
    // last hole carries the remainder, which is what makes the totals differ.
    const holes = [...new Array(17).fill(4), gross - 68];
    await prisma.scorecard.create({
      data: { eventId: event.id, stageId, playerId: player.id, strokes: JSON.stringify(holes) },
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
  // THE LEGACY MEDAL. A Round Robin set to Stroke Play, with a field and real
  // cards on it, because this one asserts what the board PRINTS.
  legacyMedal = await tournament("legacy-medal", "stroke", "Round Robin", "Stroke Play", [72, 75, 79]);
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

  it("always finds the round, now that every stage type is one", async () => {
    /**
     * THE PROPERTY THAT LET THE FALLBACK GO. `boardStage` used to read
     * `activeStage ?? stages[0] ?? null`, and the `?? stages[0]` existed for
     * the one type the field never played — the "Qualification Stage", which
     * was a cut rather than a round and so appeared in no `playRounds` list.
     *
     * With that type removed, `playRounds` holds every stage and
     * `currentPlayedRoundIndex` returns -1 only for an empty list, so
     * `activeStage` is non-null whenever the tournament has any stage at all.
     * Asserted across every remaining type rather than the one that happened
     * to be convenient: if a future type is added with `isPlayingRound: false`
     * this goes red, which is exactly when the fallback would be needed again.
     */
    for (const id of [strokeInStroke, matchInMatch, strokeInMatch, matchInStroke]) {
      const state = await stateOf(id);
      expect(state.activeStage, "a stage exists but no active round was found").not.toBeNull();
      expect(state.boardStage).toBe(state.activeStage);
    }
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

describe("a round robin that is really a medal", () => {
  /**
   * THE REGRESSION THIS FILE'S OWN FIX SHIPPED, and the reason it is asserted
   * against printed numbers rather than a boolean.
   *
   * `boardIsStroke` was first derived from the stage TYPE alone, on the
   * reasoning — written into `stage-types.ts` and believed — that the type is
   * what says whether anybody is playing anybody. It is, and it is not the
   * whole question. `stage-types.ts` also records that a **Round Robin set to
   * Stroke Play** was "the only way to run" a medal before `Stroke Play Round`
   * existed. Those rounds are still in the database.
   *
   * So the type says head-to-head, the round is a medal, and the board went
   * looking for a win-loss-halved record on a player who had shot 72. There
   * isn't one. It printed an empty cell, on the player board, the console
   * leaderboard, `/live` and `/me` — every screen a score is read on.
   *
   * Live for a day. Caught on 2026-09-12 by MEASURING both directions on a
   * fixture of this shape rather than reasoning about the types again, which
   * is the only reason it was caught at all: the boolean looked defensible and
   * the output did not.
   */
  it("prints the scores, rather than a record it has not got", async () => {
    const state = await stateOf(legacyMedal);
    expect(state.boardIsStroke, "a medal round presented as match play").toBe(true);

    const rows = standingRows(state).filter((r) => r.ranked);
    expect(rows.length, "no ranked rows at all").toBe(3);

    // The assertion that a boolean cannot make. What the player SEES is
    // `gross` when the board is stroke and `record` when it is not, and the
    // shipped defect left `record` empty with the scores sitting unread.
    expect(rows.map((r) => r.gross), "the cards were not counted").toEqual([72, 75, 79]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    for (const r of rows) {
      expect(r.started, `${r.name} had a full card and was called unstarted`).toBe(true);
      // And the match columns are empty, because there are no matches — which
      // is exactly what the board was trying to print.
      expect(r.record, "a medal round handed out a win-loss-halved record").toBe("");
    }
  });

  it("still calls a round robin of MATCH play match play", async () => {
    /**
     * THE CONTROL, and it is not decoration: the obvious over-correction is to
     * read the format and forget the type, which turns every real round robin
     * into a medal and blanks the other board instead. Both halves are needed
     * — `matrix.test.ts` asserts the same pair on the function itself.
     */
    const state = await stateOf(matchInMatch);
    expect(state.boardIsStroke).toBe(false);
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
    /**
     * THE FIFTH, and it was missed the first time round.
     *
     * Reports renders the same `LeaderboardTable` off the same `standingRows`
     * as the console leaderboard, so leaving it on `event.format` had the two
     * screens printing one round two ways. It also writes the CSV, where the
     * column set follows the same flag — so the export somebody reads to award
     * a prize disagreed with the board on the wall.
     *
     * Added 2026-09-12, by sweeping the readers of `state.isStroke` rather
     * than waiting to be told. That is the cheap half of the lesson from the
     * regression this file's own fix shipped.
     */
    ["src", "app", "(app)", "reports", "page.tsx"],
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

  it("and so does anything else that builds these rows", () => {
    /**
     * SWEPT FROM THE FILESYSTEM, because the list above is a list and a list
     * gets out of date. Reports was the fifth board and was missed for a day;
     * `layout.spec.ts` was rewritten from a hand list to a sweep for the same
     * reason, and CLAUDE.md records that the hand list covered 14 of 22 routes.
     *
     * THE RULE: if you call `standingRows`, the rows you get back are the
     * BOARD's — `standingRows` itself branches on `boardIsStroke` — so asking
     * `state.isStroke` about them is asking about a different round. That is
     * the whole of the defect this file exists for, restated as something a
     * sixth board cannot get wrong without going red.
     *
     * `tournament.ts` is exempt because it DEFINES both, and its own uses are
     * asserted by the fixtures at the top of this file rather than by grep.
     */
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      if (f.endsWith(join("services", "tournament.ts"))) continue;
      const src = readSource(f);
      if (!/standingRows\s*\(/.test(src)) continue;
      if (/state\.isStroke/.test(src)) offenders.push(f);
    }
    expect(
      offenders,
      `these build board rows and ask the EVENT how to read them: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("and none of them works out the round for itself either", () => {
    /**
     * THE OTHER HALF OF THE SAME RULE, swept for the same reason.
     *
     * `state.activeStage ?? state.stages[0]` is the expression `boardStage`
     * exists to replace, and the hand-listed check above it only covered the
     * files somebody remembered to list. The dashboard still wrote it, and on
     * 2026-09-12 the rendered page said:
     *
     *     Current round
     *     Round 1 · Round Robin
     *     7/33 scorecards in
     *
     * The NAME of the group phase over the CARD COUNT of the medal round, in
     * one card, with the leaderboard directly above it ranking the medal — and
     * a round robin has no scorecards at all. Two more props on that same
     * table, `isStableford` and the team-round empty note, read `activeStage`
     * for a question about the rows beside them.
     *
     * `activeStage` itself is NOT banned and must not be: it is the
     * match-points chain's position and score entry's default round, and the
     * dashboard still reads it for the round cut. What is banned is one file
     * re-deriving the BOARD's round when `boardStage` already holds it.
     */
    /**
     * ONE LINE, NOT ONE FILE — the objection `knockout-readers.test.ts` makes
     * to file-level exemptions applies here too: a file allowance permits
     * everything in that file for ever, including the exact thing being
     * guarded against.
     *
     * `/entry` is the SCORE ENTRY screen. It resolves a stage to decide which
     * round a scorer is typing into, and `activeStage` is the right answer for
     * that — its own doc says it is "what score entry and `current round`
     * default to", and it prefers the round IN PROGRESS, which is what you
     * want to type into and is not always the latest round with results. That
     * screen appears here only because it also calls `standingRows` once, for
     * the spoken "where am I?" — and that call already asks `boardStage`.
     */
    const ALLOWED = new Set([`const activeStage = state.activeStage ?? state.stages[0] ?? null;`]);
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      if (f.endsWith(join("services", "tournament.ts"))) continue;
      const src = readSource(f);
      if (!/standingRows\s*\(/.test(src)) continue;
      for (const line of src.split("\n")) {
        const t = line.trim();
        if (!/state\.activeStage\s*\?\?\s*state\.stages\[0\]/.test(t)) continue;
        if (!ALLOWED.has(t)) offenders.push(`${f}: ${t}`);
      }
    }
    expect(
      offenders,
      `these build board rows and then resolve their own stage: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("and the PLAYER app never asks which round it is on", () => {
    /**
     * THE WHOLE `(player)` TREE, and it needs no allowances at all.
     *
     * A player has one round: the one in their hand. There is no screen in
     * that tree for which "the match-points chain's position" is the right
     * answer — no score-entry default to preserve, no chain to walk — so the
     * rule here is absolute where the console's has to make exceptions.
     *
     * Two screens were asking anyway, and one of them states RULES. Read off
     * the Demo Cup on 2026-09-12 with the field playing a Stroke Play Round
     * and the Board tab beside it saying "Ranked by strokes":
     *
     *     Format   Match Play · Round Robin under Rules of Golf 3.2
     *     Ties     Head-to-head result, then Hole differential …
     *
     * The wrong Rule of Golf for the round in the player's hand, and a
     * tiebreak chain that cannot apply to a card. `/me/money` had the same
     * fault under a comment reading "the round in front of you" — it offered a
     * side bet on the group phase to somebody standing on a medal tee.
     *
     * Neither screen calls `standingRows`, so the sweep above could not see
     * them. Found by reading the rendered player app.
     */
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      if (!f.includes(join("app", "(player)"))) continue;
      const src = readSource(f);
      if (/state\??\.activeStage/.test(src)) offenders.push(f);
    }
    expect(
      offenders,
      `a player screen resolving its own round: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
