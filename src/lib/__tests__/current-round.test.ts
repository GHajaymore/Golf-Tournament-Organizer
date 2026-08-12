import { describe, it, expect } from "vitest";
import { currentDatedRoundIndex, currentRoundIndex, hasAnyHole } from "../services/tournament";

/**
 * Which round the console thinks is being played.
 *
 * One number that the dashboard, score entry, the tee sheet, the leaderboard
 * and the printed standings all read. It was "the latest round that has
 * matches", which is right only if rounds are scheduled one at a time — and
 * they are not: every round robin without a cut line is drawn up front, in one
 * pass. So a two-round series pointed at Round 2 from the moment it was
 * created. Round 1 could be played to the last putt and the leaderboard still
 * showed a table of zeroes, because it was showing Round 2.
 */

const empty = JSON.stringify(new Array(18).fill(null));
const played = JSON.stringify([...new Array(17).fill(null), "A"]);

const m = (stageId: string, holes: string) => ({ stageId, holes });
const stages = (...ids: string[]) => ids.map((id) => ({ id }));

describe("hasAnyHole", () => {
  it("is true once a single hole is recorded", () => {
    expect(hasAnyHole(empty)).toBe(false);
    expect(hasAnyHole(played)).toBe(true);
  });

  it("treats an unreadable card as unplayed rather than throwing", () => {
    expect(hasAnyHole("not json")).toBe(false);
    expect(hasAnyHole("")).toBe(false);
  });
});

describe("currentRoundIndex", () => {
  it("opens on Round 1 when a whole series is scheduled up front", () => {
    // The regression. Both rounds exist and are empty from creation; the
    // round being played is the first one, not the last one drawn.
    const rr = stages("r1", "r2");
    const matches = [m("r1", empty), m("r1", empty), m("r2", empty), m("r2", empty)];
    expect(currentRoundIndex(rr, matches)).toBe(0);
  });

  it("stays on Round 1 while any of its matches is unplayed", () => {
    const rr = stages("r1", "r2");
    const matches = [m("r1", played), m("r1", empty), m("r2", empty)];
    expect(currentRoundIndex(rr, matches)).toBe(0);
  });

  it("moves on once every match in the round has a score", () => {
    const rr = stages("r1", "r2");
    const matches = [m("r1", played), m("r1", played), m("r2", empty)];
    expect(currentRoundIndex(rr, matches)).toBe(1);
  });

  it("rests on the last generated round when the tournament is finished", () => {
    // Nothing left to play: a completed event must still show its final
    // standings rather than falling back to Round 1.
    const rr = stages("r1", "r2");
    const matches = [m("r1", played), m("r2", played)];
    expect(currentRoundIndex(rr, matches)).toBe(1);
  });

  it("skips a round that has not been drawn yet", () => {
    // A cut-gated round has no matches until the cut is taken. It is not the
    // round being played, and landing on it is what "No matches yet" was.
    const rr = stages("r1", "r2", "r3");
    const matches = [m("r1", played), m("r2", empty)];
    expect(currentRoundIndex(rr, matches)).toBe(1);
  });

  it("reports no round at all when nothing has been generated", () => {
    expect(currentRoundIndex(stages("r1", "r2"), [])).toBe(-1);
    expect(currentRoundIndex([], [])).toBe(-1);
  });
});

describe("which round a dated league is on", () => {
  const at = (iso: string) => new Date(`${iso}T12:00:00`);
  const season = (...days: string[]) => days.map((playedOn) => ({ playedOn }));

  it("is the round most recently played, not the last on the calendar", () => {
    // The bug: with no Round Robin stages to reason about, the fallback was
    // simply "the last playing round". A twelve-week league in week two
    // opened every screen on week twelve — an empty tee sheet, an empty card,
    // and standings drawn from a round nobody had played.
    const weeks = season("2026-05-05", "2026-05-12", "2026-05-19", "2026-05-26");
    expect(currentDatedRoundIndex(weeks, at("2026-05-14"))).toBe(1);
  });

  it("counts today as played, from the moment the round starts", () => {
    const weeks = season("2026-05-05", "2026-05-12", "2026-05-19");
    expect(currentDatedRoundIndex(weeks, at("2026-05-12"))).toBe(1);
  });

  it("stays on the round just played the morning after", () => {
    // The day after a league night is when scores are entered and cards are
    // finished. Moving on to next week would put an unreturned card out of
    // reach of the person who has to return it.
    const weeks = season("2026-05-05", "2026-05-12", "2026-05-19");
    expect(currentDatedRoundIndex(weeks, at("2026-05-13"))).toBe(1);
  });

  it("points at the FIRST round before a season has started", () => {
    // Never the last: nothing has been played, and the round everyone is
    // preparing for is round one.
    const weeks = season("2026-05-05", "2026-05-12", "2026-05-19");
    expect(currentDatedRoundIndex(weeks, at("2026-04-20"))).toBe(0);
  });

  it("rests on the final round once the season is over", () => {
    const weeks = season("2026-05-05", "2026-05-12", "2026-05-19");
    expect(currentDatedRoundIndex(weeks, at("2026-07-01"))).toBe(2);
  });

  it("says -1 when no round carries a date", () => {
    // Which leaves every undated tournament on exactly the behaviour it has
    // always had — the last playing round, correct for a single-round event.
    expect(currentDatedRoundIndex(season("", "", ""), at("2026-05-14"))).toBe(-1);
    expect(currentDatedRoundIndex([], at("2026-05-14"))).toBe(-1);
  });

  it("ignores undated rounds rather than letting them decide", () => {
    const weeks = season("2026-05-05", "", "2026-05-19");
    expect(currentDatedRoundIndex(weeks, at("2026-05-14"))).toBe(0);
  });

  it("is unmoved by a single-round tournament", () => {
    expect(currentDatedRoundIndex(season("2026-05-05"), at("2026-05-14"))).toBe(0);
    expect(currentDatedRoundIndex(season("2026-05-05"), at("2026-04-01"))).toBe(0);
  });
});
