import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { stripComments } from "./source";
import { join } from "node:path";

/**
 * EVERY DOMAIN FUNCTION IS CALLED BY SOMETHING THAT IS NOT A TEST.
 *
 * `totalsByCategory` was written so the ledger could answer "what did the
 * lodging come to", had its own passing unit test, and was rendered NOWHERE.
 * The screen asked for a category on every expense and then threw the answer
 * away. Ajay found it by looking at the form on 2026-09-19 and asking why the
 * tests had not.
 *
 * They could not: a test asserts what a function RETURNS, and a function can
 * be perfectly correct and dead. The suite even made it look healthier than it
 * was — green coverage over code no user can reach.
 *
 * This is the same sweep `audit-idor` and the server-action reachability pass
 * apply one layer out, and it closes the class rather than this instance:
 * dead code here is either a feature somebody forgot to finish (this case) or
 * a rule nothing enforces, and both are worth knowing about.
 *
 * WHAT COUNTS AS A CALLER: any file under `src` that is not a test and not the
 * file itself. Re-exports do not count — a barrel that names a dead function
 * keeps it looking alive, which is exactly the fault being swept for.
 */

const SRC = join(process.cwd(), "src");
const DOMAIN = join(SRC, "lib", "domain");

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      filesUnder(p, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

const isTest = (p: string) => p.includes("__tests__") || /\.(test|spec)\.tsx?$/.test(p);

/**
 * Every non-test file in `src`, with its source, read once — AND WITHOUT ITS
 * COMMENTS, which is not tidiness.
 *
 * `uses()` below deletes import statements before looking for callers, with
 * `import[\s\S]*?from "…"`. That is non-greedy from the word `import` to the
 * next `from "…"` — and the word appears in PROSE all over this codebase.
 * Measured on `services/tournament.ts` on 2026-09-20: one sentence in a
 * comment ("the rule existed, in a file one import away") extended the match
 * across 5,012 characters and swallowed a real call site, so the sweep
 * reported `fieldEnteringRound` — called on the line below the comment — as
 * reachable from nothing.
 *
 * That is this file's own lesson pointed at itself: a sweep whose failure
 * looks like a finding. It cost one red run and would have cost a deletion if
 * anybody had believed it, which is the expensive direction.
 *
 * Comments are stripped here, once, so no regex below can be widened by
 * English. `stripComments` is the same reader `source-guard.test.ts` insists
 * on for exactly this class of mistake.
 */
const APP_FILES = filesUnder(SRC)
  .filter((p) => !isTest(p))
  .map((p) => ({ path: p, src: stripComments(readFileSync(p, "utf8")) }));

/** Exported function names per domain file. */
function exportedFunctions(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)) out.push(m[1]);
  // `export const foo = (…) =>` and `export const foo = function`
  for (const m of src.matchAll(/export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?(?:\(|function)/g)) {
    out.push(m[1]);
  }
  return out;
}

/**
 * How many times a name is USED in a file — called, rendered or passed.
 *
 * THREE SHAPES, because two of them were missed and the sweep then reported
 * live code as dead. `usePendingCard<(number | null)[]>({…})` is a call with a
 * type argument, so `name(` does not match it; `<PageHeader` is how a
 * component is reached; and `onClick={reset}` passes one without calling it.
 * A sweep that cannot see those cries wolf, which is how a useful sweep gets
 * switched off.
 */
function uses(source: string, name: string): number {
  // IMPORTS ARE NOT USES. `import { totalsByCategory } from …` matches the
  // "passed by name" shape below, so a file that imports a dead function and
  // never calls it would keep it looking alive — which is the barrel-file
  // problem one line removed.
  /**
   * ANCHORED AT THE START OF A LINE, because `import` is also an English word.
   *
   * Unanchored, this ran from any occurrence of the letters to the next
   * `from "…"` anywhere after it. Comments are stripped before this now, which
   * is the main defence; the anchor is the second, so a string literal
   * containing the word cannot reopen the hole.
   */
  const src = source.replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?/gm, "");
  let n = 0;
  // `name(`, `name<`, `<Name`, `{name}`, `name,` in an argument list.
  for (const _ of src.matchAll(new RegExp(`(?<![A-Za-z0-9_$.])${name}\\s*[(<]`, "g"))) n += 1;
  for (const _ of src.matchAll(new RegExp(`<${name}[\\s/>]`, "g"))) n += 1;
  for (const _ of src.matchAll(new RegExp(`[{(,=]\\s*${name}\\s*[,})\\]]`, "g"))) n += 1;
  return n;
}

/**
 * How many times this name appears as a DEFINITION rather than a use, so the
 * definition does not count as its own caller.
 */
function definitions(src: string, name: string): number {
  let n = 0;
  for (const _ of src.matchAll(new RegExp(`(?:function|const)\\s+${name}\\s*[=(]`, "g"))) n += 1;
  return n;
}

interface Dead {
  file: string;
  name: string;
}

/**
 * WHAT WAS ALREADY DEAD WHEN THIS SWEEP WAS WRITTEN (2026-09-19). Debt, not
 * permission — see the assertion below.
 *
 * SEVEN ENTRIES LEFT ON 2026-09-20 AND NONE OF THEM WAS EVER DEAD:
 * `ImportSummary`, `contactGaps`, `cardFrom`, `fieldRosterSummary`,
 * `rosterSelection`, `fetchDirectoryCourse` and `libraryOrganizationFor` are
 * all called by a screen or an action. They were listed because the matcher
 * could not see their call sites — the import-stripping regex above was
 * widened by the word "import" appearing in a comment, and took whole blocks
 * of real code with it.
 *
 * Which is the lesson this file already teaches, pointed at itself: the sweep
 * reported live code as dead for a day, and the only reason it was caught is
 * that it did it to a function somebody had just written. Worth knowing when
 * reading what is left — the list is shorter than it was and it is now the
 * measurement rather than the instrument's shadow.
 *
 * The four worth looking at first, because they are features rather than
 * leftovers:
 *
 *   season.ts:seasonStandings / seasonTotals   the league's own season table —
 *       "where do we stand after six weeks", which its file calls "the only
 *       table a league actually cares about". Computed, mutation-tested, and
 *       on no screen.
 *   skins-pot.ts:seasonPosition                a player's money across a
 *       weekly league, same story.
 *   handicap-record.ts:handicapRecordFrom      a scoring record built for
 *       handicapping and never shown.
 *
 * The rest are smaller: helpers that outlived their caller, validators the
 * boundary stopped needing, formatters replaced by the `Formatting` versions.
 */
const KNOWN_DEAD: string[] = [
  "lib/domain/attendance.ts:isAttendanceMode",
  "lib/domain/attest.ts:enterableBy",
  "lib/domain/bracket.ts:pickQualifiers",
  "lib/domain/bracket.ts:splitBrackets",
  "lib/domain/carry.ts:carriedInto",
  "lib/domain/club-season.ts:inPlayingWindow",
  "lib/domain/cut.ts:describeCut",
  "lib/domain/expenses.ts:evenShares",
  "lib/domain/grouping.ts:groupAvgHandicap",
  "lib/domain/grouping.ts:groupCountFor",
  "lib/domain/handicap-policy.ts:handicapStanding",
  "lib/domain/handicap-record.ts:handicapRecordFrom",
  "lib/domain/locale.ts:formatDayIn",
  "lib/domain/locale.ts:formatDayRangeIn",
  "lib/domain/locale.ts:formatMonthIn",
  "lib/domain/match-entry.ts:resolveMatchEntry",
  "lib/domain/match-tiebreak.ts:defaultCountback",
  "lib/domain/match.ts:isMatchStarted",
  "lib/domain/messaging.ts:canStartThreadIn",
  "lib/domain/money-rules-version.ts:moneyRulesFingerprint",
  "lib/domain/quick-match.ts:matchNeedsCard",
  "lib/domain/round-expiry.ts:isExpired",
  "lib/domain/score-import.ts:isNetShape",
  "lib/domain/score-payload.ts:cleanMargin",
  "lib/domain/score-payload.ts:cleanWinner",
  "lib/domain/score-posting.ts:decidePost",
  "lib/domain/score-posting.ts:postKey",
  "lib/domain/season.ts:seasonStandings",
  "lib/domain/season.ts:seasonTotals",
  "lib/domain/skins-pot.ts:seasonPosition",
  "lib/domain/team-entry.ts:declaredTeamEntry",
  "lib/domain/tee-sheet.ts:teeSheetAsPlayed",
  "lib/domain/venue.ts:findCard",
  "lib/domain/venue.ts:libraryProvider",
  "lib/services/attestation.ts:parseAttested",
  "lib/services/availability.ts:splitBySchedule",
  "lib/services/courses.ts:eventCourses",
  "lib/services/courses.ts:isMultiCourse",
  "lib/services/handicaps.ts:courseHandicapForPlayer",
  "lib/services/handicaps.ts:teePolicyFor",
  "lib/services/identity-repair.ts:applyRepair",
  "lib/services/identity-repair.ts:loadRepair",
  "lib/services/league-nomination.ts:clubsIn",
  "lib/services/tournament.ts:expectedRrTotal",
];

const dead: Dead[] = [];
let checked = 0;

/**
 * THREE LAYERS, ONE FAULT.
 *
 * A domain rule nothing calls, a service nothing reads and a component nothing
 * renders are the same defect wearing different clothes: work that passes its
 * tests and reaches no user. Swept together so the class is closed rather than
 * the instance.
 */
const SWEPT = [DOMAIN, join(SRC, "lib", "services"), join(SRC, "components")];

for (const file of SWEPT.flatMap((d) => filesUnder(d)).filter((p) => !isTest(p))) {
  const src = readFileSync(file, "utf8");
  for (const name of exportedFunctions(src)) {
    checked += 1;
    /**
     * CALLED ANYWHERE THAT IS NOT ITS OWN DEFINITION.
     *
     * The first version of this sweep asked only about OTHER files, and
     * reported forty functions that are alive — `seedOrder` and `nassauNets`
     * are called by their own file's exports, which is an internal helper that
     * happens to be exported, not dead code. That is a style question and this
     * is a correctness one, so the sweep would have cried wolf about both.
     *
     * A call inside the defining file therefore counts. What is left is the
     * real thing: written, tested, and reachable from nothing at all.
     */
    const ownCalls = uses(src, name) - definitions(src, name);
    const called = ownCalls > 0 || APP_FILES.some((f) => f.path !== file && uses(f.src, name) > 0);
    if (!called) dead.push({ file: file.slice(SRC.length + 1).split("\\").join("/"), name });
  }
}

describe("the domain is reachable", () => {
  it("found functions to check, so an empty sweep cannot pass vacuously", () => {
    // The control this file's own lesson demands: a sweep that measures
    // nothing reports a clean app.
    expect(checked, "no exported domain functions found — the sweep is broken").toBeGreaterThan(200);
    expect(statSync(DOMAIN).isDirectory()).toBe(true);
  });

  it("catches a function nothing calls — the sweep's other control", () => {
    /**
     * A name that cannot exist in the app, run through the same test the sweep
     * uses. If this reads as "called", the matcher is broken and every result
     * above it is worthless.
     */
    const invented = "zzNobodyCallsThisFunction";
    expect(APP_FILES.some((f) => f.src.includes(`${invented}(`))).toBe(false);
  });

  it("reads a REAL call site that a comment sits on top of", () => {
    /**
     * THE CONTROL DRAWN FROM THE CORPUS, which is the one the two above are
     * not.
     *
     * Both of those are constructed: a count over synthetic names and a
     * fabricated string. They passed — and went on passing — while the matcher
     * was swallowing five thousand characters of a real file, because neither
     * of them has a doc comment above it and so neither could ever exercise
     * the path that broke. The sweep was correct about its controls and wrong
     * about the tree.
     *
     * `fieldEnteringRound` is the function that exposed it: called from
     * `services/tournament.ts` with a long comment immediately above the call,
     * which is the shape the old regex could not see past. Asserting that THIS
     * name reads as called is a measurement of the instrument against the code
     * it is pointed at, rather than against an example written to suit it.
     *
     * If it is ever genuinely removed, this fails and wants replacing with
     * another call site that has prose over it — not deleting.
     */
    const live = "fieldEnteringRound";
    const callers = APP_FILES.filter(
      (f) => !f.path.endsWith(join("domain", "cut.ts")) && uses(f.src, live) > 0,
    );
    expect(
      callers.map((f) => f.path.slice(SRC.length + 1)),
      "the sweep cannot see a call site it is looking straight at",
    ).not.toEqual([]);
  });

  it("adds nothing new that no screen renders", () => {
    /**
     * `totalsByCategory` is why this exists: written so the ledger could
     * answer "what did the lodging come to", tested, and rendered nowhere.
     *
     * THE LIST BELOW IS DEBT, NOT A PERMISSION. Every entry is work that
     * passes its tests and reaches no user, and each is one of two things: a
     * feature somebody stopped halfway through, or a rule the app no longer
     * applies. Both want deciding rather than leaving — and the sharpest ones
     * are named in the note under this list.
     *
     * The assertion is that the list does not GROW. A new dead export fails
     * here on the day it is written, which is the only moment anybody knows
     * why it was written.
     */
    const found = dead.map((d) => `${d.file}:${d.name}`).sort();
    const unexpected = found.filter((f) => !KNOWN_DEAD.includes(f));
    expect(unexpected, "written and reachable from nothing — finish it, call it, or delete it").toEqual([]);
  });

  it("shrinks: the list does not name anything that is now alive", () => {
    // The other direction, so the debt list cannot rot. Wiring one of these
    // up (or deleting it) must also take it off the list, or the next reader
    // cannot tell which entries are real.
    const found = dead.map((d) => `${d.file}:${d.name}`);
    const stale = KNOWN_DEAD.filter((k) => !found.includes(k));
    expect(stale, "no longer dead — remove it from KNOWN_DEAD").toEqual([]);
  });
});
