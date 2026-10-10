import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard",
}));
vi.mock("@/app/actions/tournament", () => ({ setRoundClosed: vi.fn() }));

import { CutReadyCard } from "@/components/CutReadyCard";

/**
 * THE CUT CARD NAMES WHO HAS NO CARD (2026-10-09). Approving the cut sends
 * them home with everybody else who missed it, so the committee reads their
 * names before pressing the button, not after.
 */
const render = (noCard?: string[]) =>
  renderToStaticMarkup(
    <CutReadyCard feederId="r1" feederName="Round 1" nextName="Round 2" rule="Top 60 and ties" through={61} missed={58} noCard={noCard} />,
  )
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

describe("the cut card", () => {
  it("names the players with no card, and says what that means", () => {
    const text = render(["zz-Xanthe Quill", "zz-Yuri Blaine"]);
    expect(text).toMatch(/Every Round 1 card returned is approved/);
    expect(text).toMatch(/No card from zz-Xanthe Quill and zz-Yuri Blaine\. They miss the cut unless you enter their cards/);
  });

  it("one player reads in the singular", () => {
    expect(render(["zz-Xanthe Quill"])).toMatch(/No card from zz-Xanthe Quill\. That player misses the cut unless you enter the card/);
  });

  it("CONTROL: with every card in, it says so and names nobody", () => {
    const text = render([]);
    expect(text).toMatch(/All Round 1 cards are approved/);
    expect(text).not.toMatch(/No card from/);
  });
});
