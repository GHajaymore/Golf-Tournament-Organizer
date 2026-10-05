import { teardown } from "./fixture.mjs";
import { teardownCasual } from "./casual-fixture.mjs";

/**
 * Remove the fixture tournament.
 *
 * In a `finally` sense: this repo's rule is that a fixture left behind is a
 * fixture someone will later mistake for real data, and this suite is meant
 * to be safe to run against a database that also holds live tournaments.
 */
export default async function globalTeardown() {
  await teardown();
  // The casual-round spec clears its own in `afterAll`; this catches a run
  // killed part-way, before its rows can be mistaken for somebody's round.
  await teardownCasual();
}
