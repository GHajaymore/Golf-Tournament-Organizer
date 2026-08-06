import { describe, it, expect } from "vitest";
import {
  TOURNAMENT_SHAPES,
  DEFAULT_SHAPE,
  shapeOf,
  shapeOption,
  isTournamentShape,
  capabilitiesOf,
  effectiveCapabilities,
} from "../tournament-shape";
import { PLAYABLE_FORMAT_NAMES } from "../formats";

describe("the shapes on offer", () => {
  it("has unique keys and real descriptions", () => {
    const keys = TOURNAMENT_SHAPES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of TOURNAMENT_SHAPES) {
      expect(s.blurb.length, `${s.key} needs a description someone can act on`).toBeGreaterThan(40);
    }
  });

  it("opens every shape on a format that can actually be run", () => {
    // A shape that started you on an unrunnable round would be the format
    // trap all over again, one level up.
    for (const s of TOURNAMENT_SHAPES) {
      expect(PLAYABLE_FORMAT_NAMES, `${s.key} opens on an unplayable format`).toContain(
        s.openingRound.format,
      );
    }
  });

  it("starts a knockout in a bracket and a league in a round robin", () => {
    expect(shapeOption("knockout").openingRound.type).toBe("Bracket Stage");
    expect(shapeOption("series").openingRound.type).toBe("Round Robin");
  });
});

describe("what each shape implies", () => {
  it("gives a single round nothing to carry into", () => {
    // The point of asking: a one-day charity scramble was being shown a
    // carry-forward percentage and a cut line into a round that never exists.
    const c = capabilitiesOf("single");
    expect(c.chainsRounds).toBe(false);
    expect(c.multipleRounds).toBe(false);
    expect(c.hasBracket).toBe(false);
  });

  it("chains a series but gives it no bracket", () => {
    const c = capabilitiesOf("series");
    expect(c.chainsRounds).toBe(true);
    expect(c.hasBracket).toBe(false);
  });

  it("gives a knockout a bracket, and still chains", () => {
    // A knockout can be fed by a group stage, and that stage's standings
    // decide the draw — so rounds still relate to each other.
    const c = capabilitiesOf("knockout");
    expect(c.hasBracket).toBe(true);
    expect(c.chainsRounds).toBe(true);
  });
});

describe("shapeOf", () => {
  it("defaults to what existing tournaments already are", () => {
    // Every event predating this column reads as a series, which shows every
    // control — exactly the behaviour they have today.
    expect(DEFAULT_SHAPE).toBe("series");
    expect(shapeOf(null)).toBe("series");
    expect(shapeOf(undefined)).toBe("series");
    expect(shapeOf("")).toBe("series");
    expect(shapeOf("nonsense")).toBe("series");
  });

  it("resolves the real ones", () => {
    expect(shapeOf("single")).toBe("single");
    expect(shapeOf("knockout")).toBe("knockout");
    expect(isTournamentShape("single")).toBe(true);
    expect(isTournamentShape("mystery")).toBe(false);
  });
});

describe("outgrowing the shape you started with", () => {
  it("follows the organizer rather than arguing", () => {
    // Someone who adds a second round to a single-round event has changed
    // their mind. Continuing to hide carry-forward would leave them with a
    // round they cannot connect to anything.
    const c = effectiveCapabilities("single", { roundCount: 2, hasBracketStage: false });
    expect(c.chainsRounds).toBe(true);
    expect(c.multipleRounds).toBe(true);
  });

  it("reveals the bracket once one actually exists", () => {
    // Otherwise a bracket stage added to a league would have no way to reach
    // its own screen.
    const c = effectiveCapabilities("series", { roundCount: 3, hasBracketStage: true });
    expect(c.hasBracket).toBe(true);
  });

  it("leaves a genuinely single round alone", () => {
    const c = effectiveCapabilities("single", { roundCount: 1, hasBracketStage: false });
    expect(c.chainsRounds).toBe(false);
    expect(c.hasBracket).toBe(false);
  });

  it("never takes a capability away that the shape grants", () => {
    // Capabilities only ever widen — a knockout with one round is still a
    // knockout, and hiding its bracket would be absurd.
    for (const s of TOURNAMENT_SHAPES) {
      const base = capabilitiesOf(s.key);
      const eff = effectiveCapabilities(s.key, { roundCount: 1, hasBracketStage: false });
      expect(eff.chainsRounds || !base.chainsRounds).toBe(true);
      expect(eff.hasBracket || !base.hasBracket).toBe(true);
      expect(eff.multipleRounds || !base.multipleRounds).toBe(true);
    }
  });
});
