// @ts-check
/**
 * Mutation testing of the FOUNDATION (2026-10-23). Run with `npm run mutation`
 * — see `scripts/mutation.mjs` and `docs/testing.md`, "How strong are the
 * tests". Not in CI: a run takes hours, so it is a nightly ratchet instead
 * (`npm run mutation -- --ratchet`, held to `mutation-baseline.json`).
 *
 * Only the modules that hold a rule of golf or of money are mutated: what a
 * handicap is, where its strokes fall, what a card scores, when a match is
 * over, who ranks above whom, who survives a cut, who meets whom in a draw,
 * and who owes what. A survivor in one of these is a rule nothing would notice
 * being broken.
 */
export const MUTATED_MODULES = [
  // handicap
  "src/lib/domain/handicap.ts",
  "src/lib/domain/round-handicap.ts",
  "src/lib/round-allowance.ts",
  // a side's strokes and a match's strokes off the low (allocatedStrokes, 2026-10-31)
  "src/lib/domain/team.ts",
  // a card: strokes per hole, points, to par
  "src/lib/domain/stroke.ts",
  "src/lib/domain/stroke-agg.ts",
  "src/lib/domain/card-points.ts",
  "src/lib/domain/card-totals.ts",
  // a round: match, ranking, ties, countback
  "src/lib/domain/match.ts",
  "src/lib/domain/stroke-countback.ts",
  "src/lib/domain/shared-position.ts",
  "src/lib/domain/ranked-score.ts",
  "src/lib/domain/standings.ts",
  // across rounds: cut, draw, bracket
  "src/lib/domain/cut.ts",
  "src/lib/domain/cut-ready.ts",
  "src/lib/domain/bracket.ts",
  "src/lib/domain/bracket-flights.ts",
  "src/lib/domain/draw.ts",
  // money
  "src/lib/domain/money.ts",
  "src/lib/domain/money-layout.ts",
  "src/lib/domain/derived-games.ts",
  "src/lib/domain/nassau.ts",
  "src/lib/domain/skins.ts",
  "src/lib/domain/skins-pot.ts",
  "src/lib/domain/carry.ts",
  "src/lib/domain/expenses.ts",
  "src/lib/domain/contests.ts",
  // what screens say about a date
  "src/lib/domain/date-words.ts",
];

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: "vitest",
  // The whole unit suite, sweeps included, less the two files that cannot run
  // in a sandbox — see `vitest.mutation.config.ts`.
  vitest: { configFile: "vitest.mutation.config.ts", related: false },
  // The first run measures every test against every mutant's coverage, and the
  // whole suite under coverage takes longer than the default five minutes.
  dryRunTimeoutMinutes: 30,
  plugins: ["@stryker-mutator/vitest-runner"],
  mutate: MUTATED_MODULES,
  coverageAnalysis: "perTest",
  reporters: ["json", "html", "progress", "clear-text"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  htmlReporter: { fileName: "reports/mutation/mutation.html" },
  incremental: true,
  incrementalFile: "reports/stryker-incremental.json",
  concurrency: 8,
  timeoutMS: 20000,
  tempDirName: ".stryker-tmp",
  cleanTempDir: "always",
  ignorePatterns: [
    // Anchored with a leading slash: a bare "reports" also matched
    // src/app/(app)/reports, and the sandbox lost a screen a test reads.
    "/node_modules",
    "/.next",
    "/.next-*",
    "/reports",
    "/test-results",
    "/playwright-report",
    "/android",
    "/ios",
    "/ios-shell-web",
    "/design_handoff_golf_tournament_console",
    "/*.zip",
    "/.stryker-tmp",
  ],
};

export default config;
