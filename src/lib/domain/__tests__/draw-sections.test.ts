import { describe, it, expect } from "vitest";
import { drawSections, drawControlsOf, matchGeneratorPlace, knockoutSetupOf, knockoutSetupPlace, cupLineupPlace, needsYouSection, DRAW_SECTION_KEYS, type DrawRound } from "../draw-sections";
import type { Family } from "../tournament-status";
import { STAGE_TYPES } from "../../stage-types";

/**
 * WHICH SECTIONS A ROUND'S TEE TIMES & DRAW SCREEN HAS (R9a). Pure: it chooses what is drawn, never what
 * is in it, so no draw, cut or handicap arithmetic is under test here (`draw.ts` and `grouping.ts` are
 * untouched by this screen, and the matrix has no new cell).
 */

const FAMILIES: Family[] = ["stroke", "stableford", "match", "roundRobinFlights", "knockout", "flightedKnockout", "teamCup", "league", "casual"];
const STROKE_FORMAT = "Stroke Play";
const MATCH_FORMAT = "Singles Match Play";
const round = (type: string, hasSavedSheet = true, format = STROKE_FORMAT): DrawRound => ({ type, format, hasSavedSheet });

describe("drawSections", () => {
  it("the stroke and Stableford rounds are built, in the TD's order: who is in, the draw, tee times, the day, paper", () => {
    for (const family of ["stroke", "stableford"] as const) {
      const out = drawSections(round("Stroke Play Round"), family);
      expect(out, family).toEqual({ built: true, keys: ["whoIn", "draw", "teeTimes", "onTheDay", "paper"] });
    }
  });

  it("there is no Paper section until a sheet is saved: there is nothing to print", () => {
    expect(drawSections(round("Stroke Play Round", false), "stroke")).toEqual({ built: true, keys: ["whoIn", "draw", "teeTimes", "onTheDay"] });
  });

  it("every family x every stage type: only a casual round is left to today's tee sheet; the rest (R9c built the knockout, the knockout in flights and the cup) have the same five sections", () => {
    for (const family of FAMILIES) {
      for (const type of STAGE_TYPES) {
        const out = drawSections(round(type, true, type === "Stroke Play Round" ? STROKE_FORMAT : MATCH_FORMAT), family);
        const built = family !== "casual";
        expect(out.built, `${family} / ${type}`).toBe(built);
        if (out.built) {
          expect(out.keys, `${family} / ${type}`).toEqual(["whoIn", "draw", "teeTimes", "onTheDay", "paper"]);
        } else {
          expect(out.keys, `${family} / ${type}`).toEqual([]);
          expect(out.lane, `${family} / ${type}`).toBe("none");
        }
      }
    }
  });

  it("a tournament of THREE rounds is answered round by round, in every family: a qualifier, the bracket and a third round are all built", () => {
    const rounds = [round("Stroke Play Round"), round("Bracket Stage", true, MATCH_FORMAT), round("Single Match Stage", true, MATCH_FORMAT)];
    for (const family of ["stroke", "knockout", "flightedKnockout", "teamCup"] as const) {
      expect(rounds.map((r) => drawSections(r, family).built), family).toEqual([true, true, true]);
    }
    expect(rounds.map((r) => drawSections(r, "casual").built)).toEqual([false, false, false]);
  });

  it("a sided round of a stroke tournament, a league week, a round robin and a match are each built", () => {
    expect(drawSections({ type: "Stroke Play Round", format: "Four-Ball", hasSavedSheet: false }, "stroke").built).toBe(true);
    expect(drawSections({ type: "Stroke Play Round", format: "Stroke Play", hasSavedSheet: false }, "league")).toEqual({ built: true, keys: ["whoIn", "draw", "teeTimes", "onTheDay"] });
    expect(drawSections({ type: "Round Robin", format: "Match Play", hasSavedSheet: true }, "roundRobinFlights").built).toBe(true);
    expect(drawSections({ type: "Single Match Stage", format: MATCH_FORMAT, hasSavedSheet: false }, "match").built).toBe(true);
  });

  it("never names a section it has no words for, and never twice", () => {
    for (const family of FAMILIES) {
      const out = drawSections(round("Stroke Play Round"), family);
      expect(new Set(out.keys).size).toBe(out.keys.length);
      for (const k of out.keys) expect(DRAW_SECTION_KEYS).toContain(k);
    }
  });
});

describe("needsYouSection", () => {
  const keys = drawSections(round("Stroke Play Round"), "stroke").keys;
  it("the tee-sheet and draw jobs of THIS round mark the draw; the schedule marks tee times", () => {
    expect(needsYouSection({ key: "tee-sheet", roundId: "r2" }, "r2", keys)).toBe("draw");
    expect(needsYouSection({ key: "draw", roundId: "r2" }, "r2", keys)).toBe("draw");
    expect(needsYouSection({ key: "schedule", roundId: "r2" }, "r2", keys)).toBe("teeTimes");
  });
  it("a job of another round, another kind of job, or none marks nothing", () => {
    expect(needsYouSection({ key: "tee-sheet", roundId: "r1" }, "r2", keys)).toBeNull();
    expect(needsYouSection({ key: "cards", roundId: "r2" }, "r2", keys)).toBeNull();
    expect(needsYouSection({ key: "launch", roundId: null }, "r2", keys)).toBeNull();
    expect(needsYouSection(null, "r2", keys)).toBeNull();
  });
  it("a whole-tournament tee-sheet job marks the draw of whichever round is open", () => {
    expect(needsYouSection({ key: "tee-sheet", roundId: null }, "r3", keys)).toBe("draw");
  });
  it("a section the round does not have is never marked", () => {
    expect(needsYouSection({ key: "schedule", roundId: null }, "r2", ["whoIn", "draw"])).toBeNull();
  });
});

describe("drawControlsOf (R9b): which draw controls a round has", () => {
  const live = { launched: true, isFirst: false, completed: false };

  it("a round of sides that draws matches has Generate matches; nothing else does", () => {
    // Pairs come from `generatesPairings` (a round robin) AND a team format (`needsTeams`): both, or none.
    expect(drawControlsOf({ type: "Round Robin", format: "Four-Ball" }, live).teamMatches).toBe(true);
    expect(drawControlsOf({ type: "Round Robin", format: "Match Play" }, live).teamMatches).toBe(false);
    expect(drawControlsOf({ type: "Stroke Play Round", format: "Four-Ball" }, live).teamMatches).toBe(false);
    expect(drawControlsOf({ type: "Single Match Stage", format: "Singles Match Play" }, live).teamMatches).toBe(false);
  });

  it("the next round's draw is offered once live, not on the first round, not once over, never on a bracket seeded from qualifiers", () => {
    const rr = { type: "Round Robin", format: "Match Play" };
    expect(drawControlsOf(rr, live).nextRound).toBe(true);
    expect(drawControlsOf(rr, { ...live, launched: false }).nextRound).toBe(false);
    expect(drawControlsOf(rr, { ...live, isFirst: true }).nextRound).toBe(false);
    expect(drawControlsOf(rr, { ...live, completed: true }).nextRound).toBe(false);
    expect(drawControlsOf({ type: "Bracket Stage", format: "Match Play" }, live).nextRound).toBe(false);
  });
});

describe("knockoutSetupOf and the places (R9c): the knockout's and the cup's set-up is on exactly one screen", () => {
  const rounds = [
    { type: "Stroke Play Round", format: STROKE_FORMAT },
    { type: "Bracket Stage", format: MATCH_FORMAT },
    { type: "Team Session", format: MATCH_FORMAT },
  ];

  it("the play-off for third and the play-by dates are the bracket's own round's, the flights only while the knockout is in flights, a lineup a session's", () => {
    expect(knockoutSetupOf(rounds[0], "flights", false)).toEqual({ thirdPlace: false, playBy: false, flights: false, lineup: false });
    expect(knockoutSetupOf(rounds[1], "single", true)).toEqual({ thirdPlace: true, playBy: true, flights: false, lineup: false });
    expect(knockoutSetupOf(rounds[1], "flights", true)).toEqual({ thirdPlace: true, playBy: true, flights: true, lineup: false });
    expect(knockoutSetupOf(rounds[2], "split", false)).toEqual({ thirdPlace: false, playBy: false, flights: false, lineup: true });
  });

  it("two Bracket Stages: the play-by dates and the flights are drawn on the FIRST only (the Bracket reads one), the play-off for third on each", () => {
    const [first, second] = [true, false].map((isFirst) => knockoutSetupOf({ type: "Bracket Stage" }, "flights", isFirst));
    expect(first).toMatchObject({ playBy: true, flights: true, thirdPlace: true });
    expect(second).toMatchObject({ playBy: false, flights: false, thirdPlace: true });
  });

  it("every family, three rounds, both switch states: Tee times & draw while it is shown and builds the family, the old screen otherwise", () => {
    for (const family of FAMILIES) {
      const built = family !== "casual";
      for (const r of rounds) {
        const round: DrawRound = { ...r, hasSavedSheet: false };
        expect(knockoutSetupPlace(round, family, true), `${family} / ${r.type}, shown`).toBe(built ? "teeTimes" : "bracket");
        expect(knockoutSetupPlace(round, family, false), `${family} / ${r.type}, not shown`).toBe("bracket");
        expect(cupLineupPlace(round, family, true), `${family} / ${r.type}, shown`).toBe(built ? "teeTimes" : "cup");
        expect(cupLineupPlace(round, family, false), `${family} / ${r.type}, not shown`).toBe("cup");
      }
    }
  });
});

describe("matchGeneratorPlace (R9b): the generator is on exactly one screen", () => {
  const rr: DrawRound = { type: "Round Robin", format: "Four-Ball", hasSavedSheet: false };

  it("Tee times & draw while it is shown AND builds the round, Teams otherwise: every family, both switch states", () => {
    for (const family of FAMILIES) {
      const built = drawSections(rr, family).built;
      expect(matchGeneratorPlace(rr, family, true), `${family}, shown`).toBe(built ? "teeTimes" : "teams");
      expect(matchGeneratorPlace(rr, family, false), `${family}, not shown`).toBe("teams");
    }
  });
});
