import { describe, it, expect } from "vitest";
import {
  chainIssues,
  standingsUnit,
  issuesForRound,
  isPointsBased,
  carryForwardPrompt,
  carryUnitsCompatible,
  type ChainRound,
} from "../format-chain";

const round = (position: number, format: string, over: Partial<ChainRound> = {}): ChainRound => ({
  id: `s${position}`,
  // A playing round unless a case says otherwise: these fixtures are about
  // whether consecutive ROUNDS fit together, and a cut is not one.
  type: "Stroke Play Round",
  position,
  format,
  scoringBasis: "gross",
  carryForwardEnabled: false,
  cutEnabled: false,
  ...over,
});

const kinds = (rs: ChainRound[]) => chainIssues(rs).map((i) => i.kind);

describe("standingsUnit", () => {
  it("reads the basis, not just the format", () => {
    // Stroke play scored as Stableford measures points, not strokes — which is
    // why this can't be read off the format name alone.
    expect(standingsUnit("Stroke Play", "gross")).toBe("strokes");
    expect(standingsUnit("Stroke Play", "stableford")).toBe("Stableford points");
  });

  it("separates the two Stableford scales", () => {
    // Modified Stableford has different point values and no floor at zero, so
    // carrying between them would be adding unlike numbers.
    expect(standingsUnit("Modified Stableford", "gross")).not.toBe(
      standingsUnit("Stroke Play", "stableford"),
    );
  });

  it("treats match play and Nassau as the same unit", () => {
    // A Nassau is three match-play bets sliced from one card.
    expect(standingsUnit("Nassau", "gross")).toBe(standingsUnit("Match Play", "gross"));
  });

  it("gives skins their own unit", () => {
    expect(standingsUnit("Skins", "gross")).toBe("skins");
  });

  it("scores team rounds in strokes unless they are Stableford", () => {
    expect(standingsUnit("Scramble", "gross")).toBe("strokes");
    expect(standingsUnit("Four-Ball", "stableford")).toBe("Stableford points");
  });
});

describe("independent rounds are not a problem", () => {
  it("says nothing when nothing chains", () => {
    // Two unrelated formats side by side is an ordinary multi-format event.
    // Only carry-forward and cuts make one round depend on another.
    expect(kinds([round(0, "Match Play"), round(1, "Stroke Play")])).toEqual([]);
    expect(kinds([round(0, "Skins"), round(1, "Scramble")])).toEqual([]);
  });

  it("says nothing about a single round", () => {
    expect(kinds([round(0, "Scramble", { carryForwardEnabled: true, cutEnabled: true })])).toEqual([]);
  });

  it("says nothing about no rounds at all", () => {
    expect(chainIssues([])).toEqual([]);
  });
});

describe("carry-forward between mismatched units", () => {
  it("flags match points carried into stroke play", () => {
    const issues = chainIssues([
      round(0, "Match Play"),
      round(1, "Stroke Play", { carryForwardEnabled: true }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("carry-unit-mismatch");
    expect(issues[0].message).toMatch(/match points/);
    expect(issues[0].message).toMatch(/strokes/);
  });

  it("flags the two Stableford scales as different", () => {
    expect(
      kinds([
        round(0, "Stroke Play", { scoringBasis: "stableford" }),
        round(1, "Modified Stableford", { carryForwardEnabled: true }),
      ]),
    ).toEqual(["carry-unit-mismatch"]);
  });

  it("accepts a carry between rounds measuring the same thing", () => {
    expect(
      kinds([round(0, "Match Play"), round(1, "Match Play", { carryForwardEnabled: true })]),
    ).toEqual([]);
    expect(
      kinds([round(0, "Stroke Play"), round(1, "Stroke Play", { carryForwardEnabled: true })]),
    ).toEqual([]);
  });

  it("warns about carrying out of a Nassau even when the unit matches", () => {
    // Same unit as match play, but a Nassau settles three bets and only the
    // overall carries — worth saying so rather than letting an organizer
    // assume all three count.
    expect(
      kinds([round(0, "Nassau"), round(1, "Match Play", { carryForwardEnabled: true })]),
    ).toEqual(["carry-from-nassau"]);
  });

  it("warns about carrying skins forward", () => {
    // Skins reward one hole enormously; carrying them distorts a round-based
    // tournament far more than the play justifies.
    expect(
      kinds([round(0, "Skins"), round(1, "Skins", { carryForwardEnabled: true })]),
    ).toEqual(["carry-from-skins"]);
  });

  it("only reports the mismatch once when the unit is already wrong", () => {
    // A Nassau into stroke play is a unit mismatch; adding the Nassau note on
    // top would be two warnings for one decision.
    const issues = chainIssues([
      round(0, "Nassau"),
      round(1, "Stroke Play", { carryForwardEnabled: true }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("carry-unit-mismatch");
  });
});

describe("cuts across the team boundary", () => {
  it("flags a cut from a team round into an individual one", () => {
    // The scramble ranked four-person sides; the cut has to answer which
    // players advance, and nobody has been asked.
    const issues = chainIssues([
      round(0, "Scramble"),
      round(1, "Match Play", { cutEnabled: true }),
    ]);
    expect(issues.map((i) => i.kind)).toContain("cut-team-to-individual");
    expect(issues[0].message).toMatch(/ranks sides, not players/);
  });

  it("flags a cut from an individual round into a team one", () => {
    expect(
      kinds([round(0, "Stroke Play"), round(1, "Four-Ball", { cutEnabled: true })]),
    ).toEqual(["cut-individual-to-team"]);
  });

  it("says nothing when both rounds are individual", () => {
    expect(
      kinds([round(0, "Stroke Play"), round(1, "Match Play", { cutEnabled: true })]),
    ).toEqual([]);
  });
});

describe("team size changes", () => {
  it("flags a change of side size between team rounds", () => {
    // Pairs on Saturday, fours on Sunday: the sides can't just carry over.
    expect(kinds([round(0, "Foursomes"), round(1, "Scramble")])).toEqual(["team-size-change"]);
  });

  it("says nothing when the side size is unchanged", () => {
    // Four-ball and foursomes are both pairs — a classic member-guest pairing
    // plays both off the same partnership.
    expect(kinds([round(0, "Four-Ball"), round(1, "Foursomes")])).toEqual([]);
  });

  it("reports it regardless of carry or cut, because the draw changes either way", () => {
    expect(kinds([round(0, "Foursomes"), round(1, "Scramble", { cutEnabled: true })])).toContain(
      "team-size-change",
    );
  });
});

describe("robustness", () => {
  it("ignores rounds whose format it doesn't recognize", () => {
    // An imported or legacy label shouldn't produce confident nonsense.
    expect(
      kinds([round(0, "Some Legacy Format"), round(1, "Stroke Play", { carryForwardEnabled: true })]),
    ).toEqual([]);
  });

  it("sorts by position rather than trusting array order", () => {
    const issues = chainIssues([
      round(1, "Stroke Play", { carryForwardEnabled: true }),
      round(0, "Match Play"),
    ]);
    expect(issues.map((i) => i.kind)).toEqual(["carry-unit-mismatch"]);
  });

  it("reports each issue on the later round of the pair", () => {
    // That's where the setting causing it lives, so that's the card to show it on.
    const issues = chainIssues([
      round(0, "Match Play"),
      round(1, "Stroke Play", { carryForwardEnabled: true }),
    ]);
    expect(issues[0].round).toBe(1);
    expect(issuesForRound(issues, 1)).toHaveLength(1);
    expect(issuesForRound(issues, 0)).toHaveLength(0);
  });

  it("walks a long chain and catches every link", () => {
    const issues = chainIssues([
      round(0, "Match Play"),
      round(1, "Stroke Play", { carryForwardEnabled: true }), // unit mismatch
      round(2, "Scramble", { cutEnabled: true }), // individual -> team cut
      round(3, "Foursomes"), // side size change
    ]);
    expect(issues.map((i) => i.kind)).toEqual([
      "carry-unit-mismatch",
      "cut-individual-to-team",
      "team-size-change",
    ]);
  });
});

describe("asking about carry-forward", () => {
  const base = {
    chainsRounds: true,
    hasNextRound: true,
    format: "Match Play",
    scoringBasis: "gross",
    answered: false,
    locked: false,
  };

  it("knows which scoring is counted in points", () => {
    expect(isPointsBased(standingsUnit("Match Play", "gross"))).toBe(true);
    expect(isPointsBased(standingsUnit("Stroke Play", "stableford"))).toBe(true);
    expect(isPointsBased(standingsUnit("Skins", "gross"))).toBe(true);
    expect(isPointsBased(standingsUnit("Stroke Play", "gross"))).toBe(false);
  });

  it("asks in a chained points league", () => {
    // The one consequential decision in a points league, previously an
    // unchecked box halfway down a collapsed panel.
    const p = carryForwardPrompt(base);
    expect(p.ask).toBe(true);
    expect(p.inert).toBe(false);
    expect(p.question).toMatch(/match points/);
  });

  it("asks for Stableford too, which is also points", () => {
    const p = carryForwardPrompt({ ...base, format: "Stroke Play", scoringBasis: "stableford" });
    expect(p.ask).toBe(true);
    expect(p.question).toMatch(/Stableford points/);
  });

  it("does not ask about stroke play, where the switch does nothing", () => {
    // strokeStandings is built from the returned cards and never consults the
    // carried total, so the control can be turned on and have no effect.
    const p = carryForwardPrompt({ ...base, format: "Stroke Play", scoringBasis: "gross" });
    expect(p.ask).toBe(false);
    expect(p.inert).toBe(true);
    expect(p.detail).toMatch(/only moves points/);
  });

  it("stays quiet once the organizer has answered", () => {
    expect(carryForwardPrompt({ ...base, answered: true }).ask).toBe(false);
  });

  it("stays quiet when there is no next round to carry into", () => {
    expect(carryForwardPrompt({ ...base, hasNextRound: false }).ask).toBe(false);
  });

  it("stays quiet in a single-round tournament", () => {
    expect(carryForwardPrompt({ ...base, chainsRounds: false }).ask).toBe(false);
  });

  it("stays quiet once the tournament is locked", () => {
    // Asking a question whose answer can't be applied is worse than not asking.
    expect(carryForwardPrompt({ ...base, locked: true }).ask).toBe(false);
  });

  it("still reports the unit when it isn't asking", () => {
    // The card uses this to explain itself even when there's no question.
    const p = carryForwardPrompt({ ...base, answered: true });
    expect(p.unit).toBe("match points");
    expect(p.detail.length).toBeGreaterThan(20);
  });
});

describe("whether points may carry across a format boundary", () => {
  // The cut chains regardless of format (the survivors advance either way), but
  // points only carry when the two rounds measure the same thing. Match points
  // scaled into a stroke round's totals is a meaningless number, so it must not
  // carry silently — the advancement carries, the points reset, chainIssues
  // warns.

  it("lets two match-play rounds carry", () => {
    expect(
      carryUnitsCompatible({ format: "Match Play", scoringBasis: "gross" }, { format: "Match Play", scoringBasis: "gross" }),
    ).toBe(true);
  });

  it("refuses match points into a stroke-play round", () => {
    expect(
      carryUnitsCompatible({ format: "Match Play", scoringBasis: "gross" }, { format: "Stroke Play", scoringBasis: "gross" }),
    ).toBe(false);
  });

  it("lets two Stableford rounds carry, since both are in points", () => {
    expect(
      carryUnitsCompatible(
        { format: "Stroke Play", scoringBasis: "stableford" },
        { format: "Stroke Play", scoringBasis: "stableford" },
      ),
    ).toBe(true);
  });

  it("reads the basis, not just the format — strokes and Stableford differ", () => {
    expect(
      carryUnitsCompatible(
        { format: "Stroke Play", scoringBasis: "gross" },
        { format: "Stroke Play", scoringBasis: "stableford" },
      ),
    ).toBe(false);
  });
});
