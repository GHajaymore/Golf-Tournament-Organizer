import { describe, it, expect } from "vitest";
import { leaderboardRounds } from "../leaderboard-rounds";
import { withBoardRound, type EventState } from "@/lib/services/tournament";

/**
 * THE CONSOLE LEADERBOARD'S ROUND PICKER — offered where choosing changes the
 * board, and nowhere else (Ajay, 2026-09-26).
 *
 * The seeded Festival of Formats ends in a round scored by hand, and the board
 * showed that round alone: rounds 1–10 could not be reached from the console.
 */
const s = (id: string, format: string, type = "Stroke Play Round") => ({ id, type, format });

describe("which rounds the leaderboard offers", () => {
  it("offers every round when the last is scored by hand (the Festival)", () => {
    const rounds = leaderboardRounds([
      s("r1", "Modified Stableford"),
      s("r2", "Skins"),
      s("r3", "Four-Ball"),
      s("r4", "Other (scored by hand)"),
    ]);
    expect(rounds.map((r) => r.stageId)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(rounds[0].label).toBe("Round 1 · Modified Stableford");
  });

  it("offers each team round, since each is a board of its own", () => {
    expect(leaderboardRounds([s("a", "Four-Ball"), s("b", "Foursomes")])).toHaveLength(2);
  });

  it("offers nothing on a plain two-round medal — one board serves both (the control)", () => {
    // Without this, "offer every round always" passes both cases above.
    expect(leaderboardRounds([s("a", "Stroke Play"), s("b", "Stroke Play")])).toEqual([]);
  });

  it("offers nothing on a league of Stableford weeks, or with one round", () => {
    expect(leaderboardRounds([s("a", "Stableford"), s("b", "Stableford"), s("c", "Stableford")])).toEqual([]);
    expect(leaderboardRounds([s("a", "Skins")])).toEqual([]);
  });

  it("does not offer a stage nobody plays", () => {
    const rounds = leaderboardRounds([s("a", "Skins"), s("cut", "", "Retired Stage Type"), s("b", "Four-Ball")]);
    expect(rounds.map((r) => r.stageId)).toEqual(["a", "b"]);
    // And numbers the rounds as golf does, past the stage nobody plays.
    expect(rounds[1].label).toBe("Round 2 · Four-Ball");
  });
});

describe("pointing the board at a picked round", () => {
  const stroke = { id: "r1", type: "Stroke Play Round", format: "Stableford" };
  const byHand = { id: "r2", type: "Stroke Play Round", format: "Other (scored by hand)" };
  const cut = { id: "cut", type: "Retired Stage Type", format: "" };
  const state = {
    stages: [stroke, cut, byHand],
    activeStage: byHand,
    boardStage: byHand,
    boardIsStroke: true,
  } as unknown as EventState;

  it("puts the picked round in every pointer a board reads", () => {
    const view = withBoardRound(state, "r1");
    expect(view.boardStage?.id).toBe("r1");
    // `standingRows` checks THIS one for a manual format on its first line —
    // left on the hand-scored round, the picked board would still come back [].
    expect(view.activeStage?.id).toBe("r1");
  });

  it("leaves the state alone for no pick, a cut, or an id that is not a round (the control)", () => {
    expect(withBoardRound(state, undefined)).toBe(state);
    expect(withBoardRound(state, "cut")).toBe(state);
    expect(withBoardRound(state, "not-a-round")).toBe(state);
  });
});
