import { describe, it, expect } from "vitest";
import { ASKS, NOT_A_DOOR, ACTIONS, askingHelpers, functionsIn, serviceDoors } from "./archive-doors";

/**
 * EVERY DOOR THAT EDITS A TOURNAMENT ASKS THE ARCHIVE (2026-10-21).
 *
 * A lapsed paid club's tournaments are a read-only archive for twelve months
 * (`domain/club-archive.ts`). The rule is one function, and it holds only if
 * every server action that changes a tournament asks it — directly
 * (`assertEventWritable`, `archiveRefusalFor`), or through a gate that does: the
 * staff gates of each action file, `requireScoreEntry`, and the pot gate
 * `requirePotAccess` in services.
 *
 * So every action is either such a door or named below with why it is not one:
 * it changes nothing of a tournament (a read, a draft, a preview), it is about
 * the club or a person rather than a tournament, or it MAKES a tournament,
 * which after a lapse is an ordinary Par one. A new action cannot edit an
 * archived tournament by being forgotten: it fails here until it is one or the
 * other.
 *
 * What this does NOT prove is that the refusal is right — the audit test
 * `a-lapsed-club-keeps-a-read-only-archive.audit.test.ts` presses the real
 * actions against real rows for that.
 *
 * Read through `readSource` (comments stripped): the doc blocks name the gates
 * in prose, and prose must not satisfy the rule.
 */

describe("the archive is asked at every door", () => {
  it("every action asks it, or says why it is not a door into a tournament", () => {
    const silent = ACTIONS.filter((a) => !a.asks && !(a.name in NOT_A_DOOR)).map((a) => `${a.file}: ${a.name}`);
    expect(silent, "ask `assertEventWritable` / `archiveRefusalFor`, or add it to NOT_A_DOOR with why").toEqual([]);
  });

  it("the list names only actions that exist and still do not ask", () => {
    const stale = Object.keys(NOT_A_DOOR).filter((n) => !ACTIONS.some((a) => a.name === n && !a.asks));
    expect(stale, "gone, renamed, or a door now — take it off the list").toEqual([]);
  });

  it("CONTROL: the actions are found, the pot gate really asks, and the staff gates are doors", () => {
    expect(ACTIONS.length).toBeGreaterThanOrEqual(260);
    expect(serviceDoors).toEqual(["requirePotAccess("]);
    const names = (n: string) => ACTIONS.find((a) => a.name === n);
    for (const n of ["saveScorecard", "setBracketWinner", "addExpense", "saveSkinsPot", "setEventStatus", "savePlayCard", "registerForEvent"]) {
      expect(names(n)?.asks, `${n} should be a door`).toBe(true);
    }
  });

  it("CONTROL: an action that writes a tournament and asks nothing is seen", () => {
    const src = [
      "async function requireStaff() {",
      "  const session = await getSession();",
      "  return session.eventId;",
      "}",
      "export async function renameRound(stageId: string, name: string) {",
      "  const eventId = await requireStaff();",
      "  await prisma.stage.update({ where: { id: stageId }, data: { name } });",
      "}",
      "",
    ].join("\n");
    const helpers = askingHelpers(src, "x.ts");
    expect(helpers).toEqual([]);
    const [a] = functionsIn("x.ts", src, "export async function ");
    expect([...ASKS, ...helpers.map((h) => `${h}(`)].some((n) => a.body.includes(n))).toBe(false);
    // …and the same gate, asking, makes it a door.
    const asking = src.replace("  return session.eventId;", "  await assertEventWritable(session.eventId);\n  return session.eventId;");
    expect(askingHelpers(asking, "x.ts")).toEqual(["requireStaff"]);
  });
});

/**
 * A PRESS IN AN ARCHIVE IS REFUSED IN WORDS, NOT THROWN (2026-11-09).
 *
 * The staff gates THROW `ArchivedTournament`, which is right for an action
 * whose caller cannot show words. But a button on the dashboard or the rounds
 * screen awaits `{ ok, error }` and shows the error beside itself; a throw
 * reaches it as the error screen, "This screen didn't load" (CI, desktop 1/3,
 * `setRoundClosed`). So each action a person can press from those screens
 * takes its gate through a helper that catches the archive's class
 * (`staffEventOrRefusal`, `adminEventOrRefusal`, `staffSessionOrRefusal`) and
 * returns the sentence.
 *
 * Extend PRESSED_WITH_WORDS when a new button on those screens calls an action.
 */
const PRESSED_WITH_WORDS = [
  "setRoundClosed", "settleCutTie", "setEventStatus", "launchTournament", "setConfigUnlocked",
  "setStageDeadline", "setStageCarry", "setStageScoringBasis", "setStageScoreInput", "setStageMatchKeptBy",
  "setStageScoring", "setStageFormat", "setStageHoles", "setStagePlayedOn", "addStage", "removeStage",
  "generateNextRound", "setStageOptDeadline", "setStageCourse", "suspendPlay", "resumePlay",
];

/** Does the body take a gate that throws, with nothing to catch it? */
function throwsAtThePress(body: string): boolean {
  const bare = /await (requireStaffEvent|requireAdminEvent|requireStaffSession|requireStaffOrg)\(\)/.test(body);
  const catches = /(OrRefusal)\(\)|archiveRefusalOf\(/.test(body);
  return bare && !catches;
}

describe("a press in an archive is refused in words", () => {
  it("every action pressed from the dashboard or the rounds screen says the archive's refusal", () => {
    const missing = PRESSED_WITH_WORDS.filter((n) => !ACTIONS.some((a) => a.name === n));
    expect(missing, "renamed or gone — fix the list").toEqual([]);
    const thrown = ACTIONS.filter((a) => PRESSED_WITH_WORDS.includes(a.name) && throwsAtThePress(a.body)).map((a) => `${a.file}: ${a.name}`);
    expect(thrown, "take the gate through its OrRefusal helper and return { ok: false, error }").toEqual([]);
  });

  it("CONTROL: an action that takes a throwing gate bare is seen, and one that catches is not", () => {
    expect(throwsAtThePress("  const eventId = await requireStaffEvent();\n  return { ok: true };")).toBe(true);
    expect(throwsAtThePress('  const gate = await staffEventOrRefusal();\n  if ("refused" in gate) return { ok: false };')).toBe(false);
  });
});
