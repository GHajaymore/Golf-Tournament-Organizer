import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerCard } from "@/components/PlayerCard";
import { readSource } from "./source";

/**
 * A PLAYER CAN SAY THEIR CARD IS WRONG.
 *
 * Certify is a statement under Rule 3.3b that these hole scores ARE right, and
 * until now it was the only answer this screen took. Match play has had the
 * opposite since it was written — `disputeMatch`, called from score entry —
 * and stroke play had no door at all: `disputeScorecard` existed, authorized
 * and audited, reachable from nothing. Found by the reachability guard
 * (#339).
 *
 * So the app could RENDER a disputed card — `cardStanding` gives it a problem
 * tone, `reviewCards` refuses to blanket-approve one, `statusAfterEdit`
 * deliberately will not clear it — and could never PRODUCE one.
 *
 * It matters most in the case this format is built around, and the schema says
 * so: stroke play grew a certification step "once one person in a fourball
 * could enter three other people's rounds". A player who opens a card somebody
 * else filled in and finds a 6 where they made a 4 needs to be able to say so.
 */

const render = (over: Partial<Parameters<typeof PlayerCard>[0]> = {}) =>
  renderToStaticMarkup(
    <PlayerCard
      stageId="s1"
      playerId="p1"
      playerName="A. Moore"
      roundLabel="Round 1"
      holes={18}
      pars={new Array(18).fill(4)}
      yards={new Array(18).fill(400)}
      strokeIndex={Array.from({ length: 18 }, (_, i) => i + 1)}
      status="entered"
      initialStrokes={new Array(18).fill(4)}
      {...over}
    />,
  );

describe("the control on a player's own card", () => {
  it("is offered on a card that has scores on it", () => {
    expect(render({ status: "entered" })).toContain("Something on this card is wrong");
  });

  it("is offered after signing, which is when it matters most", () => {
    /**
     * A certified card is one the marker has vouched for. Editing it silently
     * is exactly what certification exists to prevent — `statusAfterEdit`
     * knocks it back to `entered` — so "this is wrong" has to be sayable
     * WITHOUT quietly rewriting the numbers being objected to.
     */
    expect(render({ status: "certified" })).toContain("Something on this card is wrong");
  });

  it("is not offered on a card the committee has accepted", () => {
    /**
     * `disputeScorecard` refuses a locked card outright, so a button here
     * would be one that only ever errors. The approved branch shows the card
     * read-only and says who to ask.
     */
    const html = render({ status: "approved" });
    expect(html).not.toContain("Something on this card is wrong");
    expect(html).toContain("approved by the committee");
  });

  it("is not offered on a card with nothing on it", () => {
    // There is nothing to be wrong about, and the action refuses a card that
    // does not exist yet with "There's no card to dispute yet."
    expect(render({ status: "entered", initialStrokes: new Array(18).fill(null) })).not.toContain(
      "Something on this card is wrong",
    );
  });

  it("says so instead, once it has been flagged", () => {
    // Not a second button. A player who has already objected wants to know it
    // landed, and offering the same action again reads as it not having.
    const html = render({ status: "disputed" });
    expect(html).not.toContain("Something on this card is wrong");
    expect(html).toContain("Flagged as wrong");
  });

  it("asks again before it writes", () => {
    /**
     * Flagging a card stops the committee accepting it — a real consequence
     * for everybody in the group, not a toggle.
     *
     * Asserted from SOURCE, not from the markup: `ConfirmButton` is a
     * two-step control and its armed wording only appears after the first tap,
     * so a rendered-HTML check for "Flag it" was testing the resting state and
     * passing for the wrong reason.
     */
    const s = readSource("src", "components", "PlayerCard.tsx");
    const block = s.slice(s.indexOf("Something on this card is wrong") - 400, s.indexOf("Something on this card is wrong") + 400);
    expect(block, "the dispute is a plain button with no confirmation").toContain("ConfirmButton");
    expect(block).toContain('confirmLabel="Flag it"');
  });
});

describe("how it sends", () => {
  const src = () => readSource("src", "components", "PlayerCard.tsx");

  it("calls the action", () => {
    expect(src(), "no screen reaches disputeScorecard").toContain("disputeScorecard(");
  });

  it("does NOT save the card on the way", () => {
    /**
     * THE ONE THING THIS MUST NOT DO, and the opposite of what `certify` does
     * two lines below it.
     *
     * Certify saves first — signing is a statement that these numbers are
     * right, so the server must have them. A dispute is the opposite
     * statement: that whatever the server is holding should not be accepted.
     * Writing this phone's version on the way would quietly correct the very
     * numbers being objected to, and the objection would then be about a card
     * that no longer says what it said.
     */
    const s = src();
    const handler = s.slice(s.indexOf("const dispute ="), s.indexOf("const certify ="));
    expect(handler, "the dispute handler is gone").not.toBe("");
    expect(handler).toContain("disputeScorecard(");
    expect(handler, "the dispute path is saving the card first").not.toContain("saveScorecard(");
  });

  it("puts the state back when the server refuses", () => {
    /**
     * Optimistic on the label only. A player told their objection was recorded
     * when it was not is worse than one told it failed — they stop chasing it.
     */
    const s = src();
    const handler = s.slice(s.indexOf("const dispute ="), s.indexOf("const certify ="));
    expect(handler).toContain("setState(before)");
    expect(handler).toContain("setError(");
  });
});
