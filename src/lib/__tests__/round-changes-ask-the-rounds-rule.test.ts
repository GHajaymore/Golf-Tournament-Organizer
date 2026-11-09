import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * EVERY ACTION THAT CHANGES A ROUND'S ALLOWANCE, BASIS, TEES, FORMAT,
 * EXISTENCE OR DAY ASKS THE ONE ROUNDS RULE (J12, state machine PR 7b;
 * `domain/round-change.ts`, its door `services/round-change.ts`) — before it
 * writes, and returns what it says. Not the setup lock: launch invalidates no
 * round setting, so these are judged by what they would invalidate.
 *
 * And the "recompute and log": each term change made after play goes through
 * `afterTermChange`, which reads the round again through the board's own
 * resolver and writes what moved in Recent changes — a tee change re-freezing
 * first. Pinned by name, so a door cannot quietly go back to the lock, write
 * before it asks, or drop the log.
 */

const TEAMS = "src/app/actions/teams.ts";
const TOURNAMENT = "src/app/actions/tournament.ts";
const COURSES = "src/app/actions/courses.ts";

function body(file: string, name: string): string {
  const src = readSource(file);
  const at = src.indexOf(`export async function ${name}(`);
  expect(at, `${name} is not in ${file}`).toBeGreaterThan(-1);
  const next = src.indexOf("export ", at + 1);
  return src.slice(at, next === -1 ? undefined : next);
}

const FIRST_WRITE = /prisma\.\w+\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(/;

/** A term of one round: asked, refusal and question returned, then recomputed and logged after the write. */
const TERM_SITES: Record<string, { file: string; kind: "allowance" | "round-tees"; tees: boolean }> = {
  setStageAllowance: { file: TEAMS, kind: "allowance", tees: false },
  setStageAllowanceWeights: { file: TEAMS, kind: "allowance", tees: false },
  setStageScoringBasis: { file: TOURNAMENT, kind: "allowance", tees: false },
  setStageCourse: { file: COURSES, kind: "round-tees", tees: true },
};

/** A tee change that reaches every round. */
const FIELD_TEE_SITES: Record<string, string> = { setEventDefaultTee: COURSES, setFlightTee: COURSES, setPlayerTee: COURSES };

describe("the rounds-and-format actions ask the rounds rule (J12, PR 7b)", () => {
  for (const [name, s] of Object.entries(TERM_SITES)) {
    it(`${name} asks the rule for "${s.kind}", returns its refusal and its question, then recomputes and logs`, () => {
      const b = body(s.file, name);
      expect(b, `${name} still asks the setup lock`).not.toMatch(/refuseIfLocked\(/);
      expect(b).toMatch(new RegExp(`beforeTermChange\\(eventId, stageId, \\{ kind: "${s.kind}" \\}`));
      expect(b).toMatch(/if \("refused" in gate\) return gate\.refused;\s*if \("asked" in gate\) return gate\.asked;/);
      const asked = b.indexOf("beforeTermChange(");
      const write = b.search(FIRST_WRITE);
      expect(write, `${name} writes nothing`).toBeGreaterThan(-1);
      expect(asked, `${name} writes before it asks`).toBeLessThan(write);
      // After the write: re-frozen for tees (`{ players: null }`), or not (`null`) for the allowance.
      const after = b.lastIndexOf("afterTermChange(");
      expect(after, `${name} does not recompute and log`).toBeGreaterThan(write);
      expect(b.slice(after)).toMatch(s.tees ? /afterTermChange\(eventId, gate\.go, [\s\S]*?, \{ players: null \}\)/ : /afterTermChange\(eventId, gate\.go, [\s\S]*?, null\)/);
    });
  }

  for (const [name, file] of Object.entries(FIELD_TEE_SITES)) {
    it(`${name} asks the rule across every round, then re-freezes the players it reaches and logs`, () => {
      const b = body(file, name);
      expect(b).toMatch(/const gate = await beforeFieldTeeChange\(eventId, \{ changed: [^}]+, force \}\);\s*if \("refused" in gate\) return gate\.refused;\s*if \("asked" in gate\) return gate\.asked;/);
      const write = b.search(FIRST_WRITE);
      expect(b.indexOf("beforeFieldTeeChange(")).toBeLessThan(write);
      expect(b.slice(write)).toMatch(/afterTermChange\(eventId, gate\.go, [\s\S]*?\{ players: (null|members|\[playerId\]) \}\)/);
    });
  }

  it("setStageFormat asks the rule with the format it would become, before it writes, and says the re-draw", () => {
    const b = body(TOURNAMENT, "setStageFormat");
    expect(b).not.toMatch(/refuseIfLocked\(|needsConfirm: true/);
    expect(b).toMatch(/const judged = await roundVerdictFor\(eventId, stageId, \{ kind: "format", to: format \}\);/);
    expect(b).toMatch(/if \(!judged\.verdict\.ok\) return \{ ok: false as const, error: judged\.verdict\.says \};/);
    expect(b.indexOf("roundVerdictFor(")).toBeLessThan(b.search(FIRST_WRITE));
    expect(b).toMatch(/judged\.verdict\.warn === "redraw" \? redrawWords\(/);
  });

  it("removeStage asks the rule before it counts or purges, refuses in words, and asks first after the draw", () => {
    const b = body(TOURNAMENT, "removeStage");
    expect(b).not.toMatch(/refuseIfLocked\(/);
    expect(b).toMatch(/const judged = await roundVerdictFor\(eventId, stageId, \{ kind: "delete" \}\);/);
    expect(b).toMatch(/if \(!judged\.verdict\.ok\) return \{ ok: false as const, needsConfirm: false as const, refused: judged\.verdict\.says \};/);
    expect(b.indexOf("roundVerdictFor(")).toBeLessThan(b.indexOf("purgeRound("));
    expect(b).toMatch(/if \(!force && \(cards > 0 \|\| stakes > 0 \|\| records > 0 \|\| drawn\)\)/);
  });

  it("a round's day and deadline, and dating every round, ask the rule's 'day' (refused once completed)", () => {
    const played = body(TOURNAMENT, "setStagePlayedOn");
    expect(played).toMatch(/roundVerdictFor\(eventId, stageId, \{ kind: "day" \}\)/);
    expect(played.indexOf("roundVerdictFor(")).toBeLessThan(played.search(FIRST_WRITE));
    expect(played).toMatch(/said: SCHEDULES_WORDS/);
    const due = body(TOURNAMENT, "setStageDeadline");
    expect(due).toMatch(/roundRefusal\(eventId, stageId, \{ kind: "day" \}\)/);
    expect(due.indexOf("roundRefusal(")).toBeLessThan(due.search(FIRST_WRITE));
    const season = body(TOURNAMENT, "dateUndatedRounds");
    expect(season).toMatch(/acrossRoundsRefusal\(eventId, \{ kind: "day" \}\)/);
    expect(season.indexOf("acrossRoundsRefusal(")).toBeLessThan(season.search(FIRST_WRITE));
  });

  it("the recompute reads the round through the board's own resolver, and a tee change re-freezes through the freeze's", () => {
    const door = readSource("src/lib/services/round-change.ts");
    // One resolver for "what each player plays off": the round's handicap list, frozen first.
    expect(door).toMatch(/await freezeRoundHandicaps\(eventId, stageId\);\s*const views = await roundHandicapsFor\(eventId, stageId\);/);
    // No second copy of the arithmetic in the door.
    expect(door).not.toMatch(/courseHandicapExact|playingHandicapFrom|roundPlayingHandicap\(|wholeStrokes\(/);
    // The thaw is for the confirmed field only, and the freeze writes it back.
    expect(door).toMatch(/where: \{ eventId, status: "confirmed"/);
    expect(door).toMatch(/data: \{ frozen: null, frozenExact: null, frozenParStrokes: null, frozenAt: null \},\s*\}\);\s*await freezeRoundHandicaps\(eventId, stageId\);/);
    // And the line goes in Recent changes, under Rounds.
    expect(door).toMatch(/logAudit\(eventId, "round\.recomputed", recomputedLine\(/);
    expect(readSource("src/lib/domain/change-kind.ts")).toMatch(/"round\.recomputed", "round\.format"/);
  });

  it("CONTROL: the body reader sees a lock-asking action as one", () => {
    expect(body(TOURNAMENT, "setStageHoles")).toMatch(/refuseIfLocked\(eventId, "rounds"/);
  });
});
