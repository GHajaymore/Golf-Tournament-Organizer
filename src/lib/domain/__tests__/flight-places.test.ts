import { describe, it, expect } from "vitest";
import { placesWithin } from "@/lib/domain/flight-places";
import { readSource } from "@/lib/__tests__/source";

/**
 * A FLIGHT PRIZE DECIDED BY A RENUMBERING THAT LOST THE TIE.
 *
 * The board's "By flight" view splits the overall standings per flight and
 * renumbers each from one — correct in itself, because a player 9th in the
 * tournament is 2nd in their flight and the flight is what they are playing
 * for. It did it with `map((r, i) => ({ ...r, rank: i + 1 }))`.
 *
 * `rankPlayers` shares a rank only when the club's whole tiebreak chain comes
 * back level; its own comment calls that "two players nothing separates share
 * a place", and the stroke board has always shared ranks too. Two players in
 * one flight who genuinely could not be separated therefore arrived here
 * sharing an overall rank — and were printed 1 and 2.
 *
 * A club day pays a flight winner off this table.
 *
 * Same shape as the week-sheet fault found the same night: a ranking that knew
 * about ties, handed to a renumbering that did not. There the rank could be
 * carried through; here the number genuinely has to change, so the ties are
 * carried instead.
 */
const row = (id: string, rank: number) => ({ id, rank });

describe("numbering a flight", () => {
  it("renumbers from one, which is the point of the view", () => {
    // 5th, 9th and 14th overall are 1st, 2nd and 3rd in their flight.
    expect(placesWithin([row("a", 5), row("b", 9), row("c", 14)]).map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("keeps a dead heat a dead heat", () => {
    /**
     * The defect. Two players sharing an overall rank were separated by
     * nothing, so the flight cannot separate them either.
     */
    expect(placesWithin([row("a", 5), row("b", 9), row("c", 9), row("d", 14)]).map((r) => r.rank)).toEqual(
      [1, 2, 2, 4],
    );
  });

  it("skips the place a shared one used up", () => {
    // 1, 1, 3 — not 1, 1, 2. The same rule the board it came from uses.
    expect(placesWithin([row("a", 3), row("b", 3), row("c", 8)]).map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it("handles a flight that is entirely level", () => {
    expect(placesWithin([row("a", 4), row("b", 4), row("c", 4)]).map((r) => r.rank)).toEqual([1, 1, 1]);
  });

  it("handles one player, and none", () => {
    expect(placesWithin([row("a", 12)]).map((r) => r.rank)).toEqual([1]);
    expect(placesWithin([])).toEqual([]);
  });

  it("changes nothing else about the row", () => {
    // It is a renumbering, not a rebuild — everything else travels untouched.
    const rows = [{ id: "a", rank: 7, name: "Ada", points: 10.5 }];
    expect(placesWithin(rows)[0]).toEqual({ id: "a", rank: 1, name: "Ada", points: 10.5 });
  });

  it("does not mutate what it was given", () => {
    const rows = [row("a", 5), row("b", 5)];
    placesWithin(rows);
    expect(rows.map((r) => r.rank)).toEqual([5, 5]);
  });
});

/**
 * And the board has to USE it.
 *
 * The pure tests above cannot see the component going back to `i + 1`, which
 * is exactly the shape the bug had — and there were two copies of it, the
 * flight lists and the players with no flight yet.
 */
describe("what the by-flight view numbers with", () => {
  const src = () => readSource("src/components/LeaderboardBoard.tsx");

  it("numbers both lists through the shared rule", () => {
    expect(src().split("placesWithin(").length - 1).toBe(2);
  });

  it("has no index-based renumbering left", () => {
    /**
     * Absence, which is the safe direction here and cannot be satisfied by a
     * comment — `readSource` strips them. Both copies went, including the
     * unflighted list, which had the identical fault and is where a society
     * day sits before the draw.
     */
    expect(src()).not.toMatch(/rank: i \+ 1/);
  });
});

/**
 * AND THE SHEET A CLUB ACTUALLY PRINTS.
 *
 * "Flight results — Per-flight finishing order and advancing status", column
 * headed "Rank", file named `-flight-results.csv`. It exported the
 * TOURNAMENT-wide rank:
 *
 *     Flight 2, 3, Diego Alvarez
 *
 * for a player who is first in Flight 2 and third overall — while the board's
 * own by-flight view of the same standings called him 1st. Whoever reads that
 * CSV to award a flight prize reads the wrong number, and the two disagree
 * about one question.
 */
describe("the flight results export", () => {
  const src = () => readSource("src/components/ReportsClient.tsx");

  it("numbers the flight with the board's rule", () => {
    expect(src()).toMatch(/placesWithin\(rows\.filter\(\(r\) => r\.flight === f\)\)/);
  });

  it("no longer exports the overall rank under a per-flight heading", () => {
    /**
     * The old shape, gone: a single sort by flight-then-rank with `r.rank`
     * printed straight out. Absence, which `readSource` makes comment-proof.
     */
    const s = src();
    expect(s).not.toMatch(/a\.flight\.localeCompare\(b\.flight\) \|\| a\.rank - b\.rank/);
  });

  it("leaves the full standings export on the overall rank, which is its job", () => {
    /**
     * The control, and the reason this is not a blanket find-and-replace: the
     * other CSV is the whole tournament ranked, where `r.rank` is exactly the
     * right number and renumbering it would be the same fault reversed.
     */
    const s = src();
    const full = s.slice(s.indexOf("const fullStandings"), s.indexOf("const groupResults"));
    expect(full).toMatch(/String\(r\.rank\)/);
    expect(full).not.toMatch(/placesWithin/);
  });
});

/**
 * AND THE DASHBOARD'S FLIGHT COLUMNS, which had the same split inside one card.
 *
 * The stroke branch mapped `rank: s.ranked ? i + 1 : 0` over
 * `strokeStandings` filtered per flight — under a comment correctly saying
 * that filtering "keeps the engine's order rather than inventing a second
 * one". It kept the order and reinvented the number.
 *
 * The match branch beside it never had the fault: `groupStandings` runs
 * `computeStandings` over the group alone, so its `rank` is already the flight
 * place with ties intact. Two halves of one card, answering "what place in
 * this flight" differently.
 */
describe("the dashboard's flight columns", () => {
  const src = () => readSource("src", "app", "(app)", "dashboard", "page.tsx");

  it("numbers the stroke flights with the shared rule", () => {
    expect(src()).toMatch(/placesWithin\(state\.strokeStandings\.filter\(/);
  });

  it("still reports no place for a player with no card", () => {
    /**
     * `ranked` is false for an incomplete card — Rule 3.2b, nothing may invent
     * a score for a hole nobody played — and 0 is how this card says "no
     * place". That is a different statement from being last, and renumbering
     * must not quietly give them one.
     */
    expect(src()).toMatch(/rank: s\.ranked \? s\.rank : 0/);
  });

  it("leaves the match branch alone, which was already right", () => {
    // `groupStandings` is ranked within the group by the engine.
    const s = src();
    const matchBranch = s.slice(s.indexOf("groupStandings.map((gs)"));
    expect(matchBranch).toMatch(/rank: r\.rank/);
    expect(matchBranch).not.toMatch(/placesWithin/);
  });
});
