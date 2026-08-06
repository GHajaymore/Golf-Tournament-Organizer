import { describe, it, expect } from "vitest";
import {
  bracketVisibility,
  showBracket,
  bracketBadge,
  feederFraction,
  type BracketProgress,
} from "../bracket-visibility";

const p = (over: Partial<BracketProgress> = {}): BracketProgress => ({
  hasBracketStage: true,
  feederProgress: 0,
  bracketStarted: false,
  qualificationDecided: false,
  ...over,
});

describe("no bracket", () => {
  it("stays hidden however complete everything else is", () => {
    expect(bracketVisibility(p({ hasBracketStage: false, feederProgress: 1 }))).toBe("hidden");
    expect(showBracket(p({ hasBracketStage: false }))).toBe(false);
  });
});

describe("a bracket fed by an earlier stage", () => {
  it("hides while the feeder is barely started", () => {
    // Seeding from a twentieth of the results implies a certainty that does
    // not exist, and organizers screenshot it.
    expect(bracketVisibility(p({ feederProgress: 0 }))).toBe("hidden");
    expect(bracketVisibility(p({ feederProgress: 0.05 }))).toBe("hidden");
    expect(bracketVisibility(p({ feederProgress: 0.49 }))).toBe("hidden");
  });

  it("shows as provisional from halfway", () => {
    expect(bracketVisibility(p({ feederProgress: 0.5 }))).toBe("provisional");
    expect(bracketVisibility(p({ feederProgress: 0.9 }))).toBe("provisional");
    expect(bracketBadge(p({ feederProgress: 0.5 }))).toBe("Provisional");
  });

  it("is set once the feeder finishes", () => {
    expect(bracketVisibility(p({ feederProgress: 1 }))).toBe("set");
    expect(bracketBadge(p({ feederProgress: 1 }))).toBe("Set");
  });
});

describe("tournament shapes other than round-robin-into-bracket", () => {
  it("shows a straight knockout immediately", () => {
    // Nothing feeds it: the draw is the tournament, seeded from entry and
    // known on day one. Hiding it would withhold the event itself — which is
    // what keying off round-robin progress used to do.
    expect(bracketVisibility(p({ feederProgress: null }))).toBe("set");
    expect(showBracket(p({ feederProgress: null }))).toBe(true);
  });

  it("is set the moment qualification resolves, at any feeder progress", () => {
    // A qualification stage decides the field outright; that is its job.
    expect(bracketVisibility(p({ feederProgress: 0.1, qualificationDecided: true }))).toBe("set");
  });

  it("is set once the bracket itself is being played", () => {
    expect(bracketVisibility(p({ feederProgress: 0, bracketStarted: true }))).toBe("set");
  });

  it("treats a stroke-play feeder the same as a match-play one", () => {
    // The rule never sees the unit — the caller passes cards for stroke play
    // and matches for a round robin, and the fraction means the same thing.
    const cards = feederFraction(16, 32); // half the field has returned a card
    const matches = feederFraction(24, 48); // half the matches are played
    expect(cards).toBe(matches);
    expect(bracketVisibility(p({ feederProgress: cards }))).toBe("provisional");
  });
});

describe("feederFraction", () => {
  it("returns null when there is nothing to measure", () => {
    // Null means "nothing feeds this", which the rule reads as show — not as
    // zero progress, which would read as hide.
    expect(feederFraction(0, 0)).toBeNull();
    expect(feederFraction(5, 0)).toBeNull();
  });

  it("clamps to 0..1 so bad counts can't invert the rule", () => {
    expect(feederFraction(-3, 10)).toBe(0);
    expect(feederFraction(50, 10)).toBe(1);
  });

  it("computes the ordinary case", () => {
    expect(feederFraction(24, 48)).toBe(0.5);
    expect(feederFraction(48, 48)).toBe(1);
  });
});

describe("badges", () => {
  it("gives none while hidden", () => {
    expect(bracketBadge(p({ feederProgress: 0.1 }))).toBeNull();
    expect(bracketBadge(p({ hasBracketStage: false }))).toBeNull();
  });
});
