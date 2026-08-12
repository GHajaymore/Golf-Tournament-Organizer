import { teardown } from "./fixture.mjs";

/**
 * Remove the fixture tournament.
 *
 * In a `finally` sense: this repo's rule is that a fixture left behind is a
 * fixture someone will later mistake for real data, and this suite is meant
 * to be safe to run against a database that also holds live tournaments.
 */
export default async function globalTeardown() {
  await teardown();
}
