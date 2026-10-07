import { describe, it, expect } from "vitest";
import { namedAfterPlayers } from "../side-name";

describe("namedAfterPlayers", () => {
  it("is true for the name the app builds from the players", () => {
    expect(namedAfterPlayers("Ann Doyle / Bob Ellery", ["Ann Doyle", "Bob Ellery"])).toBe(true);
  });

  it("is false for a side with a name of its own", () => {
    expect(namedAfterPlayers("The Bandits", ["Ann Doyle", "Bob Ellery"])).toBe(false);
  });

  it("is false when the names are the same people in another order", () => {
    // The order IS the name; a reordered list is not what the board printed.
    expect(namedAfterPlayers("Bob Ellery / Ann Doyle", ["Ann Doyle", "Bob Ellery"])).toBe(false);
  });

  it("is false for a side with nobody in it, which still says so", () => {
    expect(namedAfterPlayers("", [])).toBe(false);
  });
});
