import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { placeTexts } from "@/lib/domain/flight-places";
import { TeamStandingsTable } from "@/components/TeamLeaderboard";
import type { TeamStanding } from "@/lib/services/teams";

/**
 * A SHARED PLACE SAYS "T" ON EVERY BOARD, not only on the stroke boards.
 *
 * The seeded club's foursomes board read 1, 1, 3, 3, 5, 6, 6, 8 on 2026-09-26
 * while the medal board on the same phone read T9, T9, 11 — the convention the
 * app settled on 2026-09-25 (`placeText`), missed by the four tables that take
 * their places from `placesByValue`.
 */

describe("placeTexts", () => {
  it("marks a place held by more than one row, and only that place", () => {
    expect(placeTexts([1, 1, 3, 3, 5, 6, 6, 8])).toEqual(["T1", "T1", "T3", "T3", "5", "T6", "T6", "8"]);
  });

  it("leaves a field with no ties exactly as it was (the control)", () => {
    expect(placeTexts([1, 2, 3])).toEqual(["1", "2", "3"]);
  });

  it("keeps a row with no place as no place, and never pairs two of them", () => {
    expect(placeTexts([1, null, null, 2])).toEqual(["1", null, null, "2"]);
    expect(placeTexts([])).toEqual([]);
  });
});

describe("the sides board prints it", () => {
  const side = (teamId: string, net: number): TeamStanding => ({
    teamId,
    name: `zz-side ${teamId}`,
    members: [],
    memberIds: [],
    playingHandicap: 3,
    gross: net + 3,
    net,
    points: 0,
    played: 9,
    toPar: net - 32,
  });

  const cells = (rows: TeamStanding[]) => {
    const html = renderToStaticMarkup(createElement(TeamStandingsTable, { basis: "net", rows }));
    return [...html.matchAll(/<tr><td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]);
  };

  it("two sides level on net are both T1", () => {
    expect(cells([side("a", 28), side("b", 28), side("c", 29)])).toEqual(["T1", "T1", "3"]);
  });

  it("sides apart are numbered plainly (the control)", () => {
    expect(cells([side("a", 28), side("b", 29)])).toEqual(["1", "2"]);
  });
});
