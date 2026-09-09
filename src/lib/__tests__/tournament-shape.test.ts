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

  it("opens no shape on a round the organizer did not choose", () => {
    /**
     * REPLACES two tests that asserted the opposite, and the swap is the
     * point rather than a tidy-up.
     *
     * A `ShapeOption` used to carry an `openingRound` — "what this shape
     * starts with, so nobody begins on an empty screen" — and `createEvent`
     * read it, so every from-scratch tournament arrived holding a Round Robin
     * nobody had been asked about. The two tests here checked that the round
     * it defaulted to was a playable one, which is a real property of a thing
     * that should not exist: they made the default look considered.
     *
     * The field is gone, so this asserts its ABSENCE — the safe direction,
     * and the one a comment cannot satisfy. A shape describes how a
     * tournament is played; it does not decide a single round of it.
     */
    for (const s of TOURNAMENT_SHAPES) {
      expect(s, `${s.key} must not carry a round`).not.toHaveProperty("openingRound");
    }
    expect(shapeOption("knockout")).not.toHaveProperty("openingRound");
    // The formats list is still what a round is checked against — just not
    // here, because there is no round here to check.
    expect(PLAYABLE_FORMAT_NAMES.length).toBeGreaterThan(0);
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
