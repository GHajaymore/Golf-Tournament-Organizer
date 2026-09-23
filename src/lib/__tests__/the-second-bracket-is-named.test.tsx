import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BracketClient } from "@/components/BracketClient";
import { buildBracket, drawBrackets, type BracketMode } from "@/lib/domain/bracket";
import type { Player } from "@/lib/domain/types";

/**
 * A SECOND BRACKET IS OFFERED ONLY WHERE THERE IS ONE, AND CALLED WHAT IT IS.
 *
 * Both faults read off the seeded club's knockout on 2026-09-23, on the screen
 * an organizer runs the draw from.
 *
 * The toggle rendered ALWAYS. That knockout is `single` mode — the arrangement
 * panel directly above it says "One bracket … lose and you're out" — and the
 * organizer was still offered a Consolation tab leading to a draw that does
 * not exist. `LeaderboardBoard` had the identical fault with its flights
 * toggle and was fixed on 2026-09-11: "the toggle rendered always, and 'By
 * flight' then had nothing to offer in the two cases that matter".
 *
 * And the label was HARDCODED to "Consolation". `drawBrackets` names the
 * second bracket itself and gives a different answer per mode — "" for single,
 * "Consolation" for split, "Plate" for plate — so in plate mode the screen
 * called it one thing while the engine, and the club, called it another.
 *
 * ENUMERATED over all three modes rather than sampled on the one in front of
 * me, because that is how the same defect came back wearing a different value
 * three times in the ranking-unit axis (#565, #566).
 */

const field: Player[] = Array.from({ length: 8 }, (_, i) => ({
  id: `p${i + 1}`,
  name: `Player ${i + 1}`,
  handicap: i,
  seed: i + 1,
  groupId: null,
}));

const text = (html: string) => html.replace(/<!--[^>]*-->/g, "").replace(/<[^>]+>/g, " ");

/** The raw markup, for asking whether the TOGGLE exists rather than whether a
 *  word appears — "Winners" is also a heading inside the draw itself. */
function rawHtml(mode: BracketMode) {
  const { mainLabel, secondLabel } = drawBrackets([], mode);
  return renderToStaticMarkup(
    <BracketClient
      winners={buildBracket("winners", field, {})}
      consolation={buildBracket("consolation", [], {})}
      mainLabel={mainLabel}
      secondLabel={secondLabel}
      readOnly
    />,
  );
}

function render(mode: BracketMode) {
  // The labels the page computes and hands down — `drawBrackets([], mode)` is
  // exactly what `bracket/page.tsx` does, so this cannot drift from it.
  const { mainLabel, secondLabel } = drawBrackets([], mode);
  const winners = buildBracket("winners", field, {});
  const consolation = buildBracket("consolation", [], {});
  return text(
    renderToStaticMarkup(
      <BracketClient
        winners={winners}
        consolation={consolation}
        mainLabel={mainLabel}
        secondLabel={secondLabel}
        readOnly
      />,
    ),
  );
}

describe("the second bracket is offered only where there is one", () => {
  it("single: no toggle at all, because there is no second draw", () => {
    const body = render("single");
    expect(body, "offered a Consolation tab on a one-bracket knockout").not.toMatch(/Consolation/);
    expect(body).not.toMatch(/Plate/);
    // The control: the winners draw itself is still on the screen, so this is
    // not passing merely because nothing rendered.
    expect(body).toMatch(/Player 1/);
  });

  it("split: the two draws are FLIGHTS, because nobody dropped into either", () => {
    /**
     * This cell asserted "Winners" and "Consolation" a day earlier, and both
     * were wrong about a split. Nobody has won anything when a split is drawn
     * — it is made on qualifying rank before a ball is struck — and the
     * mode's own note refuses the word consolation for exactly that reason.
     */
    const body = render("split");
    expect(body).toMatch(/Flight A/);
    expect(body).toMatch(/Flight B/);
    expect(body, "a split has no consolation; nobody dropped into it").not.toMatch(/Consolation/);
    expect(body).not.toMatch(/Plate/);
  });

  it("plate: the second bracket is called a PLATE, which is what the engine calls it", () => {
    const body = render("plate");
    // The main draw is the MAIN DRAW. "Winners" belongs to a double
    // elimination, which is not a shape this app runs.
    expect(body).toMatch(/Main draw/);
    expect(body, "the screen said Consolation where the engine says Plate").toMatch(/Plate/);
    expect(body).not.toMatch(/Consolation/);
  });

  it("every mode agrees with drawBrackets about whether a second bracket exists", () => {
    /**
     * THE RULE, over the whole axis, rather than three separate spellings of
     * it: the toggle appears exactly when `drawBrackets` names a second
     * bracket, and carries exactly that name.
     */
    for (const mode of ["single", "split", "plate"] as BracketMode[]) {
      const label = drawBrackets([], mode).secondLabel;
      // The toggle is the radio group; "Winners" on its own is also a heading
      // inside the draw, so asking for the word would answer a different
      // question from the one being asked.
      const hasToggle = /name="brk"/.test(rawHtml(mode));
      expect(hasToggle, `${mode}: toggle present=${hasToggle}, second bracket="${label}"`).toBe(
        label !== "",
      );
      if (label !== "") {
        expect(render(mode), `${mode}: the tab does not say "${label}"`).toMatch(new RegExp(label));
      }
    }
  });
});
