import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/tournament", () => ({ recordTieResult: vi.fn() }));

import { KnockoutToPlay } from "@/components/KnockoutToPlay";

/**
 * EACH TIE IN "TO PLAY" IS ITS OWN FORM (round bracket-defaults-2, 2026-10-31).
 *
 * The rows of the secretary's To play list once sat in the list's one card with
 * a plain button each. The button nearest a later row's winner — the card's,
 * which is where the control crawl and the text-box sweep look, and where a
 * person on a phone reaches — was the FIRST row's, so a winner chosen in the
 * third tie of a flight was refused "Choose who won." up in the first tie, off
 * the screen. Every row is now a form of its own: its radios, its "How it was
 * settled", its margin box and its one submit button "Record result" (a result
 * moves the draw and leaves this list; it is not a setting saved here), so
 * Enter in the margin and the press both act on that tie and the refusal is
 * said inside it.
 */
const tie = (n: number) => ({
  key: `zz-f${n}-0-0`,
  a: { id: `zz-a${n}`, name: `Zara Invented${n}` },
  b: { id: `zz-b${n}`, name: `Yusuf Madeup${n}` },
});

describe("the To play list", () => {
  const html = renderToStaticMarkup(
    <KnockoutToPlay
      waiting={0}
      groups={[
        { draw: "Flight A", round: "Round 1", playBy: null, ties: [tie(1), tie(2)] },
        { draw: "Flight B", round: "Round 1", playBy: null, ties: [tie(3)] },
      ]}
    />,
  );
  const rows = html.split("<li data-tie-row=").slice(1);

  it("draws one row per tie", () => {
    expect(rows).toHaveLength(3);
  });

  it("makes every row one form holding all of its controls and its one submit button", () => {
    for (const row of rows) {
      const body = row.slice(0, row.indexOf("</li>"));
      expect(body.match(/<form\b/g), `a tie row is not one form: ${body.slice(0, 80)}`).toHaveLength(1);
      const inForm = body.slice(body.indexOf("<form"), body.lastIndexOf("</form>"));
      for (const control of ["type=\"radio\"", "<select", "aria-label=\"Margin, "]) {
        expect(inForm, `${control} sits outside its row's form`).toContain(control);
      }
      const buttons = inForm.match(/<button\b[^>]*>/g) ?? [];
      expect(buttons, "a tie row's form has one button").toHaveLength(1);
      expect(buttons[0]).toContain('type="submit"');
      expect(inForm).toContain(">Record result</button>");
    }
  });

  it("has no button outside a row's form that a control could be saved by", () => {
    const outside = html.replace(/<form\b[\s\S]*?<\/form>/g, "");
    expect(outside).not.toMatch(/<button\b/);
  });
});
