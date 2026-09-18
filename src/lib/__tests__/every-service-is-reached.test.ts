import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * EVERY EXPORTED SERVICE IS CALLED BY SOMETHING.
 *
 * `every-endpoint-is-reachable.test.ts` asks this of `"use server"` exports,
 * where the answer is "live attack surface for a capability the product does
 * not offer". Services are not endpoints, so that sweep does not look at them —
 * and the other half of its reasoning applies just as hard:
 *
 *   **A SERVICE NOBODY CALLS IS USUALLY A FEATURE THAT DOES NOT WORK.**
 *
 * Not dead weight. The function is written, commented, typed and tested, and
 * the screen that was supposed to ask it never appeared — so the behaviour its
 * comment describes silently does not happen. `handicapReadable` says it is
 * "the question a roster screen asks before telling an organizer their club is
 * on GHIN but nothing has been fetched … a state a club can sit in for a whole
 * season without noticing unless a screen says so". No screen asks it.
 *
 * Fourteen of 198 exported service functions had no caller when this was first
 * run on 2026-09-18.
 *
 * WHY THE LIST BELOW IS NOT A LIST OF THINGS TO DELETE. Deleting them would
 * erase the only record that the behaviour was ever intended — the comment is
 * the design, and it is more useful kept and named than quietly removed. So
 * each one is listed with WHY it is not called, which turns invisible dead code
 * into a register somebody can act on. `docs/deferred-register.md` carries the
 * same entries in prose.
 *
 * Anything NOT on the list fails, which is the point: the class cannot grow
 * silently, and a new service written without a caller is noticed the day it
 * is written rather than found in a sweep a year later.
 */

/** `file:function` → why nothing calls it. Every entry is a decision. */
const UNREACHED: Record<string, string> = {
  // ── Behaviour that was designed and never given a screen ───────────────
  //
  // `limits.ts:limitStatus` was the first entry here and is GONE, which is the
  // register working: the club's plan panel calls it now, the second cell
  // below failed the moment it did, and the entry came off. An allowlist that
  // keeps an entry after somebody wires the function turns this file into
  // folklore.
  "roster.ts:memberHistory":
    "What one member has played, 'the answer the old per-event lists couldn't give'. Nothing shows it, so the club's handicap history is in the database and on no screen.",
  // `integrations.ts:handicapReadable` was the second entry to leave, the day
  // after it arrived: the roster screen asks it now, which is the screen its
  // own comment always said should. Two of the nine are gone within a day of
  // being written down, which is the argument for writing them down.
  "courses.ts:isMultiCourse":
    "Whether a tournament rotates venues, so the single-course case can stay invisible. Every picker decides that for itself instead.",
  "courses.ts:eventCourses":
    "A tournament's linked courses. Superseded in practice by `resolveCourse` and the COURSE_REF include; kept because the rotation work will want the plain list.",

  // ── Overtaken by later work, kept until the work that replaced them is settled ──
  "handicaps.ts:teePolicyFor":
    "The tee policy for 'paths that convert handicaps themselves rather than going through handicapsForRound'. There are no such paths left — which is the outcome it wanted. Kept as the one reader if a path ever needs it again.",
  "handicaps.ts:courseHandicapForPlayer":
    "One player's course handicap for the same set of paths. Same reason.",
  "league-nomination.ts:clubsIn":
    "Flights that have fielded a side. The league screens ask `flightsIn` instead, which is the right question before the first nomination — see its comment.",
  "tournament.ts:expectedRrTotal":
    "How many matches a full round robin should have. The draw checks its own arithmetic now.",
  "tournament.ts:matchProgress":
    "Matches done out of total. FOUND 2026-09-18, the day tests stopped counting as callers — it had been masked by its own test since its readers were removed. Every other mention of it in the codebase is a comment explaining why something deliberately does NOT use it: the dashboard dropped its one reader, `lifecycle-state` reads `state.resultsIn` instead because this counts only the ACTIVE round, and `tournament.ts` names it twice more as the thing not being read. So it is not waiting for a screen — it lost an argument, and the comments are the record of it. Delete it and those four explanations point at nothing; keep it and a dead function sits in the file. Ajay's call, deliberately not taken here.",
};

/** Every `.ts` under services. */
function serviceFiles(): string[] {
  const dir = join(process.cwd(), "src", "lib", "services");
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory() && entry.endsWith(".ts")) out.push(entry);
  }
  return out;
}

/**
 * Everything that could hold a caller: the app, the e2e suite, the scripts.
 *
 * NOT THE UNIT AND AUDIT TESTS. A test calling a function is not the thing
 * this register asks about — the question is whether any SCREEN, action or
 * script reaches it, and the entries below are written in exactly those words
 * ("nothing shows it", "no screen"). Counting a test as a caller means writing
 * a test for an unreached service silently takes it off the register, which is
 * the opposite of what a test for it should do: `memberHistory` gained proper
 * coverage and would have been reported as reached, with no screen anywhere.
 *
 * `e2e` and `scripts` DO count. Both drive the real app, so a service one of
 * them reaches is genuinely in use.
 */
function callerFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__") callerFiles(full, out);
    } else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(full.slice(process.cwd().length + 1));
  }
  return out;
}

const SERVICES = serviceFiles();
const CALLERS = [
  ...callerFiles(join(process.cwd(), "src")),
  ...callerFiles(join(process.cwd(), "e2e")),
  ...callerFiles(join(process.cwd(), "scripts")),
];
// Comments stripped — otherwise every function is "called" by the paragraph
// above it explaining what calls it. The `readSource` trap, which this repo
// has paid for twice.
const BODIES = new Map(CALLERS.map((f) => [f, readSource(f)]));

/**
 * Does this file use `name`, other than to define it?
 *
 * THE OWN-FILE CASE IS WHY THIS EXISTS. A helper exported for a test but used
 * only by its own module IS reached — `staffSeatCount` is called twice inside
 * `limits.ts` and is no more a dead feature than a private function would be.
 * The sweep used to skip the service's own file entirely, so nineteen of those
 * looked unreachable the moment tests stopped counting as callers, and burying
 * nineteen true helpers in the register would have made it unreadable — which
 * is how a register becomes folklore nobody checks.
 *
 * The definition line has to come off, or every service trivially calls itself.
 */
function usesIt(body: string, name: string, isOwnFile: boolean): boolean {
  const lines = body.split("\n").filter((line) => {
    if (!isOwnFile) return true;
    return !(
      line.includes(`export function ${name}`) ||
      line.includes(`export async function ${name}`) ||
      line.includes(`export const ${name}`)
    );
  });
  const rest = lines.join("\n");
  return rest.includes(`${name}(`) || rest.includes(`${name},`) || rest.includes(`${name} }`);
}

describe("every exported service has a caller", () => {
  it("can see the codebase at all", () => {
    // The control. A sweep with no files reports everything as unreachable or
    // nothing as unreachable, depending which way it is written, and both
    // readings are equally wrong and equally quiet.
    expect(SERVICES.length).toBeGreaterThan(40);
    expect(CALLERS.length).toBeGreaterThan(300);

    // And it can see a function everybody knows is called.
    const known = [...BODIES].filter(
      ([f, b]) => !f.endsWith(join("services", "roster.ts")) && b.includes("loadRoster("),
    );
    expect(known.length, "the sweep cannot even find loadRoster's callers").toBeGreaterThan(0);
  });

  const unreached: string[] = [];

  for (const file of SERVICES) {
    const source = readSource("src", "lib", "services", file);
    for (const line of source.split("\n")) {
      const match = line.match(/^export (?:async )?function (\w+)/);
      if (!match) continue;
      const name = match[1];
      const key = `${file}:${name}`;

      const called = [...BODIES].some(
        ([caller, body]) => usesIt(body, name, caller.endsWith(join("services", file))),
      );
      if (!called && !UNREACHED[key]) unreached.push(key);
    }
  }

  it("has no service nothing calls that this file has not been told about", () => {
    expect(
      unreached,
      "a service with no caller is usually a feature that does not work. Wire it, or list it above with the reason nothing calls it.",
    ).toEqual([]);
  });

  it("keeps the list honest — nothing listed is actually called", () => {
    /**
     * The other direction, and the one that rots. An entry that stays here
     * after somebody wires the function turns this file into folklore, and the
     * next reader believes a screen is missing when it is not.
     */
    const stale: string[] = [];
    for (const key of Object.keys(UNREACHED)) {
      const [file, name] = key.split(":");
      const called = [...BODIES].some(
        ([caller, body]) => usesIt(body, name, caller.endsWith(join("services", file))),
      );
      if (called) stale.push(key);
    }
    expect(stale, "these are called now — take them off the list").toEqual([]);
  });
});
