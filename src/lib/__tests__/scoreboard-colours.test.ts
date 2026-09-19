import { describe, it, expect } from "vitest";
import { readSource } from "./source";
import { contrastRatio } from "@/lib/themes";

/**
 * The hand-hung scoreboard's fixed palette (`--sb-*` in globals.css) is read
 * outdoors on a phone like every score in the app. Measured here from the
 * stylesheet itself, so a colour changed there is judged here — the comment
 * beside the tokens deliberately quotes no numbers.
 *
 * Floors: 4.5:1 for every text pair (WCAG AA), and the app's 7:1 sunlight bar
 * for the numbers a player reads most — the tiles' ink and the frame's
 * lettering.
 */
const css = readSource("src/app/globals.css");
const token = (name: string): string => {
  const m = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`${name} is not declared as a hex colour in globals.css`);
  return m[1];
};

describe("the scoreboard's colours", () => {
  const PAIRS: [string, string, number][] = [
    ["--sb-ink", "--sb-tile", 7],
    ["--sb-ink", "--sb-blank", 7],
    ["--sb-on-frame", "--sb-frame", 7],
    ["--sb-red", "--sb-tile", 4.5],
    ["--sb-green", "--sb-tile", 4.5],
    ["--sb-frame", "--sb-board", 4.5],
    ["--sb-green", "--sb-board", 4.5],
  ];

  it.each(PAIRS)("%s on %s clears %s:1", (fg, bg, floor) => {
    expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(floor);
  });

  it("can fail — a pale red on the tile would not pass", () => {
    expect(contrastRatio("#f08a84", "#ffffff")).toBeLessThan(4.5);
  });
});
