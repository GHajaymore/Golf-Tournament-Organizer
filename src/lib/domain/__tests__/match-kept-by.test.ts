import { describe, expect, it } from "vitest";
import { matchKeptBy, keptByScoreInput, MATCH_KEPT_BY } from "@/lib/domain/match-kept-by";
import { GOLF_FORMATS } from "@/lib/formats";

const round = (type: string, format: string, scoreInput = "", kept = "") => ({
  type,
  format,
  scoreInput,
  matchKeptBy: kept,
});

describe("how a round's matches are kept", () => {
  it("a round with no matches has no answer", () => {
    expect(matchKeptBy(round("Stroke Play Round", "Stroke Play"))).toBeNull();
    expect(matchKeptBy(round("Stroke Play Round", "Four-Ball"))).toBeNull();
    // A knockout's draw files a winner per tie.
    expect(matchKeptBy(round("Bracket Stage", "Match Play"))).toBeNull();
  });

  it("a Nassau is a match round whatever its round type says", () => {
    expect(matchKeptBy(round("Stroke Play Round", "Nassau"))).toBe("holes");
    expect(matchKeptBy(round("Stroke Play Round", "Nassau", "gross-cards"))).toBe("cards");
  });

  it("Match Play answers from How scores are recorded, never from a second control", () => {
    expect(matchKeptBy(round("Round Robin", "Match Play"))).toBe("holes");
    expect(matchKeptBy(round("Round Robin", "Match Play", "hole-results"))).toBe("holes");
    expect(matchKeptBy(round("Round Robin", "Match Play", "match-result"))).toBe("holes");
    expect(matchKeptBy(round("Round Robin", "Match Play", "gross-cards"))).toBe("cards");
    // A stray matchKeptBy on a Match Play round cannot overrule its scoreInput.
    expect(matchKeptBy(round("Round Robin", "Match Play", "hole-results", "cards"))).toBe("holes");
    expect(matchKeptBy(round("Team Session", "Match Play", "gross-cards", "holes"))).toBe("cards");
  });

  it("a cup session is tapped unless the organizer chose cards", () => {
    expect(matchKeptBy(round("Team Session", "Four-Ball"))).toBe("holes");
    expect(matchKeptBy(round("Team Session", "Foursomes"))).toBe("holes");
    expect(matchKeptBy(round("Team Session", "Four-Ball", "", "cards"))).toBe("cards");
    // The cup's singles are Match Play, tapped by default like the rest.
    expect(matchKeptBy(round("Team Session", "Match Play"))).toBe("holes");
  });

  it("any other team match is kept on cards unless the organizer chose tapping", () => {
    expect(matchKeptBy(round("Round Robin", "Four-Ball"))).toBe("cards");
    expect(matchKeptBy(round("Single Match Stage", "Foursomes"))).toBe("cards");
    expect(matchKeptBy(round("Round Robin", "Four-Ball", "", "holes"))).toBe("holes");
  });

  it("a value the app does not know is read as not chosen", () => {
    expect(matchKeptBy(round("Team Session", "Four-Ball", "", "strokes"))).toBe("holes");
    expect(matchKeptBy(round("Round Robin", "Four-Ball", "", " HOLES "))).toBe("cards");
  });

  it("every format a match round can be played in has exactly one answer", () => {
    for (const f of GOLF_FORMATS) {
      for (const type of ["Round Robin", "Single Match Stage", "Team Session"]) {
        const kept = matchKeptBy(round(type, f.name));
        expect(kept === "holes" || kept === "cards", `${type} · ${f.name}`).toBe(true);
      }
    }
  });

  it("the formats that carry the choice in scoreInput are the two that offer hole results", () => {
    expect(GOLF_FORMATS.filter((f) => keptByScoreInput(f.name)).map((f) => f.name).sort()).toEqual(["Match Play", "Nassau"]);
  });

  it("offers exactly the two ways, each said in words", () => {
    expect(MATCH_KEPT_BY.map((m) => m.key)).toEqual(["holes", "cards"]);
    for (const m of MATCH_KEPT_BY) expect(m.detail.length).toBeGreaterThan(40);
  });
});
