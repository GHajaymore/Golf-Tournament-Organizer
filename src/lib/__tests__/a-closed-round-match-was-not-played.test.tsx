import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { myMatchView } from "@/lib/domain/my-match";
import { ScoreboardLeaders, type LeaderTile } from "@/components/Scoreboard";
import { readSource } from "./source";

/**
 * A MATCH NOBODY PLAYED IN A CLOSED ROUND WAS NOT PLAYED (2026-10-08, grid
 * cell T50). A round robin closed by the committee with Bea v Cat never
 * played. Bea's Today read "Match 3 — v Cat · Not started · Nothing yet — it
 * fills in hole by hole" under "Round 1 is closed · There's no Round 1 card
 * from you" — a promise of holes that cannot come, and a card match play
 * never files. And the Leaders panel said every row aloud as "not started",
 * Dot's three wins included.
 */
const sides = { meId: "bea", playerAId: "bea", playerBId: "cat", holes: new Array(18).fill(null), nameOf: () => "Cat" };

describe("an unplayed match", () => {
  it("is 'Not played' once the round is closed, and promises nothing", () => {
    const v = myMatchView({ ...sides, roundClosed: true })!;
    expect(v.state).toBe("Not played");
    expect(v.notStarted, "the 'fills in hole by hole' line would show").toBe(false);
  });

  it("is 'Not started' while the round is open — the control", () => {
    const v = myMatchView(sides)!;
    expect(v.state).toBe("Not started");
    expect(v.notStarted).toBe(true);
  });
});

describe("Today in a closed round of matches", () => {
  it("does not tell a match player there's no card from them", () => {
    // `closedWithout` asks only of a round that files the player's own card.
    expect(readSource("src/lib/services/me.ts")).toMatch(/const closedWithout =[^;]*filesOwnCard/);
  });
});

describe("the Leaders panel on a match board", () => {
  const tile = (over: Partial<LeaderTile>): LeaderTile => ({
    id: "d", pos: "1", name: "D. ROBIN", thru: "", total: "10.5", under: false, you: false, gap: false, ...over,
  });

  it("says nothing of 'thru' — there is no such thing in match play", () => {
    const html = renderToStaticMarkup(<ScoreboardLeaders rows={[tile({})]} />);
    expect(html).toContain("Position 1, D. ROBIN, 10.5");
    expect(html).not.toContain("not started");
  });

  it("still says it on a stroke board — the control", () => {
    expect(renderToStaticMarkup(<ScoreboardLeaders rows={[tile({ thru: "–" })]} />)).toContain("not started");
  });
});
