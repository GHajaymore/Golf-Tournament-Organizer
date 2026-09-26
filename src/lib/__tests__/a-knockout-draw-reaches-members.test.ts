import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * A KNOCKOUT'S DRAW REACHES THE PEOPLE PLAYING IN IT.
 *
 * Found 2026-09-26 walking the seeded Summer Knockout as a member one tie from
 * the final: Today said the score is "recorded against your opponent" and
 * named nobody, the player's Board printed the qualifying match points and
 * "Round 2 · Not settled yet", and the club's public link the same. The draw
 * existed only on the organizer's console.
 *
 * The screens are server components, so the wiring is pinned here and the
 * rule itself — who a player meets, who beat them — in `my-tie.test.ts`. The
 * three screens were each walked in the browser with the fix in place.
 */
describe("the knockout draw on member-facing screens", () => {
  it("the player's Board shows the draw, and replaces the table for a straight knockout", () => {
    const src = readSource("src/app/(player)/me/board/page.tsx");
    expect(src).toMatch(/drawnDraws\(state\.brackets\)/);
    expect(src).toMatch(/<TheDraw /);
    // A straight knockout does not render the match-points table at all.
    const branch = src.slice(src.indexOf("{straightKnockout ?"), src.indexOf("<PlayerLeaderboard"));
    expect(branch).toMatch(/drawSection/);
  });

  it("the public board carries the draw in its cached view and renders it", () => {
    expect(readSource("src/lib/services/live-board.ts")).toMatch(/drawnDraws\(state\.brackets\)/);
    const page = readSource("src/app/live/[token]/page.tsx");
    expect(page).toMatch(/<TheDraw draws=\{board\.draws\}/);
    expect(page.indexOf("board.straightKnockout ?")).toBeGreaterThan(0);
    expect(page.indexOf("board.straightKnockout ?")).toBeLessThan(page.indexOf("<PlayerLeaderboard"));
  });

  it("Today names the player's tie, read off the draw", () => {
    expect(readSource("src/lib/services/me.ts")).toMatch(/myTie\(bracketDraws\(state\.brackets\)/);
    expect(readSource("src/app/(player)/me/page.tsx")).toMatch(/myTieLine\(round\.tie\)/);
  });
});
