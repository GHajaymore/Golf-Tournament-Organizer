/**
 * The unit suite as the MUTATION run sees it (`npm run mutation`, Stryker).
 *
 * The whole of `vitest.config.ts`, less three files that cannot pass under
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
 *
 * Every other sweep that reads source passes on the instrumented copies, and
 * can never kill a mutant falsely: Stryker turns a mutant on at run time, not
 * by rewriting the text a sweep reads. Both files still run in CI and in
 * `npx vitest run`.
 */
import { defineConfig } from "vitest/config";
import base from "./vitest.config";

export const CANNOT_RUN_IN_THE_SANDBOX = [
  "src/lib/__tests__/allowance-is-taken-of-the-exact-figure.test.ts",
  "src/lib/__tests__/no-secret-is-committed.test.ts",
  "src/lib/__tests__/dates-hydrate-at-midnight.test.ts",
];

// Spread, not `mergeConfig`: that CONCATENATES arrays, and the base's exclude
// list is the one to extend rather than a second one to sit beside it.
export default defineConfig({
  ...base,
  test: { ...base.test, exclude: [...(base.test?.exclude ?? []), ...CANNOT_RUN_IN_THE_SANDBOX] },
});
