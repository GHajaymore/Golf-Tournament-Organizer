import { runInThisContext } from "node:vm";

/**
 * A CALL THAT MUST END, held to a deadline (2026-11-09).
 *
 * A broken rule can turn a loop endless, and an endless loop cannot be failed by
 * an assertion: the assertion is never reached, and a synchronous loop ignores
 * the test's own timeout. Under Stryker such a mutant then ends as a plain
 * TIMEOUT, which the mutation ratchet counts as NOT caught
 * (`scripts/qa/mutation-ratchet.mjs`, "what counts as caught") — unless the loop
 * passes the mutated line again and Stryker's hit limit stops it. A mutant in a
 * list built BEFORE the loop (`settle`'s debtors and creditors, `domain/money.ts`)
 * is never passed again, so it never is: the nightly of 9 Nov 2026 counted eight
 * of those as not caught, where Stryker's own table counted them as caught.
 *
 * `endsWithin` runs the call inside `vm.runInThisContext` with a timeout. V8
 * stops whatever JavaScript is running at the deadline, in whichever function,
 * and the call throws `ERR_SCRIPT_EXECUTION_TIMEOUT`: a FAILED test, the same on
 * every machine. The deadline bounds a hang; it does not measure speed — a
 * correct call is microseconds, so a slow runner is a thousand times inside it.
 *
 * A file that uses it is named `*.ends.test.ts`, and the mutation run sorts those
 * files FIRST (`vitest.mutation.config.ts`): Stryker stops a mutant's run at the
 * first failing test, so the deadline must fail before any other test walks into
 * the same loop without one. `mutation-ratchet.test.ts` holds both halves.
 */
export const DEADLINE_MS = 2000;

let calls = 0;

export function endsWithin<T>(call: () => T, ms: number = DEADLINE_MS): T {
  calls += 1;
  const slot = `__endsWithin${calls}`;
  const global = globalThis as unknown as Record<string, unknown>;
  global[slot] = call;
  try {
    return runInThisContext(`globalThis.${slot}()`, { timeout: ms }) as T;
  } finally {
    delete global[slot];
  }
}
