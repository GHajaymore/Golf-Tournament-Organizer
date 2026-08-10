import { GOLF_FORMATS, findFormat } from "./formats";

/**
 * "Who plays as a side?" — the question setup asks once.
 *
 * It exists because of a specific confusion. The word "format" meant two
 * different things: at setup it meant match play versus stroke play, and on
 * every round it meant Four-Ball, Foursomes, Scramble. An organizer who
 * answered the first one reasonably believed they had answered the format
 * question, and so never went looking for the second — which is where team
 * golf actually lives. Nothing anywhere else hinted it existed.
 *
 * So this asks the missing question in plain words, and then gets out of the
 * way. It picks what a new round starts on and it makes the Teams screen
 * reachable. It does not decide how anything is scored, and no scoring code
 * may read it.
 */

export const SIDE_STYLES = ["individual", "pairs", "teams", "varies"] as const;
export type SideStyle = (typeof SIDE_STYLES)[number];

export function isSideStyle(v: string): v is SideStyle {
  return (SIDE_STYLES as readonly string[]).includes(v);
}

/** Unknown values fall back to the safe, common case rather than throwing. */
export function cleanSideStyle(v: string | null | undefined): SideStyle {
  return v && isSideStyle(v) ? v : "individual";
}

export interface SideStyleOption {
  key: SideStyle;
  label: string;
  /** Shown under the label — what it means in golf, not in software. */
  blurb: string;
}

export const SIDE_STYLE_OPTIONS: SideStyleOption[] = [
  {
    key: "individual",
    label: "On their own",
    blurb: "Every player returns their own card. A medal, a Stableford, a singles knockout.",
  },
  {
    key: "pairs",
    label: "In pairs",
    blurb: "Two players a side — four-ball, foursomes, greensomes. The member-guest shape.",
  },
  {
    key: "teams",
    label: "In teams",
    blurb: "Three or four a side — a scramble, a shamble, a texas scramble. Society and charity days.",
  },
  {
    key: "varies",
    label: "It changes by round",
    blurb: "Singles one day, four-ball the next. Every round is set individually.",
  },
];

/**
 * Whether this answer implies the Teams screen is worth showing.
 *
 * "varies" counts: an organizer who says the tournament changes round to round
 * will need to draw sides for at least one of them.
 */
export function wantsTeams(style: SideStyle): boolean {
  return style !== "individual";
}

/**
 * The format a NEW round should start on.
 *
 * A starting point the organizer immediately sees and can change on the card,
 * not a decision made behind their back — which is why it returns the most
 * ordinary format for the shape rather than anything clever.
 *
 * Falls back to the existing default whenever the catalog does not have a
 * playable format of the right side size, so this can never leave a round on
 * something unrunnable.
 */
export function defaultFormatFor(style: SideStyle, scoring: "match" | "stroke"): string {
  const fallback = scoring === "match" ? "Match Play" : "Stroke Play";
  if (style === "individual" || style === "varies") return fallback;

  const wanted = style === "pairs" ? 2 : 4;
  // Four-Ball for pairs and Scramble for fours are the formats a club names
  // when asked; picking by side size alone would return whichever happened to
  // be first in the catalog.
  const preferred = style === "pairs" ? "Four-Ball" : "Scramble";
  const f = GOLF_FORMATS.find((x) => x.name === preferred && x.playable);
  if (f) return f.name;

  const anyOfSize = GOLF_FORMATS.find(
    (x) => x.playable && x.sideSize === wanted && (x.maxSideSize ?? x.sideSize) >= wanted,
  );
  return anyOfSize?.name ?? fallback;
}

/** True when this format is played by a side rather than an individual. */
export function isTeamFormat(name: string): boolean {
  return findFormat(name).sideSize > 1;
}
