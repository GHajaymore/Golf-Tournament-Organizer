import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";

// The card refreshes the route after a save and holds its actions until a
// click; neither exists outside a running app.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));
vi.mock("@/app/actions/side-games", () => ({
  saveSideGame: vi.fn(), setSideGameEntrants: vi.fn(), confirmSideGameEntry: vi.fn(), removeSideGame: vi.fn(),
}));
// Named one by one. A Proxy that answers every key answers `then` too, and a
// module with a callable `then` is a thenable: `await import` waits on it for
// ever (render.test.tsx says so, and this file found out).
vi.mock("@/app/actions/contests", () => ({
  addContest: vi.fn(), setContestEntrants: vi.fn(), setContestWinners: vi.fn(), removeContest: vi.fn(), confirmContestEntry: vi.fn(),
}));
vi.mock("@/app/actions/money-setup", () => ({ setPotEntryMode: vi.fn(), setPotExcluded: vi.fn() }));

const { ContestsClient } = await import("@/components/ContestsClient");

/**
 * A NAMED SIDE BET HAS A SCREEN THAT MANAGES IT (sweep 1, b12, 2026-10-10).
 *
 * "Start a side bet" makes a birdie pot, low net or twos under a name the
 * players choose. It is stored as side games keyed on that name and settled
 * like any other pot — and nothing loaded it. Both management screens read
 * the FIELD's games (`groupKey: ""`); only named SKINS pots were looked up by
 * name. Such a bet could be started and then never re-priced or taken off,
 * and anybody who asked to join from their phone stayed pending for good.
 *
 * Two halves: the screen loads every named game on the round, and the card
 * that shows them saves under the bet's own name rather than the field's.
 */
describe("a named side bet that is not skins", () => {
  const field = [
    { id: "p1", name: "zz-Ann Reyes", playing: true },
    { id: "p2", name: "zz-Bo Kite", playing: true },
  ];
  const birdies = {
    id: "g1", kind: "birdies", buyInCents: 500, stakeNote: "", entryMode: "opt-in", excluded: [],
    entrantIds: ["p1"], pending: [{ playerId: "p2", name: "zz-Bo Kite" }],
  };

  it("is drawn under its own name, with who is in and who has asked", () => {
    const html = renderToStaticMarkup(
      <ContestsClient
        roundLabel="The Thursday six" title="The Thursday six — side bet" stageId="s1" groupKey="The Thursday six"
        contests={[]} sideGames={[birdies]} field={field} contestsApply={false} rows="on"
      />,
    );
    expect(html).toContain("The Thursday six — side bet");
    expect(html).toContain("In the pot (1)");
    expect(html).toContain("Asked to join");
    expect(html).toContain("zz-Bo Kite");
  });

  it("lists only the games the bet is running", () => {
    const html = renderToStaticMarkup(
      <ContestsClient roundLabel="x" stageId="s1" groupKey="x" contests={[]} sideGames={[birdies]} field={field} contestsApply={false} rows="on" />,
    );
    expect(html).toContain("Birdie");
    // One stake box, the birdie pot's. (The card's own explainer names the
    // other games in a sentence, so their names are no evidence either way.)
    expect(html.split('placeholder="0.00"').length - 1, "offers a stake box for games the bet was never set up with").toBe(1);
  });

  it("the card saves a price under the bet's name, not the field's", () => {
    const card = readSource("src/components/ContestsClient.tsx");
    expect(card).toContain("saveSideGame(stageId, row.kind, cents, groupKey)");
    expect(card, "re-prices the field's game from a named bet's card").not.toContain("saveSideGame(stageId, row.kind, cents))");
  });

  it("the group screen loads every named game on the round and hands each card its name", () => {
    const page = readSource("src/app/(app)/group-games/page.tsx");
    expect(page).toContain('groupKey: { not: "" } },\n        include: { entrants: true }'.replace("\n", page.includes("\r\n") ? "\r\n" : "\n"));
    expect(page).toContain("groupKey={bet.name}");
    expect(page).toContain("sideGames={bet.games}");
  });
});
