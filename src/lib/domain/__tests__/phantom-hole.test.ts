import { describe, it, expect } from "vitest";
import { cardFrom } from "@/lib/domain/course-directory";

/**
 * A directory that appends a hole the course does not have.
 *
 * Camarillo Springs is a real par-72 and arrived as NINETEEN holes: 1 to 18 a
 * complete, correct card, then a nineteenth carrying a par and no stroke
 * index. The length check threw the whole course away. Nineteen courses were
 * refused for having 19 holes and sixteen more for having 10 — the same defect
 * on a nine.
 *
 * The rule that fixes it is a LOOSENING, which is the safe direction only if
 * it cannot over-trim: dropping a real hole would leave a card that still
 * validates and is silently wrong, and a wrong stroke index misallocates shots
 * for the life of the course. So most of what follows tests the cases where it
 * must REFUSE to trim.
 */

const SI18 = [1, 11, 5, 7, 13, 3, 9, 17, 15, 10, 4, 14, 12, 2, 18, 8, 16, 6];
const PARS18 = [4, 4, 3, 5, 4, 3, 5, 3, 4, 5, 3, 3, 4, 5, 4, 5, 4, 4];

/** The real Camarillo Springs card, as the directory returns it. */
const holes18 = () =>
  PARS18.map((par, i) => ({
    number: i + 1,
    par,
    handicap_index: SI18[i],
    yardages: { black: 380 },
  }));

const SI9 = [7, 3, 1, 9, 5, 2, 8, 4, 6];
const PARS9 = [4, 5, 3, 4, 4, 4, 3, 4, 5];
const holes9 = () =>
  PARS9.map((par, i) => ({ number: i + 1, par, handicap_index: SI9[i], yardages: { black: 380 } }));

describe("a hole the directory invented", () => {
  it("is dropped, and the real eighteen survive", () => {
    const card = cardFrom([...holes18(), { number: 19, par: 4, handicap_index: null }]);

    expect(card.usable, "usable" in card && !card.usable ? card.reason : "").toBe(true);
    if (!card.usable) return;
    expect(card.pars).toHaveLength(18);
    expect(card.pars.reduce((a, b) => a + b, 0)).toBe(72);
    expect(card.strokeIndex).toEqual(SI18);
  });

  it("is dropped on a nine too", () => {
    const card = cardFrom([...holes9(), { number: 10, par: 4, handicap_index: null }]);

    expect(card.usable).toBe(true);
    if (!card.usable) return;
    expect(card.pars).toHaveLength(9);
    expect(card.strokeIndex).toEqual(SI9);
  });

  it("still refuses when the surplus hole HAS a stroke index", () => {
    /**
     * Then it is not a phantom — it is a card that disagrees with itself about
     * how many holes it has, and guessing which row to discard is exactly the
     * decision this module must not make on a club's behalf.
     */
    const card = cardFrom([...holes18(), { number: 19, par: 4, handicap_index: 19 }]);
    expect(card.usable).toBe(false);
  });

  it("never trims a row that is not beyond the round", () => {
    /**
     * A hole with no `number` sorts to the FRONT, so a naive slice(0, 18)
     * would keep the junk row and silently drop the real 18th — a card that
     * passes every check and allocates shots wrongly for as long as the course
     * is in the catalogue.
     *
     * What actually saves this case is the stroke-index rule: the real 18th
     * has an index, so it is not eligible to be trimmed. Recorded here as the
     * OUTCOME that must hold rather than as a test of one clause, because the
     * clause that enforces it is an implementation detail and the refusal is
     * not.
     */
    const card = cardFrom([{ par: 4, handicap_index: 0 }, ...holes18()]);
    expect(card.usable, "an unnumbered row must not cost the real 18th hole").toBe(false);
  });

  it("does not trim a course that simply has too many real holes", () => {
    // Twenty numbered holes, all with a stroke index: a genuinely strange card
    // and not ours to silently repair.
    const twenty = [
      ...holes18(),
      { number: 19, par: 4, handicap_index: 19 },
      { number: 20, par: 4, handicap_index: 20 },
    ];
    expect(cardFrom(twenty).usable).toBe(false);
  });

  it("leaves an ordinary eighteen exactly as it was", () => {
    const card = cardFrom(holes18());
    expect(card.usable).toBe(true);
    if (!card.usable) return;
    expect(card.pars).toEqual(PARS18);
    expect(card.strokeIndex).toEqual(SI18);
  });

  it("leaves an ordinary nine exactly as it was", () => {
    const card = cardFrom(holes9());
    expect(card.usable).toBe(true);
    if (!card.usable) return;
    expect(card.pars).toEqual(PARS9);
  });

  it("does not rescue a card whose remaining holes are still wrong", () => {
    /**
     * Trimming decides which rows are OFFERED to the rules. It must never be
     * able to turn a bad card into a good one — here the stroke index repeats
     * 1 and omits 18, which has to keep failing after the phantom goes.
     */
    const broken = holes18().map((h, i) => ({ ...h, handicap_index: i === 17 ? 1 : SI18[i] }));
    const card = cardFrom([...broken, { number: 19, par: 4, handicap_index: null }]);
    expect(card.usable).toBe(false);
  });

  it("still reports an empty card as empty, not as a trim", () => {
    const card = cardFrom([]);
    expect(card.usable).toBe(false);
    if (card.usable) return;
    expect(card.reason).toMatch(/no hole-by-hole card/i);
  });

  it("orders by hole number before deciding anything", () => {
    // The phantom arriving in the middle of the array must still be found.
    const shuffled: unknown[] = [...holes18()];
    shuffled.splice(4, 0, { number: 19, par: 4, handicap_index: null });
    const card = cardFrom(shuffled);
    expect(card.usable).toBe(true);
    if (!card.usable) return;
    expect(card.strokeIndex).toEqual(SI18);
  });
});
