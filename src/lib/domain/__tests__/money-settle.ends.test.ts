import { describe, it, expect } from "vitest";
import { settle } from "../money";
import { endsWithin } from "../../__tests__/ends-within";

/**
 * `settle` ENDS, whatever the ledger (2026-11-09) — and says who hands what to whom.
 *
 * The nightly round G24-1 (main 308c1322) held production on `money.ts`: 87 of 101 mutants caught
 * against a floor of 95. The eight between were mutants of the two lists `settle` builds before
 * its loop — who owes, who is owed:
 *
 *   debtors   `.filter(n => n.netCents < 0)` widened to every player (`nets`, `() => true`, `>= 0`),
 *             or `owed: -n.netCents` turned to `+n.netCents`
 *   creditors `.filter(n => n.netCents > 0)` widened (`nets`, `() => true`) or turned (`<= 0`),
 *             or `{ id, due }` emptied to `{}`
 *
 * Each puts somebody with a NEGATIVE amount at the head of a list the loop is still reading; the
 * payment comes out negative, never brings either side to nought, and the loop never ends. No
 * assertion is reached, the mutated line is not passed again (so Stryker's hit limit never stops
 * it), and the mutant ends as a plain timeout — not caught, in the ratchet's arithmetic. Every
 * call here goes through `endsWithin` (`src/lib/__tests__/ends-within.ts`), so each of those eight
 * FAILS within its deadline on every machine, and this file runs first in a mutant's run
 * (`vitest.mutation.config.ts`). The `{}` mutant also throws on its own once two creditors are
 * sorted (`a.id` is undefined); the deadline catches it with one.
 *
 * Worked by hand, in whole cents (TourneyHQ records who owes what; it never moves money):
 * the biggest debt pays the biggest credit first, as much as both can match, and whichever side
 * reaches nought steps on.
 */
const nets = (...rows: Array<[string, number]>) => rows.map(([playerId, netCents]) => ({ playerId, netCents }));
const pays = (fromPlayerId: string, toPlayerId: string, cents: number) => ({ fromPlayerId, toPlayerId, cents });

describe("settle ends, whatever the ledger", () => {
  it("more is due to the creditors than the debtors owe: the 100 owed moves, and the other 200 of credit waits", () => {
    // a owes 100, b is due 300. a pays b 100; a is square, nobody else owes: done.
    expect(endsWithin(() => settle(nets(["a", -100], ["b", 300])))).toEqual([pays("a", "b", 100)]);
  });

  it("more is owed by the debtors than the creditors are due: the 100 due moves, and the other 200 of debt waits", () => {
    // a owes 300, b is due 100. a pays b 100; b is square, nobody else is due: done.
    expect(endsWithin(() => settle(nets(["a", -300], ["b", 100])))).toEqual([pays("a", "b", 100)]);
  });

  it("two owe and two are due, to the cent: three handovers, biggest first", () => {
    // Owed: A 700, B 300. Due: C 600, D 400 (1000 each side).
    // A pays C 600 (C square; A still owes 100), A pays D 100 (A square; D still due 300),
    // B pays D 300 (both square).
    expect(endsWithin(() => settle(nets(["A", -700], ["B", -300], ["C", 600], ["D", 400])))).toEqual([
      pays("A", "C", 600),
      pays("A", "D", 100),
      pays("B", "D", 300),
    ]);
  });
});
