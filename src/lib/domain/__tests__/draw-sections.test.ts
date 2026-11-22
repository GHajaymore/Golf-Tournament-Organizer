import { describe, it, expect } from "vitest";
import { drawSections, needsYouSection, DRAW_SECTION_KEYS, type DrawRound } from "../draw-sections";
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

  it("every family x every stage type: only a stroke-scored round of a stroke or Stableford tournament is built; the rest say which PR builds them", () => {
    for (const family of FAMILIES) {
      for (const type of STAGE_TYPES) {
        const out = drawSections(round(type, true, type === "Stroke Play Round" ? STROKE_FORMAT : MATCH_FORMAT), family);
        const built = (family === "stroke" || family === "stableford") && type === "Stroke Play Round";
        expect(out.built, `${family} / ${type}`).toBe(built);
        if (!out.built) {
          expect(out.keys, `${family} / ${type}`).toEqual([]);
          expect(out.lane, `${family} / ${type}`).toBe(family === "knockout" || family === "flightedKnockout" || family === "teamCup" ? "R9c" : "R9b");
        }
      }
    }
  });

  it("a tournament of THREE rounds is answered round by round: a match round among stroke rounds is not built", () => {
    const rounds = [round("Stroke Play Round"), round("Single Match Stage", true, MATCH_FORMAT), round("Stroke Play Round")];
    expect(rounds.map((r) => drawSections(r, "stroke").built)).toEqual([true, false, true]);
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
