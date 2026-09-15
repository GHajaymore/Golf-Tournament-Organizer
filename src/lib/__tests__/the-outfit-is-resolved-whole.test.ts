import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { readSource } from "./source";

/**
 * `orgProfile(kind)` CANNOT KNOW WHAT AN OUTFIT CALLS ITSELF.
 *
 * Three things decide the words: the KIND, the club's own COUNTRY (a society
 * in Britain, a league in the United States) and the organizer's OVERRIDE,
 * which beats the country because a country is only ever a good guess. A call
 * passing the kind alone silently throws the other two away.
 *
 * FOUND BY RENDERING, NOT BY READING, which is the part worth keeping. The
 * override shipped with its resolver tested, its provider wired and its picker
 * on the settings screen — and a probe against a US community rendered:
 *
 *     settings heading   "Society settings"   <- country said league
 *     sidebar            "Society"            <- and the override changed neither
 *
 * Four separate readers were resolving from the kind alone: the settings page
 * heading, the sidebar, the browser tab title and the setup checklist. The
 * first of those sits directly under the control that sets the word, so an
 * organizer could pick "league", save it, and watch the page not change.
 *
 * Eleven such calls existed. Nine are now fixed and this stops a twelfth.
 *
 * WHY A SWEEP AND NOT A FIX. Nine readers that happen to agree today is a
 * list, and this repo has spent a week paying for lists — the same argument
 * that put `flights-are-not-carriers.test.ts` in beside the carrier column.
 * A reader added next month has no reason to know any of the above.
 */

const ROOT = process.cwd();

function productFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e === "__tests__") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) productFiles(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const rel = (p: string) => p.replace(ROOT, "").replace(/^[\\/]/, "").split(sep).join("/");

/** Balanced-paren argument list, so a nested call cannot truncate it. */
function argsAt(src: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < src.length; i += 1) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(openParen + 1, i);
    }
  }
  return "";
}

function topLevelArgCount(args: string): number {
  if (args.trim() === "") return 0;
  let depth = 0;
  let n = 1;
  for (const c of args) {
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    else if (c === "," && depth === 0) n += 1;
  }
  return n;
}

interface Call {
  file: string;
  line: number;
  args: string;
  count: number;
}

function calls(): Call[] {
  const out: Call[] = [];
  const needle = "orgProfile(";
  for (const file of productFiles(join(ROOT, "src"))) {
    // The definition itself, which necessarily writes the one-argument form.
    if (rel(file).endsWith("domain/org-profile.ts")) continue;
    const src = readSource(rel(file));
    let i = 0;
    while ((i = src.indexOf(needle, i)) !== -1) {
      // `useOrgProfile(` ends with the same characters and is the CORRECT
      // thing to call — it reads a profile somebody else resolved whole.
      const prev = src[i - 1] ?? "";
      if (/[A-Za-z0-9_$.]/.test(prev)) {
        i += needle.length;
        continue;
      }
      const args = argsAt(src, i + needle.length - 1);
      out.push({
        file: rel(file),
        line: src.slice(0, i).split("\n").length,
        args: args.replace(/\s+/g, " ").trim(),
        count: topLevelArgCount(args),
      });
      i += needle.length;
    }
  }
  return out;
}

/**
 * The calls that may pass the kind alone, each with the reason it is allowed.
 *
 * Both are here because they cannot produce a WORD a person reads. Anything
 * that names an outfit on screen belongs in the other list.
 */
const KIND_ONLY_IS_FINE: Record<string, string> = {
  "src/components/OrgProfileProvider.tsx":
    "the context's default value, a literal `orgProfile(\"club\")` — what every " +
    "screen said before the provider existed, and there is no organization in " +
    "scope to resolve from",
  "src/lib/domain/money-mode.ts":
    "reads `.ledger` only, which is a fact about how the outfit runs its golf " +
    "rather than what it is called — a society in Boston still fronts the " +
    "minibus, and there is a test asserting no country or override can move a " +
    "behavioural flag",
};

const ALL = calls();

describe("the sweep can see, before it reports anything", () => {
  it("finds the calls that exist", () => {
    // A broken matcher reports zero offenders and reads as a clean codebase.
    expect(ALL.length, "no orgProfile calls found at all").toBeGreaterThan(8);
  });

  it("counts arguments rather than guessing", () => {
    // The console layout resolves all three. If the counter cannot see that,
    // it cannot tell a whole resolution from a partial one either.
    const layout = ALL.find((c) => c.file.includes("(app)/layout.tsx"));
    expect(layout, "the layout's call went missing").toBeTruthy();
    expect(layout!.count, "the layout should pass kind, country and noun").toBe(3);
  });

  it("does not mistake useOrgProfile for orgProfile", () => {
    // `useOrgProfile()` is the RIGHT call — it reads a profile the layout
    // resolved whole. Counting it as a bare `orgProfile()` would report every
    // correctly-wired component as a defect.
    const hookFiles = ALL.filter((c) => c.args === "" && c.count === 0);
    expect(hookFiles, "zero-argument calls are the hook, not the resolver").toEqual([]);
  });
});

describe("nothing resolves an outfit from its kind alone", () => {
  it("every one-argument call is listed with a reason", () => {
    const offenders = ALL.filter((c) => c.count <= 1)
      .filter((c) => !(c.file in KIND_ONLY_IS_FINE))
      .map((c) => `${c.file}:${c.line}  orgProfile(${c.args})`);

    expect(
      offenders,
      "orgProfile(kind) throws away the country AND the organizer's own word — " +
        "pass all three, or use useOrgProfile() inside the console",
    ).toEqual([]);
  });

  it("and the list does not outlive what it excuses", () => {
    /**
     * The other direction, and the reason this is a sweep rather than a tally.
     * An entry naming a file that no longer resolves this way would sit here
     * excusing nothing while a real reader went unchecked — the allow-list has
     * to shrink on its own.
     */
    const oneArgFiles = new Set(ALL.filter((c) => c.count <= 1).map((c) => c.file));
    const stale = Object.keys(KIND_ONLY_IS_FINE).filter((f) => !oneArgFiles.has(f));
    expect(stale, "these are excused but no longer resolve from the kind alone").toEqual([]);
  });

  it("every excuse says why", () => {
    for (const [file, reason] of Object.entries(KIND_ONLY_IS_FINE)) {
      expect(reason.length, `${file} is excused without a reason`).toBeGreaterThan(40);
    }
  });
});
