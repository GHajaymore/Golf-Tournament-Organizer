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
 * resolver and writes what moved in Recent changes. A tee change after play is
 * refused, never re-frozen (option C, 8 Nov). Pinned by name, so a door cannot go back to the lock, write
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

/** A term of one round — allowance, split, basis: asked, refusal and question returned, then recomputed and logged after the write. */
const TERM_SITES: Record<string, string> = { setStageAllowance: TEAMS, setStageAllowanceWeights: TEAMS, setStageScoringBasis: TOURNAMENT };

/** A tee change that reaches every round. */
const FIELD_TEE_SITES: Record<string, string> = { setEventDefaultTee: COURSES, setFlightTee: COURSES, setPlayerTee: COURSES };

describe("the rounds-and-format actions ask the rounds rule (J12, PR 7b)", () => {
  for (const [name, file] of Object.entries(TERM_SITES)) {
    it(`${name} asks the rule for "allowance", returns its refusal and its question, then recomputes and logs`, () => {
      const b = body(file, name);
      expect(b, `${name} still asks the setup lock`).not.toMatch(/refuseIfLocked\(/);
      expect(b).toMatch(/beforeTermChange\(eventId, stageId, \{ kind: "allowance" \}/);
      // Whatever the verdict is called (`gate`, or `term` where the archive's staff gate
      // already holds that name — #1093): its refusal and its question are returned, and its
      // `go` is what the log is given.
      const bound = /const (\w+) = await beforeTermChange\(/.exec(b);
      expect(bound, `${name} does not keep the rule's verdict`).not.toBeNull();
      const v = bound![1];
      expect(b).toMatch(new RegExp(`if \\("refused" in ${v}\\) return ${v}\\.refused;\\s*if \\("asked" in ${v}\\) return ${v}\\.asked;`));
      const asked = b.indexOf("beforeTermChange(");
      const write = b.search(FIRST_WRITE);
      expect(write, `${name} writes nothing`).toBeGreaterThan(-1);
      expect(asked, `${name} writes before it asks`).toBeLessThan(write);
      const after = b.lastIndexOf("afterTermChange(");
      expect(after, `${name} does not recompute and log`).toBeGreaterThan(write);
      expect(b.slice(after)).toMatch(new RegExp(`afterTermChange\\(eventId, ${v}\\.go, \`[^\`]*\`\\);`));
    });
  }

  /**
   * A TEE OR COURSE CHANGE AFTER PLAY IS REFUSED, NEVER RE-FROZEN (option C, 8
   * Nov): no tee action asks a question, re-freezes or logs a recompute; each
   * asks the rule before it writes and returns its refusal.
   */
  it("setStageCourse asks the rule's round-tees before it writes, and returns the refusal — no question, no re-freeze", () => {
    const b = body(COURSES, "setStageCourse");
    expect(b).toMatch(/const refused = changed \? await roundRefusal\(eventId, stageId, \{ kind: "round-tees" \}\) : null;\s*if \(refused\) return \{ ok: false, error: refused \};/);
    expect(b.indexOf("roundRefusal(")).toBeLessThan(b.search(FIRST_WRITE));
    expect(b).not.toMatch(/afterTermChange|beforeTermChange|needsConfirm: true/);
  });

  for (const [name, file] of Object.entries(FIELD_TEE_SITES)) {
    it(`${name} asks the rule across every round before it writes, and re-freezes nothing`, () => {
      const b = body(file, name);
      expect(b).toMatch(/const refused = \([^)]+\?\? null\) !== \(teeId \?\? null\) \? await acrossRoundsRefusal\(eventId, \{ kind: "field-tees" \}\) : null;\s*if \(refused\) return \{ ok: false, error: refused \};/);
      expect(b.indexOf("acrossRoundsRefusal(")).toBeLessThan(b.search(FIRST_WRITE));
      expect(b).not.toMatch(/afterTermChange|force/);
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
    // Said beside the save once scores exist (J39/J40 PR 2 joins the notices-off line to it).
    expect(played).toMatch(/judged\.verdict\.warn === "schedules" \? SCHEDULES_WORDS/);
    expect(played).toMatch(/return said \? \{ ok: true, said \}/);
    const due = body(TOURNAMENT, "setStageDeadline");
    expect(due).toMatch(/roundRefusal\(eventId, stageId, \{ kind: "day" \}\)/);
    expect(due.indexOf("roundRefusal(")).toBeLessThan(due.search(FIRST_WRITE));
    const season = body(TOURNAMENT, "dateUndatedRounds");
    expect(season).toMatch(/acrossRoundsRefusal\(eventId, \{ kind: "day" \}\)/);
    expect(season.indexOf("acrossRoundsRefusal(")).toBeLessThan(season.search(FIRST_WRITE));
  });

  it("the recompute reads the round through the board's own resolver, and nothing anywhere thaws a frozen round", () => {
    const door = readSource("src/lib/services/round-change.ts");
    // One resolver for "what each player plays off": the round's handicap list, frozen first.
    expect(door).toMatch(/await freezeRoundHandicaps\(eventId, stageId\);\s*const views = await roundHandicapsFor\(eventId, stageId\);/);
    // No second copy of the arithmetic in the door.
    expect(door).not.toMatch(/courseHandicapExact|playingHandicapFrom|roundPlayingHandicap\(|wholeStrokes\(/);
    // Option C (8 Nov): no re-freeze from today's index — neither the door nor the tee actions write `frozen: null`
    // (clearing scores still thaws a round, in tournament.ts, as it always has).
    for (const file of ["src/lib/services/round-change.ts", COURSES]) {
      expect(readSource(file), `${file} thaws a frozen round`).not.toMatch(/frozen:\s*null|refreeze/i);
    }
    // And the line goes in Recent changes, under Rounds.
    expect(door).toMatch(/logAudit\(eventId, "round\.recomputed", recomputedLine\(/);
    expect(readSource("src/lib/domain/change-kind.ts")).toMatch(/"round\.recomputed", "round\.format"/);
  });

  it("a round's holes ask the rule's 'holes' (format-like, 8 Nov) before they write, and only when they change", () => {
    const b = body(TOURNAMENT, "setStageHoles");
    expect(b).not.toMatch(/refuseIfLocked\(|needsConfirm: true/);
    expect(b).toMatch(/if \(holesPlayed\(current\.holes\) !== value\) \{\s*const refused = await roundRefusal\(eventId, stageId, \{ kind: "holes" \}\);\s*if \(refused\) return \{ ok: false as const, error: refused \};/);
    expect(b.indexOf("roundRefusal(")).toBeLessThan(b.search(FIRST_WRITE));
  });

  it("the rounds a cut was made out of are the one answer's, read by the door and the screen alike", () => {
    expect(readSource("src/lib/domain/cut-ready.ts")).toMatch(/export function cutsMadeAfter\([\s\S]*?cutHasBeenMade\(r, rounds\[i - 1\]\)/);
    expect(readSource("src/lib/services/round-change.ts")).toMatch(/cutsMade: cutsMadeAfter\(stages\)/);
  });

  it("CONTROL: the body reader sees a lock-asking action as one", () => {
    expect(body(TOURNAMENT, "setStageCarry")).toMatch(/refuseIfLocked\(eventId, "rounds"/);
  });
});
