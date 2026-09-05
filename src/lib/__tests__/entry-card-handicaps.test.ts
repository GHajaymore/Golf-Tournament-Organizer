import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeStrokeCard,
  modifiedStablefordForHole,
  stablefordPointsForHole,
} from "../domain/stroke";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * Eighteen par 4s with a textbook stroke index. Flat on purpose: every hole is
 * worth the same, so any difference in a total below is a difference in the
 * HANDICAP, which is the whole subject of this file.
 */
const PARS = Array.from({ length: 18 }, () => 4);
const STROKE_INDEX = Array.from({ length: 18 }, (_, i) => i + 1);
const GROSS_5S = Array.from({ length: 18 }, () => 5); // gross 90, bogey every hole

/** What a Playing Handicap of 4 actually allocates: one shot on SI 1 to 4. */
const SHOTS_OFF_4 = STROKE_INDEX.map((si) => (si <= 4 ? 1 : 0));

/**
 * The entry card totals must come from the ROUND, not from the roster.
 *
 * The card printed a net total and a Stableford total derived from the raw
 * Handicap Index, while the dots printed beside them came from the
 * server-resolved Playing Handicap. Both numbers were on the same screen, so
 * the scorer could see them disagree: three to five strokes apart at a club
 * that has rated its tees, and one stroke apart at minimum ANYWHERE, because
 * Stroke Play carries a 95% allowance and needs no ratings at all to diverge.
 *
 * A committee override or a frozen card widened it further, since neither is
 * visible in the index the client held.
 */
describe("the card is scored off what the round allocated", () => {
  it("prefers the round's per-hole shots over the index it was handed", () => {
    /**
     * The two numbers that were on screen together. The index says 18 — a shot
     * a hole, net 72, and every hole a net par worth two points. The round says
     * the player plays off 4.
     *
     * Both are passed in. The round has to win.
     */
    const card = computeStrokeCard(GROSS_5S, PARS, 18, STROKE_INDEX, {
      shotsPerHole: SHOTS_OFF_4,
    });

    expect(card.gross).toBe(90);
    expect(card.net).toBe(86); // 90 - 4, not 90 - 18
    // Four net pars (2 each) and fourteen net bogeys (1 each).
    expect(card.points).toBe(4 * 2 + 14 * 1);
  });

  it("still counts only the holes actually played", () => {
    /**
     * Taking the round's allocation must not cost the proration that made a
     * part-finished card readable. Two holes played off a Playing Handicap of 4
     * is two of those four shots, not all four — otherwise a player standing on
     * the 3rd tee is shown a net score better than anything they could shoot.
     */
    const afterTwo = new Array<number | null>(18).fill(null);
    afterTwo[0] = 5;
    afterTwo[1] = 5;

    const card = computeStrokeCard(afterTwo, PARS, 18, STROKE_INDEX, {
      shotsPerHole: SHOTS_OFF_4,
    });

    expect(card.played).toBe(2);
    expect(card.gross).toBe(10);
    expect(card.net).toBe(8); // 10 - 2 shots taken so far, not 10 - 4
  });

  it("allocates on holes the ROUND gives shots on, not the ones an index would", () => {
    /**
     * The sharpest form of the same fault, and the one the dots made visible.
     * SI 5 and SI 6 get no shot off 4 and a shot each off 18, so a card opened
     * on those two holes reads differently depending on which number won —
     * while the dots beside them, drawn from `shotsByPlayer`, showed none.
     */
    const holesFiveAndSix = new Array<number | null>(18).fill(null);
    holesFiveAndSix[4] = 5;
    holesFiveAndSix[5] = 5;

    const round = computeStrokeCard(holesFiveAndSix, PARS, 18, STROKE_INDEX, {
      shotsPerHole: SHOTS_OFF_4,
    });
    const index = computeStrokeCard(holesFiveAndSix, PARS, 18, STROKE_INDEX);

    expect(round.net).toBe(10); // no shots on SI 5 and 6 off a Playing Handicap of 4
    expect(index.net).toBe(8); // what the screen used to print
  });
});

/**
 * Modified Stableford is a different table, not a different presentation.
 *
 * The entry card scored every round on the standard table while the board it
 * feeds used the right one, so the same round had two totals and the card's was
 * the one the scorer signed.
 */
describe("the card is scored on the round's own points table", () => {
  /** Two eagles and sixteen pars — the round that made the gap obvious. */
  const twoEagles = PARS.map((par, i) => (i < 2 ? par - 2 : par));

  it("reads 40 on the standard table", () => {
    const card = computeStrokeCard(twoEagles, PARS, 0, STROKE_INDEX, {
      shotsPerHole: new Array(18).fill(0),
      pointsForHole: stablefordPointsForHole,
    });
    expect(card.points).toBe(40); // 2 eagles at 4, 16 pars at 2
  });

  it("reads 10 on the modified table, which is what the board says", () => {
    const card = computeStrokeCard(twoEagles, PARS, 0, STROKE_INDEX, {
      shotsPerHole: new Array(18).fill(0),
      pointsForHole: modifiedStablefordForHole,
    });
    expect(card.points).toBe(10); // 2 eagles at 5, 16 pars at 0
  });

  it("defaults to the standard table, so no existing caller moves", () => {
    // Every other call site means standard Stableford and says nothing. The
    // option exists for the one screen that knows better, not to make the rest
    // of the app start declaring what it already meant.
    const card = computeStrokeCard(twoEagles, PARS, 0, STROKE_INDEX);
    expect(card.points).toBe(40);
  });
});

/**
 * Where those numbers have to come from.
 *
 * Read as source, for the reason `handicap-wiring.test.ts` gives at length: a
 * missed conversion has NO runtime symptom on an unrated course with no
 * override, which is every course until a club enters its ratings. The screens
 * below are a server component and a client component, so there is no unit
 * that can be handed a rated tee and asked what it renders — the assertion has
 * to be that the resolved number is the one being passed.
 */
describe("both entry screens are handed the resolved number", () => {
  it("prices a net match off the round, not off the roster index", () => {
    /**
     * `aHandicap`/`bHandicap` were the stored Handicap Index straight off the
     * player row: no slope conversion, no allowance, and no sight of a
     * committee `override` or the `frozen` value a returned card writes. The
     * client showed four shots where the server stored six.
     *
     * In hole-results mode — the first input this format offers — those dots
     * decide who won each hole, and the winner is stored AS ENTERED and never
     * recomputed. So the wrong allocation does not merely display wrong; it
     * becomes the result.
     */
    const entry = read("src/app/(app)/entry/page.tsx");
    expect(entry).toMatch(/aHandicap: state\.strokeHandicapFor\(m\.playerAId, stage\.id\)/);
    expect(entry).toMatch(/bHandicap: state\.strokeHandicapFor\(m\.playerBId, stage\.id\)/);
    // The map that used to feed them. Its absence is the fix.
    expect(entry).not.toMatch(/new Map\(state\.players\.map\(\(p\) => \[p\.id, p\.handicap\]\)\)/);
  });

  it("prices the STROKE dots off the round too, not a rebuilt map", () => {
    /**
     * The match path above was fixed and the stroke path beside it was not.
     *
     * `shotsByPlayer` — the dots printed against every hole on the card a
     * scorer signs — assembled its own `courseHandicapMap` and applied the
     * allowance by hand. That agrees with the board exactly until a
     * `RoundHandicap` row exists: a committee override, or the value
     * `freezeRoundHandicaps` writes when the first card lands, after which the
     * roster index can be edited freely. The resolver puts frozen and override
     * ahead of the member figure; the rebuild knew about neither.
     *
     * So on a round with a frozen or overridden handicap the dots, the net and
     * the Stableford total on the card being certified disagreed with the
     * leaderboard, `/me/card` and the skins pot. Nothing wrong is STORED —
     * gross only — which is why this is a medium and not a high; but the card
     * somebody signs is the one document that should not need reconciling
     * afterwards.
     */
    const entry = read("src/app/(app)/entry/page.tsx");
    expect(entry).toMatch(/const playing = state\.strokeHandicapFor\(p\.id, stage\.id\)/);
    // And the voice block, which speaks the number a player then plays off
    // without checking it against anything.
    expect(entry).toMatch(/handicapByRound\[i \+ 1\] = state\.strokeHandicapFor\(myId, stage\.id\)/);
    /**
     * No second pipeline survives on this screen.
     *
     * Each deleted piece — the flight-tee lookup, the round's configured set,
     * the policy argument — was itself a previous fix to this duplication,
     * making the copy agree with the resolver about one more thing. Banning
     * the copy is the version that stays fixed.
     */
    expect(entry).not.toMatch(/courseHandicapMap\(/);
    expect(entry).not.toMatch(/playingHandicapFrom\(/);
  });

  it("builds the stroke card from the shots it is already drawing", () => {
    // `shotsByPlayer` is what the dots beside each hole are rendered from. The
    // totals reading anything else is the two disagreeing on one screen.
    const screen = read("src/components/StrokePlayEntry.tsx");
    const call = screen.slice(screen.indexOf("computeStrokeCard("));
    expect(call).toMatch(/shotsPerHole: shotsByPlayer\[playerId\]/);
  });

  it("asks the format which points table it is on", () => {
    const screen = read("src/components/StrokePlayEntry.tsx");
    const call = screen.slice(screen.indexOf("computeStrokeCard("));
    expect(call).toMatch(/boardKind\(format\)/);
    expect(call).toMatch(/modifiedStablefordForHole/);
  });
});
