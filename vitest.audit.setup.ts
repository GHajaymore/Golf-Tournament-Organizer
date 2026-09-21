/**
 * The audit suite's environment, loaded once instead of once per file.
 *
 * These tests talk to a real database, so `PRISMA_DATABASE_URL` has to be in
 * `process.env` BEFORE `src/lib/db.ts` is imported — it constructs its
 * `PrismaClient` at module scope. A setup file runs before the test module is
 * loaded, which is exactly that window.
 *
 * Until this existed, every audit file carried its own `import "dotenv/config"`
 * as line 1, and 143 of 151 remembered. The eight that did not passed only when
 * something OUTSIDE the suite happened to supply the variable, and failed with
 * no expected and no received value when nothing did:
 *
 *     PrismaClientInitializationError
 *     error: Environment variable not found: PRISMA_DATABASE_URL.
 *
 * WHAT THE VARIABLE ACTUALLY WAS, measured rather than reasoned, because the
 * obvious explanation is wrong and cost a round trip. It is NOT file order.
 * `fileParallelism: false` makes files run one at a time, which reads like a
 * shared process where the first `dotenv/config` populates the env for
 * everything after it — so an env-less file would be rescued by any neighbour
 * that imports it. It is not:
 *
 *     skins-scope alone                        FAIL on env
 *     skins-scope + access-lockout (which
 *       does import dotenv, and runs first)    STILL FAIL on env
 *     skins-scope alone, variable exported
 *       in the invoking shell                  PASS, 7 tests
 *
 * Vitest isolates per file, so `process.env` does not leak between them. The
 * variable is the SHELL — and that is why this survived. CI's `verify` job sets
 * the environment itself, so all 151 pass there and always have; a developer
 * whose shell already carries the value sees 151 too. A clean shell running the
 * exact command CLAUDE.md prescribes before committing sees `8 failed`.
 *
 * So the honest statement is not "these tests never ran". It is that their
 * result depended on the environment of whoever invoked them, which is the same
 * defect one level out: a file that passes because of something it does not
 * declare is a file that will fail under a filtered re-run, `--changed`, or a
 * future `fileParallelism: true` — and the eight were `skins-scope`,
 * `round-codes` and `identity-repair` among them, which is money and
 * authorization, the category that lives in this config precisely because it is
 * only provable against real rows.
 *
 * A guard you must remember to call is a guard that will be forgotten. The
 * existing 143 imports are left alone: they are harmless, and removing them is
 * a 143-file diff that changes no behaviour. What matters is that the 152nd
 * audit file is correct without its author knowing this rule exists.
 */
import "dotenv/config";
