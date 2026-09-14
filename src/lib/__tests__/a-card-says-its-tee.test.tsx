import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import { ScorecardTable } from "@/components/ScorecardTable";

/**
 * A SCORECARD SAYS WHICH TEES IT WAS SCORED FROM.
 *
 * It is the one fact a marker checks before anybody hits, and the one that
 * explains the Shots row two lines below it: Course Handicap is
 * Index x Slope/113 + (CR - Par), and the slope belongs to the TEE. Two
 * players off different sets are owed different strokes off the same index,
 * which reads as an arithmetic error on a card that names no tee.
 *
 * `teeNamesForRound` has said exactly this since it was written — "every card,
 * the printed one a group carries out and the one on screen at score entry" —
 * and had ONE caller, the tee sheet on `/foursomes`. The organizer's entry
 * screen and the player's own card, the two places a card is actually filled
 * in, showed nothing.
 *
 * Measured on the development database on 2026-09-13: a venue carrying three
 * rated sets, no tee configured on the tournament, and 33 of 33 players
 * scored off "Black" by `roundTeeId`'s first-by-position fallback — a real
 * default, correctly applied, that no screen in the app mentioned.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
}));

const render = (el: React.ReactElement) => renderToStaticMarkup(el);

const CARD = {
  holes: 9,
  pars: [4, 3, 4, 5, 4, 3, 4, 4, 5],
  strokes: [4, 3, 5, 5, 4, 3, 4, 4, 5] as (number | null)[],
};

describe("the card names its tees", () => {
  it("prints the set it was scored from", () => {
    const html = render(<ScorecardTable {...CARD} tee={{ name: "Blue", rated: true }} />);
    expect(html).toContain("Blue");
    expect(html).toContain("Tees");
  });

  it("says when the set carries no rating, rather than leaving a plain number", () => {
    /**
     * `courseHandicap` returns the index UNCHANGED when a tee has no slope,
     * and its own comment calls that "a deliberate fallback... Better to keep
     * working and let the UI say the number is unrated than to block the
     * round." Nothing said it. A player on an unrated set sees a shots
     * allocation off their raw index and no reason why.
     */
    const html = render(<ScorecardTable {...CARD} tee={{ name: "Societe", rated: false }} />);
    expect(html).toContain("Societe");
    expect(html).toMatch(/unrated/i);
  });

  it("says nothing at all when there is no tee, rather than inventing one", () => {
    // A society on a borrowed card genuinely has no set. Printing "Default" or
    // guessing the first row would be worse than silence — a guessed tee is a
    // wrong Course Handicap that looks exactly like a right one.
    const html = render(<ScorecardTable {...CARD} />);
    expect(html).not.toContain("Tees");
    expect(html).not.toMatch(/unrated/i);
  });

  it("carries the tee on a card with no club mark and no course name", () => {
    /**
     * The tee line sits OUTSIDE the branded heading block deliberately. That
     * block only renders when there is a club mark or a course to lead with,
     * and a card with neither still has tees — a society's outing scored on a
     * borrowed card is exactly where "which set?" gets asked out loud.
     */
    const html = render(<ScorecardTable {...CARD} tee={{ name: "White", rated: true }} />);
    expect(html).toContain("White");
  });
});

describe("one place decides which tee a card was scored from", () => {
  /**
   * NOT a second resolution. The chain is player, then FLIGHT, then the
   * round's, and which of those may win is the committee's tee policy —
   * `teeIdFor` is the only reader of it, and `handicapsForRound` is the only
   * thing that feeds it a player's flight.
   *
   * The entry screen had its own: it read `player.teeId` directly and stopped.
   * That is wrong in three ordinary cases and each is a different wrongness —
   * a field where nobody has a personal tee shows NOTHING while being scored
   * off the round's; a club championship expressing championship/seniors/
   * ladies on the FLIGHT names the wrong set for everybody; and under the
   * `one` policy a stored preference does not merely go unused, printing it
   * contradicts a condition of competition (Rule 6.1b).
   */
  /**
   * A SCREEN WHERE A CARD IS FILLED IN — found by what it RENDERS, not by
   * what it passes.
   *
   * The first draft looked for a literal `tee={`, and missed the entry screen
   * entirely: it carries each player's tee inside its `players` array rather
   * than as a JSX prop on a card, so the sweep judged one screen and reported
   * the other clean by never looking at it. Its own control caught that, which
   * is the whole reason a sweep gets one.
   *
   * Rendering the card is the honest signal. A screen that puts a scorecard in
   * front of somebody owes them the set it was scored from, however the value
   * reaches the component.
   */
  function cardScreens(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "node_modules" && e.name !== "__tests__") walk(p);
        } else if (/[\\/]page\.tsx$/.test(p)) {
          const src = readSource(p);
          if (/<(PlayerCard|StrokePlayEntry|ScorecardTable|EntryModes)\b/.test(src)) out.push(p);
        }
      }
    };
    walk("src");
    return out;
  }

  const screens = cardScreens();

  it("finds the card screens at all — the sweep's own control", () => {
    // Without this, a renamed component makes "every screen uses the resolver"
    // true and meaningless.
    expect(
      screens.map((f) => f.replace(/\\/g, "/")),
      "no screen renders a card — the sweep is broken",
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("entry/page.tsx"),
        expect.stringContaining("me/card/page.tsx"),
      ]),
    );
  });

  it("takes the tee from handicapsForRound, never working it out again", () => {
    /**
     * THE CALL, NOT THE IMPORT — and the first draft of this line tested the
     * import. Replacing `await handicapsForRound(` with a different function
     * left the import untouched and the sweep green, which is exactly the
     * shape `source-guard.test.ts` exists for: an assertion satisfied by
     * something ADJACENT to the thing it means to pin.
     *
     * The earlier draft was worse than that. It only judged files containing
     * a bare `teeId`, and the fixed entry page contains none — so the rule
     * was vacuous for the very file it was written about.
     */
    const rolledTheirOwn = screens.filter((f) => !/handicapsForRound\s*\(/.test(readSource(f)));
    expect(
      rolledTheirOwn.map((f) => f.replace(/\\/g, "/")),
      "this screen puts a tee on a card without handicapsForRound — which is what applies the policy and the flight",
    ).toEqual([]);
  });
});
