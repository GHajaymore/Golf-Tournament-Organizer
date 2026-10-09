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

/**
 * NO BARE RECORD UNDER THE LEADERS (2026-10-09, grid cell T60). The panel's
 * note fell back to the player's record when there was no progress note —
 * which is exactly a completed tournament — so Today printed "0-0-2" on its
 * own beneath the board, a repeat of the record already in the position card.
 */
describe("the Leaders note", () => {
  it("is the progress note or nothing", () => {
    expect(readSource("src/app/(player)/me/page.tsx")).not.toMatch(/standing\?\.note \|\| standing\?\.record/);
  });
});

/**
 * MOVED ON TO THE NEXT ROUND (2026-10-09, grid cell T66). Between rounds the
 * player's Today shows the next open round, but the standing is still the
 * board's, after the closed one: the card headline read "FINAL · GROSS E" over
 * an empty Round 2 card, and "The committee has closed this round" sat under
 * a Round 2 heading. Walked on the built server; this pins the wiring.
 */
describe("Today between rounds", () => {
  const src = () => readSource("src/app/(player)/me/page.tsx");
  it("does not give the new round's card the closed round's label or total", () => {
    expect(src()).toMatch(/scoreLabel: movedOn \? undefined : standing\?\.scoreLabel/);
    expect(src()).toMatch(/total=\{\(movedOn \? "" : standing\?\.scoreText\) \|\| "–"\}/);
  });
  it("names the closed round in the note", () => {
    expect(src()).toMatch(/is closed — these standings are after it\./);
  });
});

/**
 * A BLANK CARD READS AS NO CARD (grid cell T66e). The cut gives survivors a
 * blank Round 2 card, which read "FINISH MY CARD · HOLE 1 · Entered, not yet
 * certified" with nothing entered.
 */
describe("Today's card with nothing on it", () => {
  it("offers Start my card and says nothing is returned", () => {
    const src = readSource("src/app/(player)/me/page.tsx");
    expect(src).toMatch(/const blankCard = !card \|\| card\.filled === 0;/);
    expect(src).toMatch(/label: blankCard\s*\?\s*"Start my card"/);
    expect(src).toMatch(/footer=\{blankCard \? "Nothing returned yet\." : cardState\.label\}/);
  });
});
