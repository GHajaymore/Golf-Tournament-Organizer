import { describe, it, expect } from "vitest";
import { notInItWords } from "../tournament-shape";
import { readSource } from "./source";

/**
 * SOMEBODY WITH NO PLACE IN IT IS TOLD SO IN THE WORDS OF WHAT IT IS.
 *
 * A casual round's host opened Today on 2026-10-06 and read "You aren't
 * entered in this tournament" — about a round of four friends set up on the
 * first tee, which nobody enters and nobody calls a tournament.
 */
describe("what somebody not in it is told", () => {
  it("a casual round is a round somebody plays", () => {
    expect(notInItWords("match")).toBe("You aren't playing in this round");
  });

  it("a tournament is still one somebody enters — the control", () => {
    for (const shape of ["single", "series", "knockout", "", null, undefined]) {
      expect(notInItWords(shape), String(shape)).toBe("You aren't entered in this tournament");
    }
  });

  it("Today and the card both say it through the one reader", () => {
    const today = readSource("src", "app", "(player)", "me", "page.tsx");
    const card = readSource("src", "app", "(player)", "me", "card", "page.tsx");
    for (const [name, src] of [["Today", today], ["card", card]] as const) {
      expect(src, `${name} words it for itself`).toContain("notInItWords(state.event.shape)");
      expect(src, `${name} still hard-codes the tournament sentence`).not.toMatch(/aren(?:'|&rsquo;)t entered in this tournament/);
    }
  });
});
