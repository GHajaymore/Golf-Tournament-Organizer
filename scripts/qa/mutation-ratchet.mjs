/**
 * THE MUTATION RATCHET'S ARITHMETIC — pure, so a test can hold it without
 * running Stryker (`src/lib/__tests__/mutation-ratchet.test.ts`).
 *
 * `scripts/mutation.mjs` runs Stryker and hands its report here. Three
 * questions, each answered once:
 *
 *   scoresOf        the score of each module in a Stryker JSON report
 *   ratchetFalls    which modules in scope are below their baseline (or not
 *                   measured, or have none) — the ratchet FAILS on any
 *   raisedBaseline  the baseline after a run: each module at the HIGHER of its
 *                   old floor and its new score. It never lowers a floor; a
 *                   lower score is said and the old floor kept.
 *
 * THE ARITHMETIC CORE (2026-10-31, backlog A7). The full set in
 * `stryker.config.mjs` is hours on one machine. The nightly round mutates the
 * modules where a wrong stroke or a wrong cent is invisible on most fixtures —
 * the reason money and handicap changes keep three rounds
 * (`ARITHMETIC_KEEPS_THREE_ROUNDS` in `layers.mjs`):
 *
 *   handicap.ts         Course and Playing Handicap, rounded once (Rule 6.1, 6.2)
 *   round-handicap.ts   which figure a round prices off (frozen, committee, member)
 *   round-allowance.ts  the allowance a round plays at (Appendix C)
 *   stroke.ts           strokes by stroke index (Rule 6.2, Appendix E)
 *   team.ts             a side's strokes and a match's strokes off the low
 *   money.ts            the split to the cent, the pot, the settle-up
 *   skins.ts            who won which skin, and the carries
 *   skins-pot.ts        the skins split, and the night's purse
 *
 * `gameNets` (services/expenses.ts) is the SINK every side game's money passes
 * through, and it reads the database: the unit suite cannot reach it, so a
 * mutant of it would only ever be "no coverage". Its arithmetic is these
 * modules (`splitExactly`, `skinsPot`, `derivedNets`); the sink itself is held
 * by the audit suite (`vitest.audit.config.ts`) against real rows.
 */
import { relative, join, sep } from "node:path";

export const ARITHMETIC_CORE = [
  "src/lib/domain/handicap.ts",
  "src/lib/domain/round-handicap.ts",
  "src/lib/round-allowance.ts",
  "src/lib/domain/stroke.ts",
  "src/lib/domain/team.ts",
  "src/lib/domain/money.ts",
  "src/lib/domain/skins.ts",
  "src/lib/domain/skins-pot.ts",
];

/** The scopes a run can be asked for. "all" is every module in stryker.config.mjs. */
export function modulesOfScope(scope, all) {
  if (scope === "arithmetic") return ARITHMETIC_CORE;
  if (scope === "all") return all;
  throw new Error(`unknown mutation scope "${scope}" — arithmetic or all`);
}

const DETECTED = new Set(["Killed", "Timeout"]);
const UNDETECTED = new Set(["Survived", "NoCoverage"]);

/**
 * Score per module, from a Stryker JSON report (mutation-testing-report-schema). Paths as the repo spells them.
 * @returns {Record<string, { score: number, detected: number, undetected: number, survivors: unknown[] }>}
 */
export function scoresOf(report, root = process.cwd()) {
  /** @type {Record<string, { score: number, detected: number, undetected: number, survivors: unknown[] }>} */
  const out = {};
  for (const [file, data] of Object.entries(report.files ?? {})) {
    const rel = (relative(root, join(root, file)) || file).split(sep).join("/");
    let detected = 0;
    let undetected = 0;
    const survivors = [];
    for (const m of data.mutants ?? []) {
      if (DETECTED.has(m.status)) detected += 1;
      else if (UNDETECTED.has(m.status)) {
        undetected += 1;
        survivors.push(m);
      }
    }
    const total = detected + undetected;
    out[rel] = {
      score: total === 0 ? 100 : Math.round((detected / total) * 10000) / 100,
      detected,
      undetected,
      survivors,
    };
  }
  return out;
}

/** Every module in scope that is below its floor, unmeasured, or without a floor. Empty means the ratchet held. */
export function ratchetFalls(scores, baseline, inScope) {
  const falls = [];
  for (const file of inScope) {
    const floor = baseline[file];
    const now = scores[file];
    if (typeof floor !== "number") falls.push({ file, why: `mutated and has no baseline — add it with --write-baseline` });
    else if (!now) falls.push({ file, why: `in the baseline at ${floor}% and not measured in this run` });
    else if (now.score < floor) falls.push({ file, why: `${now.score}% is below its baseline of ${floor}%`, score: now.score, floor });
  }
  return falls;
}

/**
 * The baseline after a run of `inScope`: a floor rises to the new score, and
 * never falls. `kept` lists the modules that scored lower than their floor —
 * a baseline is not lowered by this script, ever; that is a hand edit, in a
 * commit that says why.
 */
export function raisedBaseline(baseline, scores, inScope) {
  const modules = { ...baseline };
  const kept = [];
  const missing = [];
  for (const file of inScope) {
    const now = scores[file];
    if (!now) {
      missing.push(file);
      continue;
    }
    const floor = baseline[file];
    if (typeof floor === "number" && now.score < floor) kept.push({ file, score: now.score, floor });
    else modules[file] = now.score;
  }
  return { modules, kept, missing };
}

/** One line the round's verdict reads (round.mjs keeps a command layer's first line). */
export function headline(scores, inScope, scope) {
  let d = 0;
  let u = 0;
  for (const file of inScope) {
    if (!scores[file]) continue;
    d += scores[file].detected;
    u += scores[file].undetected;
  }
  const pct = ((d / Math.max(1, d + u)) * 100).toFixed(2);
  const per = inScope
    .filter((f) => scores[f])
    .map((f) => `${f.split("/").pop()} ${scores[f].score}%`)
    .join(", ");
  return `Mutation score (${scope}): ${pct}% — ${d} of ${d + u} mutants caught; ${per}`;
}
