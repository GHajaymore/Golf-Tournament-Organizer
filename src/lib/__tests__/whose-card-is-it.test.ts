import { describe, it, expect } from "vitest";
import { roundIsStroke, generatesPairings, isHeadToHead, STAGE_TYPES } from "@/lib/stage-types";
import { readSource } from "./source";

/**
 * WHOSE CARD IS IT — asked of the ROUND, never of whether the app drew it.
 *
 * Found on 2026-09-19 by opening the seeded club's knockout as a player: My
 * card rendered an individual stroke card, with a scoring pad, for a round
 * recorded against an opponent. The screen was asking `generatesPairings`,
 * which is true for exactly ONE type — Round Robin. A Bracket Stage and a
 * Single Match Stage are head-to-head and draw no pairings, because the
 * organizer sets those matches.
 *
 * `the-society-outing.test.ts` predicted it two hours earlier, in as many
 * words: "a screen using the second to decide whether a round is match play
 * would score this nine as a medal". It was written as a note about two
 * functions that read alike; it was describing a live bug.
 *
 * AND THE OPPOSITE DIRECTION IS ALSO REAL, which is why the fix is not simply
 * `isHeadToHead`. `round-shape.ts` records a Stableford charity day drawn as a
 * Round Robin: every player was told "your score is recorded against your
 * opponent" on the one screen they were meant to use. A head-to-head TYPE with
 * a card-scored FORMAT is still the player's own card.
 */

describe("the two functions that read alike", () => {
  it("do not agree, which is the whole hazard", () => {
    const drawn = STAGE_TYPES.filter((t) => generatesPairings(t));
    const against = STAGE_TYPES.filter((t) => isHeadToHead(t));
    expect(drawn).toEqual(["Round Robin"]);
    // Three types pit somebody against somebody; one of them draws the pairings.
    expect(against).toEqual(["Round Robin", "Single Match Stage", "Bracket Stage"]);
    expect(against.length).toBeGreaterThan(drawn.length);
  });

  it("names the knockout as head-to-head even though nothing is drawn", () => {
    for (const type of ["Bracket Stage", "Single Match Stage"]) {
      expect(isHeadToHead(type), type).toBe(true);
      expect(generatesPairings(type), type).toBe(false);
    }
  });
});

describe("which rounds are the player's own card", () => {
  it("is not the knockout", () => {
    // The bug, as the fixture had it: a bracket scored as match play.
    expect(roundIsStroke("Bracket Stage", "Match Play")).toBe(false);
    expect(roundIsStroke("Single Match Stage", "Four-Ball")).toBe(false);
    expect(roundIsStroke("Round Robin", "Match Play")).toBe(false);
  });

  it("is the charity day, even though its type is head-to-head", () => {
    // `round-shape.ts` has the incident: a Stableford outing drawn as a Round
    // Robin, every player refused their own card.
    expect(roundIsStroke("Round Robin", "Stableford")).toBe(true);
    expect(roundIsStroke("Round Robin", "Stroke Play")).toBe(true);
  });

  it("is every ordinary medal", () => {
    expect(roundIsStroke("Stroke Play Round", "Stroke Play")).toBe(true);
    expect(roundIsStroke("Stroke Play Round", "Stableford")).toBe(true);
  });
});

describe("the screen asks the right question", () => {
  it("My card reads the round, not the draw", () => {
    /**
     * Pinned in source because the difference is invisible in a rendered
     * screen until somebody opens a knockout — which is how it survived. Read
     * through `readSource`, which strips comments: the prose above the check
     * names both functions, and would otherwise satisfy this on its own.
     */
    const card = readSource("src", "app", "(player)", "me", "card", "page.tsx");
    expect(card).toMatch(/!roundIsStroke\(stage\.type, stage\.format\)/);
    expect(card, "asks whether the app drew the pairings, which is a different question").not.toMatch(
      /generatesPairings/,
    );
  });

  it("leaves the schedule screens asking about the draw, because that IS their question", () => {
    // The same function is right where the question is "will flights produce
    // a set of matches" — grouping and score entry. This is not a ban.
    const grouping = readSource("src", "app", "(app)", "grouping", "page.tsx");
    expect(grouping).toMatch(/generatesPairings/);
  });
});
