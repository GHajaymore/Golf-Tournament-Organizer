// Skins: every hole is a prize, won only outright.
//
// The whole character of the format is the carry. Tie a hole and nobody takes
// it — its value rolls into the next one, and the pot keeps building until
// somebody wins a hole alone. That is why a skins game can be decided on the
// 18th by a player who has won nothing all day, and why the running carry has
// to be visible rather than just the final tally.

export interface SkinsPlayer {
  playerId: string;
  strokes: (number | null)[];
  /** Course handicap; ignored when the game is played gross. */
  courseHandicap: number;
}

export interface SkinResult {
  hole: number;
  /** Winner, or null when the hole was tied and carried. */
  playerId: string | null;
  /** Skins claimed here: 1 plus everything carried in. */
  value: number;
  /** The score that won it, for display. */
  score: number | null;
  /** True when this hole was tied and its value moved on. */
  carried: boolean;
}

export interface SkinsStanding {
  playerId: string;
  skins: number;
  holesWon: number[];
}

export interface SkinsOutcome {
  holes: SkinResult[];
  standings: SkinsStanding[];
  /** Skins still unclaimed — a tie on the final hole leaves value on the table. */
  unclaimed: number;
}

import { holeStrokesReceived , allocationHoles } from "./stroke";

/**
 * Play out a skins game.
 *
 * `net` applies each player's handicap strokes per hole, which is what makes
 * skins playable across mixed ability — gross skins in a field with a 20-shot
 * spread are simply a scratch player's game.
 *
 * A hole nobody has completed is not scored and does not carry: it hasn't
 * happened yet. Only a genuine tie carries.
 */
export function playSkins(
  players: SkinsPlayer[],
  holeCount: number,
  opts: { net: boolean; strokeIndex?: number[] } = { net: false },
): SkinsOutcome {
  const results: SkinResult[] = [];
  const skinsBy = new Map<string, SkinsStanding>();
  for (const p of players) skinsBy.set(p.playerId, { playerId: p.playerId, skins: 0, holesWon: [] });

  let carry = 0;

  for (let h = 0; h < holeCount; h += 1) {
    const scores = players
      .map((p) => {
        const gross = p.strokes[h];
        if (gross == null || !Number.isFinite(gross)) return null;
        const shots =
          opts.net && opts.strokeIndex
            ? holeStrokesReceived(p.courseHandicap, opts.strokeIndex[h] ?? 18, allocationHoles(opts.strokeIndex.length))
            : 0;
        return { playerId: p.playerId, score: gross - shots };
      })
      .filter((s): s is { playerId: string; score: number } => s !== null);

    // Fewer than two scores is not a contest — the hole is still in progress.
    if (scores.length < 2) continue;

    const best = Math.min(...scores.map((s) => s.score));
    const winners = scores.filter((s) => s.score === best);
    const value = carry + 1;

    if (winners.length === 1) {
      const w = winners[0];
      const standing = skinsBy.get(w.playerId)!;
      standing.skins += value;
      standing.holesWon.push(h + 1);
      results.push({ hole: h + 1, playerId: w.playerId, value, score: best, carried: false });
      carry = 0;
    } else {
      results.push({ hole: h + 1, playerId: null, value, score: best, carried: true });
      carry = value;
    }
  }

  const standings = [...skinsBy.values()].sort(
    (a, b) => b.skins - a.skins || a.playerId.localeCompare(b.playerId),
  );

  return { holes: results, standings, unclaimed: carry };
}
