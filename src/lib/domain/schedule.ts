// Round-robin schedule generation (circle method): every player meets every
// other in their group exactly once, spread across balanced rounds.

export interface ScheduledPairing {
  round: number;
  aId: string;
  bId: string;
}

/**
 * Single round robin for one group. With an odd number of players a "bye"
 * sits out each round (that pairing is omitted). Rounds are 1-based.
 */
export function roundRobinSchedule(playerIds: string[]): ScheduledPairing[] {
  const ids = [...playerIds];
  const bye = "__bye__";
  if (ids.length % 2 === 1) ids.push(bye);

  const n = ids.length;
  const rounds = n - 1;
  const half = n / 2;
  const pairings: ScheduledPairing[] = [];

  // Fix the first element, rotate the rest.
  const arr = [...ids];
  for (let r = 0; r < rounds; r += 1) {
    for (let i = 0; i < half; i += 1) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== bye && b !== bye) {
        pairings.push({ round: r + 1, aId: a, bId: b });
      }
    }
    // Rotate (keep index 0 fixed).
    const last = arr[n - 1];
    for (let i = n - 1; i > 1; i -= 1) arr[i] = arr[i - 1];
    arr[1] = last;
  }

  return pairings;
}

/** Total matches for a single round robin of `n` players: n*(n-1)/2. */
export function roundRobinMatchCount(n: number): number {
  return (n * (n - 1)) / 2;
}
