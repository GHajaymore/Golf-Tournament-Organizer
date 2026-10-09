import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";
import { ScoreboardLeaders, type LeaderTile } from "@/components/Scoreboard";

/**
 * "· YOU" SURVIVES A LONG SURNAME ON THE PLAYER'S LEADERS CARD.
 *
 * On a phone the player's own row read "O'HALLORAN-WHYTE · YO": name and tag
 * were one string, and `.sb-name` sat in the tile's `display: grid`, where
 * `text-overflow: ellipsis` does nothing — so it clipped from the right and
 * took the word that says the row is theirs. Measured on the seeded club at
 * 393px and 320px; after the fix the tag sits wholly inside its tile at both
 * ("O'HALLORAN-… · YOU", "O'H… · YOU").
 *
 * The geometry is a browser fact and was measured in one. What this pins is
 * the structure that makes it possible — the name and the tag as separate
 * pieces, and a tile that is flex rather than grid — so a tidy-up re-joining
 * them into one string, or dropping the flex, goes red here.
 */

const tile = (over: Partial<LeaderTile> = {}): LeaderTile => ({
  id: "x",
  pos: "T9",
  name: "O'HALLORAN-WHYTE",
  thru: "11",
  total: "-2",
  under: true,
  you: false,
  gap: false,
  ...over,
});

describe("the player's own row on the leaders card", () => {
  it("renders the name and 'YOU' as separate pieces", () => {
    const html = renderToStaticMarkup(<ScoreboardLeaders rows={[tile({ id: "me", you: true })]} />);
    expect(html).toMatch(/<span class="sb-name-text">O&#x27;HALLORAN-WHYTE<\/span><span class="sb-you-tag">/);
    expect(html).not.toContain("O&#x27;HALLORAN-WHYTE · YOU");
  });

  it("adds no tag to anybody else's row", () => {
    const html = renderToStaticMarkup(<ScoreboardLeaders rows={[tile()]} />);
    expect(html).not.toContain("sb-you-tag");
  });

  it("lets the name shrink and not the tag", () => {
    // Comments stripped: the `.sb-name` rule explains itself in a comment that
    // mentions the very properties asserted here.
    const css = readSource("src", "app", "globals.css");
    const rule = (sel: string) => {
      const i = css.indexOf(`${sel} {`);
      return i < 0 ? "" : css.slice(i, css.indexOf("}", i));
    };
    // Grid would swallow the ellipsis again — the defect.
    expect(rule(".sb-name")).toMatch(/display:\s*flex/);
    expect(rule(".sb-name-text")).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule(".sb-you-tag")).toMatch(/flex:\s*none/);
  });
});

/**
 * WHAT THE ROW SAYS ALOUD FOR A PLAYER OUT OF THE WEEK (2026-10-08, grid L3).
 * The tile reads "–" for both; the spoken line said "not started" for a league
 * player who is not coming, where the Board tab says "not playing this week".
 */
describe("a row for somebody out of this league week", () => {
  it("is read as not playing this week, not as not started", () => {
    const out = renderToStaticMarkup(<ScoreboardLeaders rows={[tile({ thru: "–", absent: true })]} />);
    expect(out).toContain("not playing this week");
    expect(out).not.toContain("not started");
    // The control: somebody in who has not teed off yet.
    expect(renderToStaticMarkup(<ScoreboardLeaders rows={[tile({ thru: "–" })]} />)).toContain("not started");
  });
});
