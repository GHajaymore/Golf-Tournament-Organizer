import { describe, it, expect } from "vitest";
import {
  matchStatusKey,
  filterMatches,
  statusCounts,
  visibleMatches,
  filterActive,
  EMPTY_FILTER,
  VISIBLE_CAP,
  type FilterableMatch,
  type MatchStatusKey,
} from "@/lib/domain/match-filter";

const m = (over: Partial<FilterableMatch> = {}): FilterableMatch => ({
  id: "m1",
  aName: "Tom Halloran",
  bName: "Derek Kwan",
  groupName: "Flight 4",
  round: 1,
  status: "awaiting",
  ...over,
});

describe("what a match is doing", () => {
  it("is awaiting approval once complete and unsigned", () => {
    expect(matchStatusKey({ complete: true, started: true, confirmStatus: "" })).toBe("awaiting");
  });

  it("counts both ways a card gets signed off as final", () => {
    // "auto-confirmed" is what a tournament that doesn't require approval
    // writes. Treating only "confirmed" as final would leave every match in
    // such a tournament sitting in the approval queue forever.
    expect(matchStatusKey({ complete: true, started: true, confirmStatus: "confirmed" })).toBe("final");
    expect(matchStatusKey({ complete: true, started: true, confirmStatus: "auto-confirmed" })).toBe("final");
  });

  it("keeps a disputed card out of the approval queue", () => {
    // The one that must never be swept up by a bulk approve.
    expect(matchStatusKey({ complete: true, started: true, confirmStatus: "disputed" })).toBe("disputed");
  });

  it("separates a card in progress from one never touched", () => {
    expect(matchStatusKey({ complete: false, started: true, confirmStatus: "" })).toBe("live");
    expect(matchStatusKey({ complete: false, started: false, confirmStatus: "" })).toBe("not-started");
  });
});

describe("searching the draw", () => {
  const draw = [
    m({ id: "a", aName: "Tom Halloran", bName: "Derek Kwan", groupName: "Flight 4", round: 1 }),
    m({ id: "b", aName: "Priya Nair", bName: "Caleb Ross", groupName: "Flight 3", round: 2, status: "final" }),
    m({ id: "c", aName: "Ivy Chen", bName: "Owen Barnes", groupName: "Flight 3", round: 1, status: "live" }),
  ];

  it("finds a player by either side of the match", () => {
    expect(filterMatches(draw, { query: "halloran", status: null }).map((x) => x.id)).toEqual(["a"]);
    expect(filterMatches(draw, { query: "kwan", status: null }).map((x) => x.id)).toEqual(["a"]);
  });

  it("ignores case, because nobody types a capital at the desk", () => {
    expect(filterMatches(draw, { query: "PRIYA", status: null }).map((x) => x.id)).toEqual(["b"]);
  });

  it("finds a block of the draw the way an organizer names it out loud", () => {
    expect(filterMatches(draw, { query: "flight 3", status: null }).map((x) => x.id)).toEqual(["b", "c"]);
    expect(filterMatches(draw, { query: "round 2", status: null }).map((x) => x.id)).toEqual(["b"]);
  });

  it("combines the search with the status", () => {
    expect(
      filterMatches(draw, { query: "flight 3", status: "live" }).map((x) => x.id),
    ).toEqual(["c"]);
  });

  it("keeps draw order rather than re-sorting by relevance", () => {
    // An organizer knows their draw runs flight by flight. Re-ordering would
    // move a row out from under a finger already on its way to it.
    expect(filterMatches(draw, EMPTY_FILTER).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("returns nothing rather than everything when nothing matches", () => {
    expect(filterMatches(draw, { query: "zzz", status: null })).toEqual([]);
  });
});

describe("the chip counts", () => {
  it("counts every status, including the empty ones", () => {
    const counts = statusCounts([m(), m(), m({ status: "final" })]);
    expect(counts.awaiting).toBe(2);
    expect(counts.final).toBe(1);
    expect(counts.disputed).toBe(0);
  });

  it("adds up to the whole draw", () => {
    const draw: FilterableMatch[] = (["awaiting", "final", "live", "disputed", "not-started"] as MatchStatusKey[])
      .map((status, i) => m({ id: `x${i}`, status }));
    const counts = statusCounts(draw);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(draw.length);
  });
});

describe("how much of the list is rendered", () => {
  const many = Array.from({ length: 48 }, (_, i) => m({ id: `m${i}` }));

  it("caps a long draw and says how much is held back", () => {
    const v = visibleMatches(many, false);
    expect(v.rows).toHaveLength(VISIBLE_CAP);
    expect(v.hidden).toBe(48 - VISIBLE_CAP);
  });

  it("shows everything once asked", () => {
    const v = visibleMatches(many, true);
    expect(v.rows).toHaveLength(48);
    expect(v.hidden).toBe(0);
  });

  it("does not offer to expand a draw that already fits", () => {
    // The expander has to be absent, not merely disabled — a "show 0 more"
    // button is a control that does nothing.
    const v = visibleMatches(many.slice(0, VISIBLE_CAP), false);
    expect(v.hidden).toBe(0);
    expect(v.rows).toHaveLength(VISIBLE_CAP);
  });
});

describe("whether the filter is doing anything", () => {
  it("is not, when untouched", () => {
    expect(filterActive(EMPTY_FILTER)).toBe(false);
    expect(filterActive({ query: "   ", status: null })).toBe(false);
  });

  it("is, once either half is set", () => {
    expect(filterActive({ query: "tom", status: null })).toBe(true);
    expect(filterActive({ query: "", status: "awaiting" })).toBe(true);
  });
});
