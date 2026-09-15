import { createHash } from "node:crypto";
import { basename } from "node:path";

/**
 * A FIXTURE MARK THAT ONE RUN CAN DELETE WITHOUT REACHING INTO ANOTHER'S.
 *
 * Every fixture in this repo is named with a `zz-` mark and removed by deleting
 * everything that starts with it. That is the right shape — a crashed run
 * leaves rows a later sweep can recognise as fixtures rather than as somebody's
 * real tournament — and it has one flaw that only appears with two sessions on
 * the machine:
 *
 *     await prisma.event.deleteMany({ where: { name: { startsWith: MARK } } });
 *
 * at the START of seeding. With a mark that is the same everywhere, that
 * statement deletes the OTHER run's rows, mid-run, while its tests are reading
 * them. Both runs then fail on data that vanished underneath them.
 *
 * WHAT IT LOOKS LIKE WHEN IT HAPPENS, which is the dangerous part: every test
 * times out rather than asserting, they cascade, and they take out whole files.
 * CLAUDE.md documents that exact signature and attributes it to the server
 * under the tests having died — so the next person restarts a perfectly healthy
 * server and tries again. Observed 2026-09-14 by two sessions in parallel
 * worktrees, in both directions: five `offline.spec` tests failing together and
 * then passing 5/5 in under seven seconds on a re-run, and `verify-drafting`
 * reporting seven failed checks and then a clean pass, neither with anything
 * changed in between.
 *
 * It is NOT limited to Playwright. The `verify-*` smoke scripts each seed and
 * delete their own fixture the same way, so two sessions running the same smoke
 * script collide just as surely.
 *
 * THE SUFFIX IS THE WORKTREE, not a uuid, and the choice matters in both
 * directions:
 *
 *   - Different worktrees get different marks, which is the collision this
 *     exists to stop. One session per worktree is how this repo is actually
 *     worked, so worktree identity is run identity in practice.
 *   - It is STABLE across runs in the same worktree, so the delete at the start
 *     of seeding still clears what a crashed run left behind. A uuid would be
 *     unique per run and would therefore never clean up after itself — every
 *     killed run would leave rows nothing ever removes, which trades a loud
 *     failure for a slow leak.
 *
 * Hashed rather than used raw so the mark stays short and predictable whatever
 * a worktree is called, and prefixed so it still reads as a fixture at a
 * glance: `zz-e2e-a1b2c3`.
 */
export function runMark(base, cwd = process.cwd()) {
  const name = basename(cwd) || "root";
  const suffix = createHash("sha256").update(name).digest("hex").slice(0, 6);
  return `${base}-${suffix}`;
}

/**
 * The prefix every run's mark shares, for a deliberate clean-everything sweep.
 *
 * NOT used by `seed()` — that is the whole point, and using it there would put
 * the bug straight back. It is here for a person who wants to clear fixtures
 * left by worktrees that no longer exist, and for a test that needs to assert
 * the family is recognisable.
 */
export function sweepPrefix(base) {
  return base;
}
