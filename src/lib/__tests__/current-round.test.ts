import { describe, it, expect } from "vitest";
import { currentRoundIndex, hasAnyHole } from "../services/tournament";

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
