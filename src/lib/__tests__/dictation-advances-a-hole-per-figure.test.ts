import { describe, it, expect } from "vitest";
import { parseStrokesTranscript, expandDigitRuns } from "@/lib/domain/stroke";

/**
 * SAYING A CARD STRAIGHT THROUGH FILLS A HOLE PER FIGURE.
 *
 * Reported from the player app on 2026-09-21: dictation should advance the way
 * typing "4 5 3 6" already does. It did not — speech recognition returns what
 * it heard, so reading a card at speed gives the single token `4536`, which
 * `/^\d+$/` matched and scored ONE hole 4536.
 */

const PARS_9 = [4, 3, 4, 3, 4, 5, 4, 4, 3];

describe("a run of figures is a run of holes", () => {
  it("reads a card said at speed", () => {
    expect(parseStrokesTranscript("4536", PARS_9, 0)).toEqual([4, 5, 3, 6]);
  });

  it("reads the same card said slowly, exactly as before", () => {
    // THE CONTROL. Spacing them was always understood, and must stay so — this
    // change must not be a new parser, only a wider one.
    expect(parseStrokesTranscript("4 5 3 6", PARS_9, 0)).toEqual([4, 5, 3, 6]);
    expect(parseStrokesTranscript("four five three six", PARS_9, 0)).toEqual([4, 5, 3, 6]);
  });

  it("still understands golf, mixed in with the figures", () => {
    // Words and figures in one breath, which is how people actually talk.
    // Hole 1 par 4 -> birdie 3; then 5; hole 3 par 4 -> par 4; then 6.
    expect(parseStrokesTranscript("birdie 5 par 6", PARS_9, 0)).toEqual([3, 5, 4, 6]);
  });

  it("keeps ten, eleven and twelve whole, because they are real scores", () => {
    /**
     * The only interesting case. Splitting "10" would give a 1 and a 0, and 0
     * is not a score — so these three stay one hole. `NUMBER_WORDS` goes to
     * twelve for the same reason.
     */
    expect(parseStrokesTranscript("10", PARS_9, 0)).toEqual([10]);
    expect(parseStrokesTranscript("4 11 5", PARS_9, 0)).toEqual([4, 11, 5]);
    expect(parseStrokesTranscript("12", PARS_9, 0)).toEqual([12]);
  });

  it("advances from where the card has got to", () => {
    // The back nine spoken after the turn lands on the back nine. `startIndex`
    // is the first empty hole, which is what the screen passes.
    expect(parseStrokesTranscript("44", PARS_9, 7)).toEqual([4, 4]);
    expect(parseStrokesTranscript("444", PARS_9, 7)).toEqual([4, 4]);
  });

  it("drops a run containing a zero rather than guessing at it", () => {
    /**
     * 0 is not a score, so "405" is not four, nothing, five — it is a run this
     * cannot read. Dropping just the 0 would guess, and a wrong guess does not
     * lose one hole: every score after it moves up one.
     *
     * `parseTypedCard` set this rule for typed cards in the same words — "a
     * card is not the place to guess" — and this follows it rather than
     * inventing a second philosophy for spoken ones.
     */
    expect(expandDigitRuns(["405"])).toEqual([]);
    expect(parseStrokesTranscript("405", PARS_9, 0)).toEqual([]);
    // And it takes only the run with it: the figures either side still read.
    expect(parseStrokesTranscript("4 405 5", PARS_9, 0)).toEqual([4, 5]);
  });

  it("leaves single figures and words untouched", () => {
    // The expansion must be a no-op on everything that already worked.
    expect(expandDigitRuns(["4", "par", "birdie", "10"])).toEqual(["4", "par", "birdie", "10"]);
  });

  it("stops at the end of the card rather than running past it", () => {
    // Nine pars, twelve figures said. The extra three are dropped, not wrapped
    // onto the front nine again.
    expect(parseStrokesTranscript("444444444555", PARS_9, 0)).toHaveLength(9);
  });
});
