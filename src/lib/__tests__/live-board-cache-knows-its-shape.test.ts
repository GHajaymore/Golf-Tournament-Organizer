import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * A CACHED PUBLIC BOARD IS NEVER READ BY CODE EXPECTING A DIFFERENT SHAPE.
 *
 * `liveBoard` caches the public board with `unstable_cache`, and the data
 * cache outlives the code that filled it — on Vercel across deployments, and
 * `revalidate` serves a stale entry once while it refreshes. On 2026-09-26 the
 * seeded April Medal's public link returned a 500 ("Cannot read properties of
 * undefined (reading 'length')") because an entry built before `draws` existed
 * was read by the page that now uses it — then a clean 200 a moment later.
 *
 * Two guards. The key carries the deployment, so a new deploy never reads the
 * last one's entries. And it carries `LIVE_BOARD_SHAPE`, which this test ties
 * to the fields of `LiveBoardView`: add or remove a field and it goes red until
 * the number is bumped, which is the one step nobody would otherwise remember.
 */
const src = readSource("src/lib/services/live-board.ts");

/** The top-level field names of `LiveBoardView`, in order. */
function viewFields(): string[] {
  const start = src.indexOf("export interface LiveBoardView {");
  // The interface's own closing brace sits at column 0; CRLF on a checkout, so
  // the search is for the brace at the start of a line, not for "\n}\n".
  const body = src.slice(start, start + src.slice(start).search(/\r?\n\}/));
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
}

// The fields shape 2 was written for. When this list changes, bump
// LIVE_BOARD_SHAPE in live-board.ts AND update both numbers here.
const SHAPE = 2;
const FIELDS = [
  "name", "dates", "venue", "teamFormat", "rows", "teamRows", "teamMatchRows", "pointsSystem",
  "skins", "nassau", "modStableford", "skinsNet", "kind", "teamRound", "isStroke", "isStableford",
  "teamBasis", "holeCount", "cutNote", "unit", "manualFormat", "draws", "bracketResults",
  "straightKnockout", "allIn", "roundLabel", "brand", "themeStyleSheet", "colorScheme",
];

describe("the public board's cache", () => {
  it("reads the view's fields (control)", () => {
    expect(viewFields().length).toBeGreaterThan(20);
    expect(viewFields()).toContain("draws");
  });

  it("is keyed on the deployment and the shape", () => {
    expect(src).toMatch(/unstable_cache\(\(\) => gather\(eventId\), \["live-board", `v\$\{LIVE_BOARD_SHAPE\}`, deployment, eventId\]/);
    expect(src).toMatch(/process\.env\.VERCEL_DEPLOYMENT_ID/);
  });

  it("has its shape number bumped whenever the view's fields change", () => {
    expect(
      viewFields(),
      "LiveBoardView changed: bump LIVE_BOARD_SHAPE in live-board.ts, then update SHAPE and FIELDS here",
    ).toEqual(FIELDS);
    expect(src).toContain(`export const LIVE_BOARD_SHAPE = ${SHAPE};`);
  });
});
