import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { standingLabels } from "@/lib/domain/standing-labels";
import { ScoreboardLeaders, type LeaderTile } from "@/components/Scoreboard";

/**
 * A MEMBER WHO TOPPED THE GROUP AND LOST IN THE DRAW IS NOT "POSITION T1".
 *
 * Today on the seeded Summer Knockout, 2026-09-26: "Position T1 · 3-0-0" over
 * "Out in the semifinal". The table is the qualifying; the draw decides the
 * tournament. See `standing-labels.ts`.
 */

describe("the Today table says what it is", () => {
  it("calls a place in the qualifying table Qualifying once the round is a draw", () => {
    expect(standingLabels({ position: "T1", thru: 3, knockout: true })).toEqual({
      hero: "Qualifying",
      board: "QUALIFYING",
    });
  });

  it("still says Position and LEADERS on an ordinary round (the control)", () => {
    // Without this, "always say Qualifying" would pass the case above.
    expect(standingLabels({ position: "T1", thru: 18, knockout: false })).toEqual({
      hero: "Position",
      board: "LEADERS",
    });
    expect(standingLabels({ position: "4", thru: 18, knockout: undefined }).hero).toBe("Position");
  });

  it("keeps the no-place words whatever the round", () => {
    expect(standingLabels({ position: "", thru: 7, knockout: true }).hero).toBe("Not ranked");
    expect(standingLabels({ position: "", thru: 0, knockout: false }).hero).toBe("Not started");
  });
});

describe("the board prints the title it is given", () => {
  const rows: LeaderTile[] = [
    { id: "a", pos: "T1", name: "ZZ-ONE", thru: "–", total: "19.5", under: false, you: true, gap: false },
  ];

  it("heads a qualifying table QUALIFYING, and names it so for a screen reader", () => {
    const html = renderToStaticMarkup(createElement(ScoreboardLeaders, { rows, title: "QUALIFYING" }));
    expect(html).toContain(">QUALIFYING<");
    expect(html).toContain('aria-label="Qualifying"');
    expect(html).not.toContain(">LEADERS<");
  });

  it("stays LEADERS when nothing says otherwise", () => {
    const html = renderToStaticMarkup(createElement(ScoreboardLeaders, { rows }));
    expect(html).toContain(">LEADERS<");
    expect(html).toContain('aria-label="Leaders"');
  });
});
