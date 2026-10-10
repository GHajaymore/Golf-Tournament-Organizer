import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RoundApproval } from "@/components/RoundApproval";
import type { CardForReview } from "@/lib/domain/card-approval";

/**
 * DONE IS NOT ATTENTION (2026-10-09). Walked as a club secretary: 117 of a
 * 120-player round approved, one disputed, one with holes missing. The panel
 * read "Nothing ready to approve — 119 cards need attention" and listed all
 * 117 approved cards under NEEDS ATTENTION, with the dispute somewhere among
 * them.
 */
const card = (i: number, status: string): CardForReview => ({
  id: `c${i}`,
  playerId: `p${i}`,
  playerName: `zz-Player ${i}`,
  status,
  strokes: new Array(18).fill(4),
  holes: 18,
});

describe("the round's approval panel", () => {
  const cards = [
    ...Array.from({ length: 117 }, (_, i) => card(i, "approved")),
    card(200, "disputed"),
  ];
  const html = renderToStaticMarkup(<RoundApproval stageId="s1" cards={cards} isAdmin />);
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("counts only what still needs deciding", () => {
    expect(text).toContain("Nothing ready to approve — 1 card needs attention.");
    expect(text).not.toMatch(/11[789] cards need attention/);
  });

  it("lists the dispute under Needs attention, and the approved apart", () => {
    const attention = text.slice(text.indexOf("Needs attention"), text.indexOf("Approved (117)"));
    expect(attention).toContain("zz-Player 200");
    expect(attention, "an approved card is listed as needing attention").not.toContain("zz-Player 0 ");
    expect(text).toContain("Approved (117)");
  });
});
