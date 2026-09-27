import { describe, it, expect } from "vitest";
import { sheetOnScreen } from "@/lib/domain/tee-sheet";
import { readSource } from "./source";

/**
 * THE TEE SHEET SCREEN SHOWS THE SHEET OF RECORD — see `sheetOnScreen`.
 *
 * Walked 2026-09-27: over a published sheet the screen showed a fresh shuffle,
 * so the organizer and the printed cards on one page named different groups
 * and times for the same player.
 */
const saved = [{ name: "Group 1", startHole: 1, time: "8:10 AM", playerIds: ["seamus", "bernadette"] }];
const preview = [{ name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: ["wallace", "odette"] }];

describe("which sheet the tee-sheet screen shows", () => {
  it("the saved one, whenever there is one and nobody is re-drawing", () => {
    expect(sheetOnScreen(saved, preview, false)).toEqual({ source: "saved", groups: saved });
  });

  it("the draw being made, while re-drawing — the builder is the job then", () => {
    expect(sheetOnScreen(saved, preview, true)).toEqual({ source: "preview", groups: preview });
  });

  it("the draw, when no sheet has been saved yet", () => {
    expect(sheetOnScreen([], preview, false)).toEqual({ source: "preview", groups: preview });
  });

  it("and the page hands the component the saved groups", () => {
    const page = readSource("src", "app", "(app)", "foursomes", "page.tsx");
    expect(page).toMatch(/<FoursomeMaker[\s\S]*?savedGroups=\{savedSheet\?\.groups \?\? \[\]\}/);
  });
});
