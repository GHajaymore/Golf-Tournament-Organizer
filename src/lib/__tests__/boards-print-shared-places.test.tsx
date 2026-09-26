import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LeaderboardTable, type StandingRow } from "@/components/LeaderboardTable";
import { PlayerLeaderboard } from "@/components/PlayerLeaderboard";
import { placeText, sharedRanks, positionLabel } from "@/lib/domain/shared-position";

/**
 * A SHARED PLACE READS "T9" ON EVERY BOARD, NOT "9, 9".
 *
 * Found on the seeded club's public medal board during a test pass
 * (2026-09-25): four players on net -2 read 9, 9, 11, 12 — two on 9, the 10
 * missing. The places were RIGHT: two were level on comparable holes (one of
 * them still out on the course, which is how a live board ranks — see
 * `board-ranks-comparable-scores.audit.test.ts`), and a shared 9 is followed by
 * 11. But the boards printed the bare rank, and a bare repeated number with a
 * gap after it reads to anybody who does not already know the convention as a
 * numbering mistake — it was read exactly that way.
 *
 * The player's own screen already said "T9" (`positionLabel`). The two boards
 * did not, so the same place was written two ways on two screens. Every
 * tournament board and results sheet prints "T9"; now all three do, through the
 * one helper.
 *
 * The fixture is the observed shape: a solo leader, two level on 9 of whom one
 * is "thru 11", then 11 and 12, and a player not started — who holds no place
 * and must not be counted into anybody's tie.
 */

const row = (id: string, rank: number, over: Partial<StandingRow> = {}): StandingRow => ({
  id,
  rank,
  ranked: rank > 0,
  started: rank > 0,
  name: `Player ${id}`,
  flight: "",
  advancing: false,
  record: "",
  diff: "",
  pts: "",
  played: 0,
  wins: 0,
  ties: 0,
  losses: 0,
  gross: 72,
  net: 70,
  toPar: -2,
  points: 0,
  thru: rank > 0 ? 18 : 0,
  holesOwed: 18,
  ...over,
});

const FIELD: StandingRow[] = [
  row("lead", 1, { toPar: -18 }),
  row("kwame", 9),
  row("seamus", 9, { thru: 11 }),
  row("hiroshi", 11),
  row("elias", 12),
  row("late", 0),
];

/** The first cell of each table row — the position column. */
const tableCells = (html: string) => [...html.matchAll(/<tr[^>]*>\s*<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]);
/** The first span of each list row on the public board — the position. */
const listCells = (html: string) =>
  [...html.matchAll(/<li[^>]*>\s*<div[^>]*>\s*<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);

describe("the tie rule", () => {
  it("counts only rows that hold a place", () => {
    const shared = sharedRanks(FIELD);
    expect([...shared]).toEqual([9]);
    expect(placeText(FIELD[1], shared)).toBe("T9");
    expect(placeText(FIELD[3], shared)).toBe("11");
  });

  it("does not make a tie out of a player who has not started", () => {
    // Two rows on rank 2, one with no result: not a tie (see shared-position).
    const rows = [row("a", 2), row("b", 2, { started: false })];
    expect(sharedRanks(rows).size).toBe(0);
  });

  it("agrees with the player's own screen", () => {
    expect(positionLabel(FIELD, "seamus")).toBe("T9");
    expect(positionLabel(FIELD, "elias")).toBe("12");
  });
});

describe("the organizer's board", () => {
  it("prints T9 for both players level on 9", () => {
    const html = renderToStaticMarkup(<LeaderboardTable isStroke rows={FIELD} />);
    expect(tableCells(html)).toEqual(["1", "T9", "T9", "11", "12", "—"]);
  });

  it("prints no T on a board with no ties", () => {
    const html = renderToStaticMarkup(
      <LeaderboardTable isStroke rows={[row("a", 1), row("b", 2), row("c", 3)]} />,
    );
    expect(tableCells(html)).toEqual(["1", "2", "3"]);
  });
});

describe("the public board", () => {
  it("prints T9 for both players level on 9", () => {
    const html = renderToStaticMarkup(<PlayerLeaderboard isStroke rows={FIELD} holes={18} />);
    expect(listCells(html)).toEqual(["1", "T9", "T9", "11", "12", "–"]);
  });

  it("prints no T on a board with no ties", () => {
    const html = renderToStaticMarkup(
      <PlayerLeaderboard isStroke rows={[row("a", 1), row("b", 2), row("c", 3)]} holes={18} />,
    );
    expect(listCells(html)).toEqual(["1", "2", "3"]);
  });

  it("says T9 in the 'You' strip too", () => {
    // Pad the field so the player's own row falls below the fold (index >= 5),
    // which is when the strip appears at all.
    const rows = [
      row("a", 1),
      row("b", 2),
      row("c", 3),
      row("d", 4),
      row("e", 5),
      row("f", 6),
      row("me", 7),
      row("g", 7),
    ];
    const html = renderToStaticMarkup(<PlayerLeaderboard isStroke rows={rows} holes={18} youId="me" />);
    expect(html).toMatch(/>You<\/span>\s*<span[^>]*>T7<\/span>/);
  });
});
