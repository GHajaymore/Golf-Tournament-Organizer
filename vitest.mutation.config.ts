/**
 * The unit suite as the MUTATION run sees it (`npm run mutation`, Stryker).
 *
 * The whole of `vitest.config.ts`, less ten files that cannot pass under (four below, six more at the end)
 * Stryker — measured 2026-10-23: the first two by running the suite inside an
 * instrumented sandbox (570 files, these the only failures), the third by
 * Stryker's own first run:
 *
 *   allowance-is-taken-of-the-exact-figure   its CONTROL reads `domain/handicap.ts`
 *                                            for the three lines it replaced, and
 *                                            the sandbox's copy is instrumented
 *   no-secret-is-committed                   asks git which files are tracked; the
 *                                            sandbox is not a repository
 *   dates-hydrate-at-midnight                changes `process.env.TZ` mid-run, which
 *                                            Stryker's runner (one worker, kept
 *                                            alive) does not hand to Intl — its
 *                                            control then fails, as it should
 *   icon-sprite                              holds that `IconSprite.tsx` OPENS with
 *                                            "use client"; Stryker's sandbox puts
 *                                            `// @ts-nocheck` above the first line of
 *                                            every TypeScript file (its default
 *                                            `disableTypeChecks`). Added 2026-11-04,
 *                                            when the first nightly after #960 found
 *                                            it in Stryker's first run
 *
 * Every other sweep that reads source passes on the instrumented copies, and
 * can never kill a mutant falsely: Stryker turns a mutant on at run time, not
 * by rewriting the text a sweep reads. Both files still run in CI and in
 * `npx vitest run`.
 */
import { defineConfig } from "vitest/config";
import type { TestSequencer, Vitest, TestSpecification } from "vitest/node";
import base from "./vitest.config";

export const CANNOT_RUN_IN_THE_SANDBOX = [
  "src/lib/__tests__/allowance-is-taken-of-the-exact-figure.test.ts",
  "src/lib/__tests__/no-secret-is-committed.test.ts",
  "src/lib/__tests__/dates-hydrate-at-midnight.test.ts",
  "src/lib/__tests__/icon-sprite.test.ts",
  // Added 2026-11-09. In a git worktree `node_modules` is a LINK to the main checkout's, and
  // Stryker's sandbox copy does not carry it, so these six, which read `node_modules/...`
  // directly, fail inside the sandbox and abort its dry run. They test the toolchain and the
  // lockfile, not any module under mutation, so leaving them out can kill no mutant falsely.
  "src/lib/__tests__/qa-pipeline.test.ts",
  "src/lib/__tests__/font-hosts.test.ts",
  "src/lib/__tests__/browser-image-matches-the-lockfile.test.ts",
  "src/lib/__tests__/build-retries-only-the-font-fetch.test.ts",
  "src/lib/__tests__/client-manifest-check.test.ts",
  "src/lib/__tests__/react-hydration-replay-backport.test.ts",
];

/** A test file whose every call is held to a deadline (`src/lib/__tests__/ends-within.ts`). */
export const ENDS_FILE = /\.ends\.test\.tsx?$/;

/**
 * THE FILES THAT HOLD A CALL TO A DEADLINE RUN FIRST (2026-11-09).
 *
 * Stryker runs a mutant's covering test files in the order vitest's sequencer gives
 * and stops at the first failing test (bail 1). A mutant that makes a loop endless
 * is caught only if a test FAILS before any test walks into that loop: the first
 * test to enter it hangs, and the mutant ends as a plain timeout, which the ratchet
 * counts as not caught (`scripts/qa/mutation-ratchet.mjs`). The nightly of 9 Nov
 * held production on exactly that — eight mutants of `settle`'s two lists in
 * `domain/money.ts`.
 *
 * So a `*.ends.test.ts` file, whose calls go through `endsWithin` and fail at a
 * deadline instead of hanging, is put ahead of every other file. The rest keep
 * vitest's own order (`BaseSequencer`), so no other module's mutants are run in a
 * different order than before. `mutation-ratchet.test.ts` holds it.
 *
 * `BaseSequencer` is reached by a dynamic `import()`, never a static one: vite
 * bundles a `.ts` config to CommonJS, `vitest/node` is ESM only, and a static
 * import stops the config loading at all ("ESM file cannot be loaded by
 * `require`") — which is what the first run of this on 9 Nov did.
 */
const vitestOwnSequencer = async (ctx: Vitest) => new (await import("vitest/node")).BaseSequencer(ctx);

export class EndsFirstSequencer implements TestSequencer {
  constructor(private readonly ctx: Vitest) {}

  async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    return (await vitestOwnSequencer(this.ctx)).shard(files);
  }

  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await (await vitestOwnSequencer(this.ctx)).sort(files);
    const ends = (spec: TestSpecification) => ENDS_FILE.test(spec.moduleId.split("\\").join("/"));
    return [...sorted.filter(ends), ...sorted.filter((spec) => !ends(spec))];
  }
}

// Spread, not `mergeConfig`: that CONCATENATES arrays, and the base's exclude
// list is the one to extend rather than a second one to sit beside it.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    exclude: [...(base.test?.exclude ?? []), ...CANNOT_RUN_IN_THE_SANDBOX],
    sequence: { ...base.test?.sequence, sequencer: EndsFirstSequencer },
  },
});
