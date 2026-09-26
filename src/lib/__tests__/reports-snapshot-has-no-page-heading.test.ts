import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * A PAGE THAT EMBEDS A BOARD TAKES THE BOARD WITHOUT ITS PAGE HEADING.
 *
 * `TeamLeaderboard`, `SkinsLeaderboard`, `NassauLeaderboard` and
 * `ModifiedStablefordLeaderboard` are whole pages: each opens with
 * "Overview" and an `<h1>Live leaderboard</h1>`. Reports and the public
 * `/live` board both dropped them into a page with its own `<h1>`. On the
 * seeded club's foursomes Reports had two — found on 2026-09-26 by a sweep of
 * 220 console loads, the only one of the 220 without exactly one — and printed
 * "Live leaderboard" on the sheet pinned up after the round; `/live` showed a
 * club's members the console's "Overview" kicker under the tournament's name.
 *
 * `e2e/layout.spec.ts` requires one `<h1>` per route but runs a stroke
 * fixture, where both screens take the plain table and these four formats
 * never reach it. So the rule is pinned where every format is visible at once:
 * the source. The console's Live leaderboard is the one screen these ARE the
 * page for, and is not swept here.
 */
const EMBEDDERS = ["src/app/(app)/reports/page.tsx", "src/app/live/[token]/page.tsx"];

describe.each(EMBEDDERS)("%s", (file) => {
  const src = readSource(file);

  it("embeds none of the full-page boards", () => {
    expect(src).not.toMatch(/<(Team|Skins|Nassau|ModifiedStableford)Leaderboard\b/);
  });

  it("embeds each format's heading-less table, with the line saying what it ranks on", () => {
    // The control: the formats are all still here, just without the heading.
    for (const table of ["TeamStandingsTable", "SkinsStandingsTable", "NassauMatches", "ModifiedStablefordTable"]) {
      expect(src, table).toContain(`<${table} `);
    }
    expect(src.match(/<EmbeddedBoard note=/g)?.length).toBe(4);
  });
});
