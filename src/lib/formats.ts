// Golf format catalog for the Round builder. Extensible — add entries here and
// they appear everywhere the format picker is used.

export interface GolfFormat {
  name: string;
  desc: string;
  /** Broad scoring family, for engines/UI hints. */
  family: "match" | "stroke" | "points" | "team";
}

export const GOLF_FORMATS: GolfFormat[] = [
  { name: "Match Play", family: "match", desc: "Head-to-head, hole-by-hole; the player who wins the most holes wins the match." },
  { name: "Stroke Play", family: "stroke", desc: "Count total strokes; lowest score wins. Gross or net." },
  { name: "Individual Match Play", family: "match", desc: "Singles match play between two players." },
  { name: "Individual Stroke Play", family: "stroke", desc: "Each player for their own total score." },
  { name: "Best Ball", family: "team", desc: "Team of partners; the best score on each hole counts for the team." },
  { name: "Four-Ball", family: "team", desc: "Two vs two; each plays their own ball, best of each side counts." },
  { name: "Foursomes", family: "team", desc: "Partners alternate shots playing one ball." },
  { name: "Alternate Shot", family: "team", desc: "Partners take turns hitting the same ball." },
  { name: "Scramble", family: "team", desc: "All play, pick the best shot, all play from there." },
  { name: "Texas Scramble", family: "team", desc: "Scramble requiring a minimum number of drives per player." },
  { name: "Shamble", family: "team", desc: "Scramble off the tee, then each plays their own ball in." },
  { name: "Stableford", family: "points", desc: "Points per hole vs a fixed target; highest points wins." },
  { name: "Modified Stableford", family: "points", desc: "Stableford with amplified points for eagles/birdies and penalties for bogeys." },
  { name: "Skins", family: "points", desc: "Each hole is a skin; win it outright to claim, otherwise it carries over." },
  { name: "Nassau", family: "match", desc: "Three matches in one: front nine, back nine, and overall." },
  { name: "Chapman / Pinehurst", family: "team", desc: "Both drive, swap balls for the second shot, then alternate." },
];

export const FORMAT_NAMES = GOLF_FORMATS.map((f) => f.name);

export function findFormat(name: string): GolfFormat {
  return GOLF_FORMATS.find((f) => f.name === name) ?? GOLF_FORMATS[0];
}

/**
 * Formats with a real scoring engine behind them today — everything else in
 * the catalog above is a label only (no dedicated entry UI or standings math),
 * so the round-format picker only offers these. `findFormat`/`FORMAT_NAMES`
 * still resolve the full catalog so a round set to one of the other formats
 * before this restriction (e.g. imported data) still displays correctly.
 */
export const SCORED_FORMAT_NAMES = ["Match Play", "Stroke Play"];
