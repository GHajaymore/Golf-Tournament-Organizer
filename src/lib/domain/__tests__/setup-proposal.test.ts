import { describe, it, expect } from "vitest";
import { parseSetupProposal, setupPrompt } from "../setup-proposal";
import { PLAYABLE_FORMAT_NAMES } from "../../formats";
import { STAGE_TYPES } from "../../stage-types";

/**
 * The boundary between a sentence and a tournament's configuration.
 *
 * A wrong setup here is worse than a wrong score: a club briefs a field on it,
 * plays a day, and finds out afterwards. So these tests are mostly about what
 * must not get through, and about the app saying "I don't know" where the
 * description genuinely did not say.
 */

const parse = (raw: unknown) => parseSetupProposal(raw, PLAYABLE_FORMAT_NAMES, STAGE_TYPES);

const round = (over: Record<string, unknown> = {}) => ({
  type: "Round Robin",
  format: "Four-Ball",
  holes: 18,
  scoringBasis: "net",
  ...over,
});

describe("what it accepts", () => {
  it("takes a well-formed proposal", () => {
    const p = parse({ rounds: [round()], allowancePct: 90, fieldSize: 24 });
    expect(p.rounds).toHaveLength(1);
    expect(p.rounds[0].format).toBe("Four-Ball");
    expect(p.allowancePct).toBe(90);
    expect(p.fieldSize).toBe(24);
    expect(p.empty).toBe(false);
  });

  it("matches a format however the model capitalised it, and stores ours", () => {
    // Models return "four-ball" for "Four-Ball" constantly. Accepting the
    // spelling but storing the app's own keeps one canonical value.
    const p = parse({ rounds: [round({ format: "four-ball" })] });
    expect(p.rounds[0].format).toBe("Four-Ball");
  });
});

describe("what it refuses", () => {
  it("drops a format the app cannot actually score", () => {
    // The failure this prevents: a round an organizer sets up, briefs a field
    // on, and then finds has nowhere to enter a card.
    const p = parse({ rounds: [round({ format: "Bramble Wolf Special" })] });
    expect(p.rounds).toHaveLength(0);
    expect(p.questions.join(" ")).toContain("Bramble Wolf Special");
  });

  it("drops an invented round type", () => {
    expect(parse({ rounds: [round({ type: "Shootout Stage" })] }).rounds).toHaveLength(0);
  });

  it("keeps the good rounds and drops only the bad one", () => {
    const p = parse({ rounds: [round(), round({ format: "Nonsense" }), round()] });
    expect(p.rounds).toHaveLength(2);
  });

  it("only ever produces nine or eighteen holes", () => {
    for (const holes of [1, 7, 12, 27, 0, -9, 18.5, "lots"]) {
      const p = parse({ rounds: [round({ holes })] });
      expect([9, 18], `holes: ${holes}`).toContain(p.rounds[0].holes);
    }
    expect(parse({ rounds: [round({ holes: 9 })] }).rounds[0].holes).toBe(9);
  });

  it("refuses an allowance that is not a real percentage", () => {
    for (const bad of [0, -10, 900, 90.5, "most of it", null]) {
      expect(parse({ rounds: [round()], allowancePct: bad }).allowancePct, `${bad}`).toBeNull();
    }
    expect(parse({ rounds: [round()], allowancePct: 100 }).allowancePct).toBe(100);
  });

  it("falls back to gross rather than inventing a scoring basis", () => {
    expect(parse({ rounds: [round({ scoringBasis: "quota points" })] }).rounds[0].scoringBasis).toBe("gross");
  });

  it("ignores a cut that names a round which does not exist", () => {
    const p = parse({
      rounds: [round()],
      cut: { afterRound: 4, mode: "count", value: 8, scope: "overall" },
    });
    expect(p.cut).toBeNull();
  });
});

describe("what it asks rather than guesses", () => {
  it("asks whether a cut is overall or per flight", () => {
    // These are different tournaments. Per flight sends someone through from
    // every flight; overall can send four from one and none from another.
    const p = parse({
      rounds: [round(), round()],
      cut: { afterRound: 1, mode: "count", value: 8, scope: null },
    });
    expect(p.cut?.scope).toBeNull();
    expect(p.questions.join(" ")).toContain("each flight");
  });

  it("stays quiet when the description did settle it", () => {
    const p = parse({
      rounds: [round(), round()],
      cut: { afterRound: 1, mode: "count", value: 8, scope: "perFlight" },
    });
    expect(p.cut?.scope).toBe("perFlight");
    expect(p.questions.join(" ")).not.toContain("each flight");
  });

  it("says so when it worked nothing out", () => {
    const p = parse({ rounds: [] });
    expect(p.empty).toBe(true);
    expect(p.questions.length).toBeGreaterThan(0);
  });
});

describe("junk and refusals", () => {
  it("returns an empty proposal rather than throwing", () => {
    for (const junk of [null, undefined, 42, "sorry, I can't help", [], { rounds: "lots" }]) {
      const p = parse(junk);
      expect(p.rounds).toEqual([]);
      expect(p.empty).toBe(true);
    }
  });

  it("does not let a model set a hundred rounds", () => {
    const p = parse({ rounds: Array.from({ length: 50 }, () => round()) });
    expect(p.rounds.length).toBeLessThanOrEqual(12);
  });
});

describe("the prompt", () => {
  it("lists the allowed vocabulary rather than leaving it to imagination", () => {
    const p = setupPrompt("a two round member-guest", PLAYABLE_FORMAT_NAMES, STAGE_TYPES);
    expect(p).toContain("Four-Ball");
    expect(p).toContain("Round Robin");
    expect(p).toContain("a two round member-guest");
  });

  it("tells the model not to guess a cut's scope", () => {
    const p = setupPrompt("x", PLAYABLE_FORMAT_NAMES, STAGE_TYPES);
    expect(p).toContain("Do not guess");
    expect(p).toContain("scope to null");
  });

  it("only ever offers formats the app can run", () => {
    // The prompt and the parser must agree: offering something the parser
    // would reject wastes a call and confuses the organizer.
    const p = setupPrompt("x", PLAYABLE_FORMAT_NAMES, STAGE_TYPES);
    for (const name of PLAYABLE_FORMAT_NAMES) expect(p).toContain(name);
  });
});
