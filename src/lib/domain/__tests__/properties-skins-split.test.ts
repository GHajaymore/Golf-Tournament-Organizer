import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { playSkins } from "../skins";
import { nightPurse, skinsPot, stakesGoBack, type PotResult } from "../skins-pot";

/**
 * THE SKINS SPLIT, AS A PROPERTY OF A WHOLE NIGHT (2026-10-31, backlog A7).
 *
 * `properties-money.test.ts` holds one game: a skin is worth the same to
 * everybody, to a cent. This holds what the bar asks of a league night of up
 * to four games, each with its own field and stake, some still being played:
 *
 *   - each game pays out exactly what went in — the stake times the entrants,
 *     counted once each however often a name is handed in;
 *   - no share is negative, fractional or NaN, and nobody loses more than the
 *     stake they put in;
 *   - nobody won a hole: every stake goes back, and the sheet says so;
 *   - the night's winnings equal the night's stakes, each player's row is the
 *     sum of their games, and the rows sum to nought;
 *   - the night is final only when no game has a hole to play.
 *
 * TourneyHQ calculates and records this; it never moves it (CLAUDE.md, Hard rule 7).
 */
const RUNS = { seed: 20261031, numRuns: 1000 } as const;

const ROSTER = ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7"];

/** One game: who is in it (with a name handed in twice now and then), their cards, a stake, holes still to play. */
const game = fc
  .record({
    entrants: fc.shuffledSubarray(ROSTER, { minLength: 2, maxLength: 8 }),
    twice: fc.boolean(),
    holes: fc.constantFrom(9, 18),
    // A stake as a screen might hand it over: mostly whole cents, now and then not.
    stake: fc.oneof(fc.integer({ min: 0, max: 10000 }), fc.double({ min: 0, max: 10000, noNaN: true })),
    unplayed: fc.integer({ min: 0, max: 3 }),
    seed: fc.array(fc.array(fc.integer({ min: 2, max: 8 }), { minLength: 18, maxLength: 18 }), { minLength: 8, maxLength: 8 }),
  })
  .map((g) => {
    const players = g.entrants.map((id, i) => ({ playerId: id, strokes: g.seed[i], courseHandicap: 0 }));
    const outcome = playSkins(players, g.holes, { net: false });
    const handedIn = g.twice ? [...g.entrants, g.entrants[0]] : g.entrants;
    return { ...g, outcome, result: skinsPot(outcome, g.stake, handedIn, g.unplayed) };
  });

describe("a skins night (each game settles on its own; the purse adds them up)", () => {
  it("every game pays out its pot to the cent, with no negative share and nobody down more than their stake", () => {
    fc.assert(
      fc.property(game, (g) => {
        const stake = Math.max(0, Math.round(g.stake));
        const r = g.result;
        expect(r.playerCount).toBe(g.entrants.length);
        expect(r.potCents).toBe(stake * g.entrants.length);
        expect(r.shares.map((s) => s.playerId).sort()).toEqual([...g.entrants].sort());
        expect(r.shares.reduce((a, s) => a + s.wonCents, 0)).toBe(r.potCents);
        for (const s of r.shares) {
          expect(Number.isInteger(s.wonCents) && s.wonCents >= 0, `${s.playerId} won ${s.wonCents}`).toBe(true);
          expect(s.stakeCents).toBe(stake);
          expect(s.netCents).toBe(s.wonCents - stake);
          expect(s.netCents).toBeGreaterThanOrEqual(-stake);
          // A player who won no skin takes nothing — unless nobody won one, when everybody takes their stake back.
          if (r.claimedSkins > 0 && s.skins === 0) expect(s.wonCents).toBe(0);
        }
        if (r.claimedSkins === 0) {
          expect(stakesGoBack(r)).toBe(true);
          expect(r.shares.every((s) => s.netCents === 0)).toBe(true);
        }
        expect(r.carryCents).toBe(0);
        expect(r.provisional).toBe(g.unplayed > 0);
      }),
      RUNS,
    );
  });

  it("the night's purse reconciles: winnings equal stakes, each row is the sum of its games, the rows sum to nought", () => {
    fc.assert(
      fc.property(fc.array(fc.option(game, { nil: null, freq: 6 }), { minLength: 1, maxLength: 4 }), (games) => {
        const results: (PotResult | null)[] = games.map((g) => (g ? g.result : null));
        const purse = nightPurse(results);
        const played = results.filter((r): r is PotResult => r !== null);

        expect(purse.wonCents).toBe(purse.stakeCents);
        expect(purse.stakeCents).toBe(played.reduce((a, r) => a + r.potCents, 0));
        expect(purse.rows.reduce((a, row) => a + row.netCents, 0)).toBe(0);
        for (const row of purse.rows) {
          const mine = played.flatMap((r) => r.shares.filter((s) => s.playerId === row.playerId));
          expect(row.games).toBe(mine.length);
          expect(row.stakeCents).toBe(mine.reduce((a, s) => a + s.stakeCents, 0));
          expect(row.wonCents).toBe(mine.reduce((a, s) => a + s.wonCents, 0));
          expect(row.netCents).toBe(row.wonCents - row.stakeCents);
          expect(row.wonCents).toBeGreaterThanOrEqual(0);
        }
        // Most up first; ties by name, so the order is the same every time it is drawn.
        for (let k = 1; k < purse.rows.length; k += 1) {
          const [a, b] = [purse.rows[k - 1], purse.rows[k]];
          expect(a.netCents > b.netCents || (a.netCents === b.netCents && a.playerId < b.playerId)).toBe(true);
        }
        expect(purse.final).toBe(played.every((r) => !r.provisional));
      }),
      RUNS,
    );
  });
});
