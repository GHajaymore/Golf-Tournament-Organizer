import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/tournament", () => ({ setMatchTiebreakers: vi.fn() }));

import { MatchTiebreakControl } from "@/components/MatchTiebreakControl";
import { breakMatchTie } from "@/lib/domain/match-tiebreak";

/**
 * TOUGHEST 6 OR 3, ON NINE HOLES AND ON EIGHTEEN (Ajay, 2026-10-16: "in the
 * custom add toughest 6 or 3 for 9 holes and repeat for 18"). A nine-hole round
 * was not offered the toughest six — six of its nine hardest holes is a real
 * countback — while "last 9" stays off a nine, where it is the whole round.
 */
describe("the toughest holes, as a way to settle a halved match", () => {
  const offered = (holes: number) => renderToStaticMarkup(<MatchTiebreakControl selected={[]} holes={holes} locked={false} />);

  it("offers the toughest 6 and 3 on a nine, and not the last nine", () => {
    const nine = offered(9);
    expect(nine).toContain("Toughest 6 holes (by stroke index)");
    expect(nine).toContain("Toughest 3 holes (by stroke index)");
    expect(nine).not.toContain("Last 9 holes");
  });

  it("offers the same on eighteen, with the last nine", () => {
    const eighteen = offered(18);
    expect(eighteen).toContain("Toughest 6 holes (by stroke index)");
    expect(eighteen).toContain("Toughest 3 holes (by stroke index)");
    expect(eighteen).toContain("Last 9 holes");
  });

  it("settles a halved nine on its toughest six, by the card's own stroke index", () => {
    // A wins holes 1-3, B wins 4-6, 7-9 halved: all square. On this nine the
    // hardest six are holes 4-9 (indexes 1-6), where B won three and A none.
    const holes = ["A", "A", "A", "B", "B", "B", "H", "H", "H"] as never[];
    const strokeIndex = [7, 8, 9, 1, 2, 3, 4, 5, 6];
    const out = breakMatchTie(holes, strokeIndex, ["toughest-6"]);
    expect(out.winner).toBe("B");
    // CONTROL: the same match on a card indexed the other way — the hardest six
    // are now holes 1-3 and 7-9, where A won three — goes to A. The index decided.
    const reversed = [1, 2, 3, 7, 8, 9, 4, 5, 6];
    expect(breakMatchTie(holes, reversed, ["toughest-6"]).winner).toBe("A");
  });
});
