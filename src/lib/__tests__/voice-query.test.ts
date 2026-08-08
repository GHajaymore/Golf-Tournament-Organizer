import { describe, it, expect } from "vitest";
import { parseVoiceQuery, answerVoiceQuery, type VoiceContext } from "../domain/voice-query";

/**
 * Spoken questions about the round.
 *
 * The property under test: narrow and honest. Everything recognized is
 * answered from real data; everything else says what it can answer, and a
 * missing round or score is named rather than invented.
 */

describe("hearing the question", () => {
  it("hears a handicap question, with and without a round", () => {
    expect(parseVoiceQuery("what is my handicap for round 2")).toEqual({ kind: "handicap", round: 2 });
    expect(parseVoiceQuery("what am I playing off")).toEqual({ kind: "handicap", round: null });
    expect(parseVoiceQuery("how many strokes do I get")).toEqual({ kind: "handicap", round: null });
  });

  it("hears spoken round numbers", () => {
    expect(parseVoiceQuery("my handicap for round two")).toEqual({ kind: "handicap", round: 2 });
  });

  it("hears an opponent question", () => {
    expect(parseVoiceQuery("who am I playing in round 3")).toEqual({ kind: "opponent", round: 3 });
    expect(parseVoiceQuery("who's my opponent")).toEqual({ kind: "opponent", round: null });
  });

  it("hears a standings question", () => {
    expect(parseVoiceQuery("where do I stand")).toEqual({ kind: "standing" });
    expect(parseVoiceQuery("what's my position on the leaderboard")).toEqual({ kind: "standing" });
  });

  it("hears a score question without confusing it for standings", () => {
    expect(parseVoiceQuery("what's my score")).toEqual({ kind: "score", round: null });
  });

  it("admits what it didn't understand", () => {
    expect(parseVoiceQuery("book me a tee time for tuesday").kind).toBe("unknown");
    expect(parseVoiceQuery("").kind).toBe("unknown");
  });
});

describe("answering from the round's data", () => {
  const ctx: VoiceContext = {
    playerName: "Alex",
    handicapByRound: { 1: 14, 2: 7 },
    currentRound: 1,
    opponentByRound: { 1: "Sam Okafor" },
    position: { rank: 3, of: 28 },
    scoreText: "+2 thru 11",
  };

  it("answers the exact question asked", () => {
    expect(answerVoiceQuery({ kind: "handicap", round: 2 }, ctx)).toBe(
      "Your playing handicap for round 2 is 7.",
    );
  });

  it("defaults to the round on screen", () => {
    expect(answerVoiceQuery({ kind: "handicap", round: null }, ctx)).toContain("round 1 is 14");
  });

  it("names a round that doesn't exist instead of inventing one", () => {
    expect(answerVoiceQuery({ kind: "handicap", round: 4 }, ctx)).toBe(
      "There's no round 4 in this tournament.",
    );
  });

  it("says who the opponent is, and when none is drawn", () => {
    expect(answerVoiceQuery({ kind: "opponent", round: 1 }, ctx)).toBe("Round 1: you're playing Sam Okafor.");
    expect(answerVoiceQuery({ kind: "opponent", round: 2 }, ctx)).toContain("No opponent drawn");
  });

  it("reads the standing as an ordinal", () => {
    expect(answerVoiceQuery({ kind: "standing" }, ctx)).toBe("You're 3rd of 28.");
    expect(answerVoiceQuery({ kind: "standing" }, { ...ctx, position: { rank: 22, of: 28 } })).toBe(
      "You're 22nd of 28.",
    );
    expect(answerVoiceQuery({ kind: "standing" }, { ...ctx, position: { rank: 11, of: 28 } })).toBe(
      "You're 11th of 28.",
    );
  });

  it("is honest when the data isn't there", () => {
    expect(answerVoiceQuery({ kind: "standing" }, { playerName: "Alex" })).toContain("No standings yet");
    expect(answerVoiceQuery({ kind: "score", round: null }, { playerName: "Alex" })).toContain(
      "No score recorded",
    );
  });

  it("tells an unknown question what it can do", () => {
    expect(answerVoiceQuery({ kind: "unknown" }, ctx)).toContain("what's my handicap");
  });
});
