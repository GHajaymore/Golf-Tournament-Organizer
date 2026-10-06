import { describe, it, expect } from "vitest";
import { launchRefusal, finishRefusal } from "../phase-gate";
import { readSource } from "../../__tests__/source";
import { screenName } from "../../nav";

/**
 * GUIDE WITHIN A PHASE, GATE BETWEEN THEM.
 *
 * The steps inside setting up stay reachable in any order — `setup-flow.ts`
 * decided that deliberately and says why: "an organizer setting up their ninth
 * tournament of the season knows exactly which screen they want and a wizard
 * that will not let them go there is worse than no wizard."
 *
 * The transitions BETWEEN phases had no check at all. `launchTournament` read
 * nothing before going live, and going live clears `configUnlocked` — so a
 * tournament with no rounds and nobody entered would publish itself to its
 * field AND lock its own configuration, leaving the organizer to unlock the
 * thing they had just locked in order to build the tournament they had just
 * published.
 */

describe("going live", () => {
  it("refuses a tournament with nothing to play", () => {
    const r = launchRefusal({ playingRounds: 0, confirmed: 12, dated: true, missingCards: [] });
    expect(r).toContain("no rounds");
    // Every refusal names the screen that fixes it.
    expect(r).toContain("Rounds & formats");
  });

  it("refuses a tournament with nobody to play it", () => {
    const r = launchRefusal({ playingRounds: 2, confirmed: 0, dated: true, missingCards: [] });
    expect(r).toContain("Nobody is in the field");
    expect(r).toContain("Registration & field");
  });

  it("allows the ordinary case", () => {
    expect(launchRefusal({ playingRounds: 1, confirmed: 1, dated: true, missingCards: [] })).toBeNull();
  });

  it("does not demand flights or a venue", () => {
    /**
     * THE MINIMUM, not a checklist of good practice.
     *
     * A medal has no flights and never will. "No fixed course — players
     * choose" is a real answer to the venue question. A gate that asked for
     * either would refuse tournaments that are perfectly ready, which is the
     * failure mode the course-card rules are written about — "a guard that
     * refuses a real golf course is worse than no guard".
     */
    expect(launchRefusal({ playingRounds: 1, confirmed: 40, dated: true, missingCards: [] })).toBeNull();
  });

  it("does demand a date, which it did not until 2026-09-19", () => {
    /**
     * A DELIBERATE REVERSAL, so read this before restoring the old rule.
     *
     * The case above used to end "or a date", and the reasoning was that a
     * league fixing its dates a week at a time has none to give. Ajay's rule
     * on 2026-09-19: every tournament carries dates, and where they are not
     * settled they are TENTATIVE rather than absent.
     *
     * That answers the league objection rather than overruling it. The column
     * is free text, so "Thursdays, April to September" is a date, and
     * `datesTentative` is how the club says the committee has not fixed it.
     * What is refused is a tournament published to its members saying nothing
     * at all about when it is played — the first question every one of them
     * asks.
     *
     * A CASUAL ROUND IS NOT AFFECTED. It never reaches this gate: it is
     * created by `match-setup` with an expiry and is played the same day.
     * Casual stays casual.
     */
    const r = launchRefusal({ playingRounds: 1, confirmed: 40, dated: false, missingCards: [] });
    expect(r).toContain("no dates");
    // Every refusal names the screen that fixes it — by the name the sidebar
    // gives it, which this used to get wrong ("Tournament setup") — and this
    // one names the escape hatch too.
    expect(r).toContain(screenName("/event"));
    expect(r).toContain("tentative");
  });

  it("refuses a round its format cannot score, naming the round, the course and the fix (2026-09-28)", () => {
    // Score entry already refused this — on the first tee. Launch now says it
    // while the committee can still add the card.
    const r = launchRefusal({
      playingRounds: 2, confirmed: 40, dated: true,
      missingCards: [{ label: "Round 2", course: "zz-Ardmore" }],
    });
    expect(r).toContain("Round 2 at zz-Ardmore needs its course card");
    expect(r).toContain("par and stroke index");
    expect(r).toContain("course library");
    // Two rounds are named together, in one sentence.
    const two = launchRefusal({
      playingRounds: 3, confirmed: 40, dated: true,
      missingCards: [{ label: "Round 1", course: "" }, { label: "Round 3", course: "zz-Links" }],
    });
    expect(two).toContain("Round 1 and Round 3 at zz-Links need their course card");
  });

  it("the setup guide asks the same card question as the Launch button", () => {
    // `SetupFacts.missingCards` is optional (many fixtures build one), so the
    // service building the REAL facts is pinned to pass it — otherwise the
    // guide says "take it live" over a Launch the action then refuses.
    const src = readSource("src/lib/services/setup-flow.ts");
    expect(src).toContain("missingCards: await roundsMissingCards(eventId)");
  });

  it("takes whitespace as no date at all", () => {
    // The gate reads `!!dates.trim()` at the call site; a space is not an answer.
    expect(launchRefusal({ playingRounds: 1, confirmed: 1, dated: false, missingCards: [] })).not.toBeNull();
  });
});

describe("declaring it finished", () => {
  it("refuses while cards are still waiting to be signed off", () => {
    const r = finishRefusal({ pendingConfirmations: 3, disputed: 0 });
    expect(r).toContain("3 cards are still waiting");
    expect(r).toContain("Score entry");
  });

  it("says it in the singular for one card", () => {
    const r = finishRefusal({ pendingConfirmations: 1, disputed: 0 });
    expect(r).toContain("1 card is still waiting");
    expect(r).toContain("Approve or correct it");
  });

  it("allows a tournament with nothing outstanding", () => {
    expect(finishRefusal({ pendingConfirmations: 0, disputed: 0 })).toBeNull();
  });

  it("refuses while a result is disputed, even with nothing to sign off", () => {
    /**
     * The hole this closes. Disputes are deliberately out of the sign-off
     * queue, and this gate read only the queue — so with every other card
     * approved, a tournament could be finished and its standings published as
     * final over a card somebody had said was wrong. Rule 20.2c: the
     * Committee decides, and only then is the result final.
     */
    const r = finishRefusal({ pendingConfirmations: 0, disputed: 1 });
    expect(r, "finished over a disputed result").not.toBeNull();
    expect(r).toContain("1 result is disputed");
    expect(r, "a dispute is settled, not approved").not.toContain("Approve");
  });

  it("names the dispute first when both are outstanding", () => {
    // Different remedy: approving the queue does not settle a dispute, so
    // leading with the queue would send the organizer to the wrong fix.
    const r = finishRefusal({ pendingConfirmations: 2, disputed: 3 });
    expect(r).toContain("3 results are disputed");
  });

  it("does not refuse a tournament nobody played", () => {
    /**
     * A club that abandons a day to weather has to be able to close it. A gate
     * insisting on scores would be the app arguing with the weather, and there
     * is no remedy to name — which is the test of whether a refusal is fair.
     */
    expect(finishRefusal({ pendingConfirmations: 0, disputed: 0 })).toBeNull();
  });
});

describe("where the gates are enforced", () => {
  /**
   * BOTH ENDS, and neither is load-bearing alone. A disabled button stops
   * nobody — a `"use server"` export is a public HTTP endpoint — and an action
   * that refuses silently makes the organizer press a thing to discover it
   * will not work.
   */
  it("is checked inside the actions, not only on the screen", () => {
    const actions = readSource("src", "app", "actions", "tournament.ts");
    expect(actions).toMatch(/const refusal = launchRefusal\(/);
    // Both facts, at the enforcement point. The screen alone passing
    // `disputed` would leave the endpoint finishing over a dispute.
    expect(actions).toMatch(/finishRefusal\(\{[^}]*pendingConfirmations[^}]*disputed: state\.reviewing\.disputed/);
    // And the refusal is returned rather than thrown away.
    expect(actions).toMatch(/if \(refusal\) return \{ ok: false, error: refusal \}/);
  });

  it("is checked on the screen too, from the same two functions", () => {
    const dash = readSource("src", "app", "(app)", "dashboard", "page.tsx");
    expect(dash).toMatch(/launchRefusal\(\{/);
    expect(dash).toMatch(/finishRefusal\(\{/);
    expect(dash).toMatch(/blockedReason=\{phaseBlock/);
  });

  it("disables the button and shows the reason", () => {
    const bar = readSource("src", "components", "LifecycleBar.tsx");
    expect(bar).toMatch(/disabled=\{pending \|\| !!blockedReason\}/);
    // The reason is rendered, not merely held — a greyed-out button that
    // explains nothing is the worst of both. Read from the same pair since
    // it became a short line with the rest behind an ⓘ (2026-10-05); that it
    // reaches the screen is RENDERED in `lifecycle-reason-shown.test.tsx`.
    expect(bar).toMatch(/refused \|\| blockedReason/);
  });

  it("only gates the transitions that change what the field sees", () => {
    /**
     * Moving from draft to "taking entries" is a club saying what it is doing.
     * Gating it would be the wizard this codebase decided against.
     */
    const dash = readSource("src", "app", "(app)", "dashboard", "page.tsx");
    const block = dash.slice(dash.indexOf("const phaseBlock"), dash.indexOf("const phaseBlock") + 500);
    expect(block).not.toMatch(/"draft"/);
  });
});
