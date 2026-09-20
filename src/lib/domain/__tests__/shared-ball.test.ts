import { describe, it, expect } from "vitest";
import { sharedBallRound, perPlayerPotRefusal } from "../shared-ball";
import { GOLF_FORMATS } from "../../formats";
import { readSource } from "../../__tests__/source";

/**
 * A POT DECIDED BETWEEN PLAYERS CANNOT RUN ON A ROUND WITH ONE BALL PER SIDE.
 *
 * Found on 2026-09-20 by putting a real £5 skins pot on a seeded foursomes and
 * opening the money screen: "Nothing settled yet" over eight complete cards,
 * and it would have said that for ever. No per-player cards exist for a
 * shared-ball round — `round-cards.ts` keeps them out deliberately, because
 * "inventing an individual score would pay a skin to a player who never hit
 * the shot" — so there are no standings to settle and the stake never comes
 * back to anybody.
 *
 * The rule is about golf, not storage: partners playing alternate shot have
 * one score between them, and skins asks who won the hole ALONE.
 */

describe("a round where the side plays one ball", () => {
  it("is every alternate-shot family format", () => {
    for (const name of ["Foursomes", "Alternate Shot", "Greensomes", "Chapman / Pinehurst", "Scramble", "Texas Scramble"]) {
      expect(sharedBallRound(name), name).toBe(true);
    }
  });

  it("is not a four-ball, where everybody plays their own", () => {
    // The distinction that makes the rule narrow enough to be right: a
    // four-ball is a TEAM format and still has a card per player, so its pot
    // settles exactly as an individual round's does.
    for (const name of ["Four-Ball", "Best Ball", "Stroke Play", "Stableford", "Match Play"]) {
      expect(sharedBallRound(name), name).toBe(false);
    }
  });

  it("agrees with the format catalogue rather than a second list", () => {
    // The control: whatever the catalogue calls single-ball is what this says,
    // so a format added later is covered the day it is added.
    for (const f of GOLF_FORMATS) {
      expect(sharedBallRound(f.name), f.name).toBe(f.ball === "single");
    }
  });

  it("refuses a per-player pot, and names the format", () => {
    const refusal = perPlayerPotRefusal("Foursomes");
    expect(refusal).toContain("Foursomes");
    expect(refusal).toContain("one ball per side");
    // And says what to do instead, which every refusal in this app owes.
    expect(refusal).toContain("everyone plays their own ball");
  });

  it("allows one everywhere else", () => {
    expect(perPlayerPotRefusal("Four-Ball")).toBeNull();
    expect(perPlayerPotRefusal("Stroke Play")).toBeNull();
    // An unknown format falls back to the catalogue's default rather than
    // refusing: a guard that refuses what it does not recognise would block a
    // real round the day a format is added.
    expect(perPlayerPotRefusal("zz-not-a-format")).toBeNull();
  });
});

/**
 * EVERY SCREEN THAT OFFERS A POT ASKS FIRST.
 *
 * The rule landed with the two WRITES refusing it (`saveSkinsPot`,
 * `saveSideGame`) and one screen explaining it. That left two more offering
 * controls that could only ever be rejected on save:
 *
 *   /prizes              the club's own pots — the screen an organizer
 *                        actually sets money up on, found 2026-09-20
 *   the casual round     its own write path through Prisma, which reached
 *                        neither action, so a foursomes there could take a
 *                        real stake for a pot that never settles
 *
 * A guard on some of the paths is a guard on none of them, and a control that
 * takes an answer and then rejects it is worse than one that says what it
 * cannot do. This is the sweep, so the next screen to grow a pot is caught by
 * a failing test rather than by somebody walking a seeded foursomes.
 */
describe("the screens and writes that offer a per-player pot", () => {
  const asks = (path: string) => readSource(path);

  it("is asked by both writes", () => {
    expect(asks("src/app/actions/skins.ts")).toMatch(/perPlayerPotRefusal\(/);
    expect(asks("src/app/actions/side-games.ts")).toMatch(/perPlayerPotRefusal\(/);
  });

  it("is asked by every screen that offers one", () => {
    for (const screen of [
      "src/app/(app)/group-games/page.tsx",
      "src/app/(app)/prizes/page.tsx",
    ]) {
      expect(asks(screen), `${screen} offers a pot without asking`).toMatch(
        /perPlayerPotRefusal\(/,
      );
    }
  });

  it("GATES on the answer rather than merely mentioning it", () => {
    /**
     * The first draft of the test above asserted only that the symbol appears,
     * and a mutation proved that worthless: disabling both gates on `/prizes`
     * left the refusal's own `{perPlayerPotRefusal(week.format)}` inside the
     * now-unreachable card, the sweep went on passing, and the screen offered
     * every pot again. Presence is not reachability — the same class as the
     * comment-satisfies-the-regex trap `readSource` exists for, one step along.
     *
     * So this pins the CONDITIONS. Brittle to a refactor by design: a refactor
     * of a money guard is a thing that should have to be read, and a test that
     * fails loudly beats a sweep that passes quietly.
     */
    const prizes = asks("src/app/(app)/prizes/page.tsx");
    // The pots are shown only when the round can settle one …
    expect(prizes, "the skins pot is no longer gated").toMatch(
      /perPlayerPotRefusal\(week\.format\)\s*\?/,
    );
    // … and the side bets are hidden on the rounds that cannot.
    expect(prizes, "the side bets are no longer gated").toMatch(
      /!perPlayerPotRefusal\(week\.format\)/,
    );
  });

  it("is asked by the casual round, which writes its own pot", () => {
    /**
     * `actions/match-setup.ts` creates `skinsPot` and `sideGame` straight
     * through Prisma, so neither action above protects it. The refusal lives
     * in `planMatch`, which is the validator that path does go through — and
     * which the setup screen also calls, so the button and the action agree.
     */
    expect(asks("src/lib/domain/quick-match.ts")).toMatch(/perPlayerPotRefusal\(/);
    expect(asks("src/components/NewMatchForm.tsx")).toMatch(/sharedBallRound\(/);
  });
});
