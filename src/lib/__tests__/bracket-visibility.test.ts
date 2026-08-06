import { describe, it, expect } from "vitest";
import {
  bracketVisibility,
  showBracket,
  bracketBadge,
  type BracketProgress,
} from "../bracket-visibility";

const at = (complete: number, total = 48, extra: Partial<BracketProgress> = {}): BracketProgress => ({
  hasBracketStage: true,
  matchesComplete: complete,
  matchesTotal: total,
  bracketStarted: false,
  qualificationDecided: false,
  ...extra,
});

describe("bracket tile visibility", () => {
  it("stays hidden when the tournament has no bracket", () => {
    expect(bracketVisibility({ ...at(48), hasBracketStage: false })).toBe("hidden");
    expect(showBracket({ ...at(48), hasBracketStage: false })).toBe(false);
  });

  it("stays hidden early, when seeding is noise", () => {
    // Two of forty-eight results say nothing about the final ordering, and a
    // bracket shown then gets screenshotted and argued about.
    expect(bracketVisibility(at(0))).toBe("hidden");
    expect(bracketVisibility(at(2))).toBe("hidden");
    expect(bracketVisibility(at(23))).toBe("hidden");
  });

  it("appears as provisional once the round robin is half done", () => {
    expect(bracketVisibility(at(24))).toBe("provisional");
    expect(bracketVisibility(at(40))).toBe("provisional");
    expect(bracketBadge(at(24))).toBe("Provisional");
  });

  it("is set once every match is in", () => {
    expect(bracketVisibility(at(48))).toBe("set");
    expect(bracketBadge(at(48))).toBe("Set");
  });

  it("is set once qualification has decided who advances", () => {
    expect(bracketVisibility(at(30, 48, { qualificationDecided: true }))).toBe("set");
  });

  it("always shows once the bracket is being played", () => {
    // Whatever the round robin says, the bracket is now the live competition.
    expect(bracketVisibility(at(1, 48, { bracketStarted: true }))).toBe("set");
    expect(showBracket(at(0, 48, { bracketStarted: true }))).toBe(true);
  });

  it("hides rather than dividing by zero when no matches exist", () => {
    expect(bracketVisibility(at(0, 0))).toBe("hidden");
    expect(bracketBadge(at(0, 0))).toBeNull();
  });

  it("gives no badge while hidden", () => {
    expect(bracketBadge(at(2))).toBeNull();
  });
});
