import { describe, expect, it } from "vitest";
import { matchKeptBy, matchKeptByChosen, keptByScoreInput, MATCH_KEPT_BY } from "@/lib/domain/match-kept-by";
import { TOURNAMENT_TEMPLATES } from "@/lib/tournament-templates";
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

  it("the server holds a round only to a STATED choice", () => {
    // Undecided: what screens offer has a default, and nothing is refused —
    // the console's own default for a net match is a stroke card.
    expect(matchKeptByChosen(round("Round Robin", "Match Play"))).toBeNull();
    expect(matchKeptByChosen(round("Team Session", "Four-Ball"))).toBeNull();
    expect(matchKeptByChosen(round("Round Robin", "Four-Ball"))).toBeNull();
    // Said on How scores are recorded, or on the setting.
    expect(matchKeptByChosen(round("Round Robin", "Match Play", "hole-results"))).toBe("holes");
    expect(matchKeptByChosen(round("Round Robin", "Match Play", "gross-cards"))).toBe("cards");
    expect(matchKeptByChosen(round("Team Session", "Four-Ball", "", "holes"))).toBe("holes");
    expect(matchKeptByChosen(round("Round Robin", "Four-Ball", "", "cards"))).toBe("cards");
    // A value the format does not offer is not a statement.
    expect(matchKeptByChosen(round("Round Robin", "Match Play", "side-only"))).toBeNull();
    expect(matchKeptByChosen(round("Team Session", "Four-Ball", "", "strokes"))).toBeNull();
    // And never on a round with no matches.
    expect(matchKeptByChosen(round("Stroke Play Round", "Stroke Play", "", "cards"))).toBeNull();
  });

  it("a cup made from the template is kept by tapping, stated", () => {
    const cup = TOURNAMENT_TEMPLATES.find((t) => t.rounds?.some((r) => r.type === "Team Session"));
    expect(cup, "no cup template").toBeDefined();
    for (const r of cup!.rounds ?? []) {
      const stated = keptByScoreInput(r.format)
        ? round(r.type, r.format, r.kept === "cards" ? "gross-cards" : "hole-results")
        : round(r.type, r.format, "", r.kept ?? "");
      expect(matchKeptByChosen(stated), `${r.description}`).toBe("holes");
    }
  });

  it("offers exactly the two ways, each said in words", () => {
    expect(MATCH_KEPT_BY.map((m) => m.key)).toEqual(["holes", "cards"]);
    for (const m of MATCH_KEPT_BY) expect(m.detail.length).toBeGreaterThan(40);
  });
});
