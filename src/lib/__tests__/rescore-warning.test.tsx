import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RescoreWarning, RESCORE_CONSEQUENCE } from "@/components/RescoreWarning";

/**
 * THE WARNING SHOWN BEFORE A DAY'S SCORING IS RE-READ.
 *
 * #392 extended the card-count guard from the format to two more settings and
 * tested the SERVER thoroughly — twelve audit cells against real rows — and
 * the screen not at all. That is the wrong half to leave: the guard's whole
 * purpose is a sentence an organizer reads while deciding, and a refusal whose
 * warning does not render is a control that silently does nothing.
 *
 * So: the block itself, with the count the decision turns on and the button
 * that names what declining keeps.
 */

const render = (el: React.ReactElement) => renderToStaticMarkup(el);
const noop = () => {};

describe("what the organizer is actually asked", () => {
  it("leads with the count, because that is the decision", () => {
    /**
     * "Re-score 37 cards" is a different question from "change the format",
     * and only the server can answer the first. The number is the whole
     * reason the warning exists rather than a blanket refusal.
     */
    const html = render(
      <RescoreWarning cards={37} consequence={RESCORE_CONSEQUENCE.format} keepLabel="Match Play"
        onConfirm={noop} onCancel={noop} />,
    );
    expect(html).toContain("37 card");
    expect(html).toContain("already has");
  });

  it("says card, not cards, for one", async () => {
    // A guard that fires on a single card is the commonest case — the first
    // player to hand one in — and "1 cards" reads as a bug in the warning.
    const html = render(
      <RescoreWarning cards={1} consequence={RESCORE_CONSEQUENCE.holes} keepLabel="18 holes"
        onConfirm={noop} onCancel={noop} />,
    );
    expect(html).toContain("1 card entered");
    expect(html).not.toContain("1 cards");
  });

  it("names what declining keeps, not just 'cancel'", () => {
    /**
     * The decline button restores the control to the STORED value, so it has
     * to say which — otherwise the dropdown goes on showing a value the round
     * does not have and nothing on screen says so.
     */
    const html = render(
      <RescoreWarning cards={4} consequence={RESCORE_CONSEQUENCE.basis} keepLabel="Gross"
        onConfirm={noop} onCancel={noop} />,
    );
    expect(html).toContain("Keep Gross");
  });

  it("offers going ahead, because this is a question and not a veto", () => {
    // An organizer who set a round up wrongly has to be able to fix it.
    const html = render(
      <RescoreWarning cards={4} consequence={RESCORE_CONSEQUENCE.holes} keepLabel="18 holes"
        onConfirm={noop} onCancel={noop} />,
    );
    expect(html).toContain("Change it anyway");
  });

  it("disables going ahead while a write is in flight", () => {
    const html = render(
      <RescoreWarning cards={4} consequence={RESCORE_CONSEQUENCE.holes} keepLabel="18 holes"
        pending onConfirm={noop} onCancel={noop} />,
    );
    expect(html).toContain("disabled");
  });
});

describe("the three sentences say different things", () => {
  /**
   * They are one claim about one fact and live together for that reason — but
   * they must not become the same sentence, or the warning stops telling an
   * organizer what THIS control does. Each names its own mechanism.
   */
  it("each explains its own setting", () => {
    expect(RESCORE_CONSEQUENCE.format).toContain("counted a different way");
    expect(RESCORE_CONSEQUENCE.holes).toContain("stroke index is re-ranked");
    expect(RESCORE_CONSEQUENCE.basis).toContain("three different orders");
  });

  it("and none of them is a copy of another", () => {
    const all = Object.values(RESCORE_CONSEQUENCE);
    expect(new Set(all).size, "two of the three warnings are identical").toBe(all.length);
  });

  it("every one of them says the results change", () => {
    // The thing a club needs to take away, whichever control they touched:
    // nothing is deleted, and that is exactly why it is easy to miss.
    for (const [key, text] of Object.entries(RESCORE_CONSEQUENCE)) {
      expect(text.toLowerCase(), `${key} does not say it re-scores`).toContain("re-scores");
    }
  });
});
