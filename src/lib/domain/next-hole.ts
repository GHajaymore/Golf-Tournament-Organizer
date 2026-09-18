/**
 * The next hole this player has to write down, in the order they are PLAYING
 * the course — or null when every hole is in.
 *
 * Not "the first empty box". A group sent off the 10th on a two-tee start
 * plays 10–18 and then 1–9, so after four holes their first empty box is hole
 * 1 and the hole they are standing on is 14. Today's big button names this
 * number, so the wrong one is a player told to enter a hole they are nowhere
 * near.
 *
 * `startHole` outside 1..holes (unset, or a sheet from a longer course) is
 * read as 1, the ordinary start.
 */
export function nextHoleToPlay(strokes: ReadonlyArray<number | null>, startHole: number): number | null {
  const holes = strokes.length;
  if (holes === 0) return null;
  const start = Number.isInteger(startHole) && startHole >= 1 && startHole <= holes ? startHole : 1;
  for (let k = 0; k < holes; k += 1) {
    const hole = ((start - 1 + k) % holes) + 1;
    const s = strokes[hole - 1];
    if (s === null || s === undefined) return hole;
  }
  return null;
}
