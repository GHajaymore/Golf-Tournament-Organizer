import { describe, it, expect } from "vitest";
import { newEventDefaults } from "../event-defaults";
import { isBracketMode } from "../bracket";

describe("newEventDefaults", () => {
  it("a new event starts as one bracket", () => {
    expect(newEventDefaults().bracketMode).toBe("single");
  });
  it("the value is one the app reads as a bracket mode", () => {
    expect(isBracketMode(newEventDefaults().bracketMode)).toBe(true);
  });
});
