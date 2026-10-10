import { describe, it, expect } from "vitest";
import { readSource } from "./source";
import { findFormat } from "@/lib/formats";

/**
 * A TEAM ROUND IS SCORED BY ITS PLAYERS (2026-10-10).
 *
 * Walked on a club's 120-player four-ball: sixty pairs on the course, and every
 * member's My card read "This card belongs to your side … Your organizer enters
 * it", with nothing to tap — while score entry already takes a four-ball
 * partner's own card and a shared-ball side's one card from a player
 * (`saveTeamScorecard`, and `/entry` shows a player exactly the cards they may
 * save). My card is only reached where players report their own scores.
 */
describe("a member's way to their side's card", () => {
  const card = readSource("src/app/(player)/me/card/page.tsx");
  const today = readSource("src/app/(player)/me/page.tsx");

  it("My card offers the card to enter, by the round, in the words of the format", () => {
    expect(card).toMatch(/href: `\/entry\?round=\$\{stage\.id\}`/);
    expect(card).toMatch(/ownBall \? "Enter my card" : "Enter our side's card"/);
  });

  it("and no longer tells a team-round player the organizer enters it", () => {
    // The organizer sentence survives only for match play.
    expect(card).toMatch(/teamRound\s*\?\s*"It appears on the board as soon as it’s in\."\s*:\s*`Your \$\{terms\.organizer\} enters it/);
  });

  it("Today's side card has the same way in, where players score", () => {
    expect(today).toMatch(/canEnterScores\(settingsOf\(state\.event\), session\.viewRole\) && \(\s*<Link href=\{`\/entry\?round=\$\{round\.stageId\}`\}/);
  });

  it("knows which team formats are one ball each — the words depend on it", () => {
    // The control on `ownBall`: four-ball is each partner's own card, a
    // scramble is one ball for the side.
    expect(findFormat("Four-Ball").ball).toBe("individual");
    expect(findFormat("Scramble").ball).toBe("single");
  });
});
