/**
 * WHAT KIND OF CHANGE AN AUDIT LINE IS — for the "Recent changes" lists
 * (Ajay, 2026-09-27: "yes" to giving the audit log a screen).
 *
 * The app writes an audit line for money, results, rounds and settings, and
 * nothing ever showed one: a member withdrawing themselves took the field from
 * 19 to 18 with nothing saying who or when. The lists read these lines back;
 * this sorts each into the heading an organizer would look under.
 *
 * Keyed on the action's own name, which every writer already sets. An action
 * this does not know is "Other" rather than dropped — a new writer's lines
 * still appear, under a heading that says nobody has filed them yet.
 */
export type ChangeKind = "Field" | "Scores & results" | "Rounds" | "Money" | "Settings" | "Other";

/**
 * Changes to WHO IS IN the tournament — what Registration shows.
 *
 * `approved` and `promoted` joined on 2026-09-28: approving an entry and a
 * waiting-list place filling were the two field changes that wrote no line, so
 * "who got the place Ann gave up?" — the question a committee asks after every
 * withdrawal — had no answer on the screen built to give it.
 */
export const FIELD_ACTIONS = [
  "entered", "registered", "added", "removed", "withdrawn", "resize-field", "approved", "promoted",
] as const;

const MONEY_PREFIXES = ["expense.", "fund.", "money.", "pot.", "skins.", "sidegame.", "contest.", "bet.", "prize.", "match.money"];
const SCORE_ACTIONS = [
  "score", "confirm", "confirm-batch", "dispute", "reopen", "match.clear", "clear-round-scores",
  "single-match", "third-place", "league-playoff-hole",
  // A conceded match IS its result. Found filed under "Other" by
  // `every-change-has-a-heading.test.ts`, 2026-09-28.
  "match.forfeit", "match.forfeit.undo",
];
const ROUND_ACTIONS = ["round-closed", "cut-applied", "regenerate-flights"];
const SETTINGS_ACTIONS = ["rotate-share-token", "rotate-registration-token", "league-settings"];

export function changeKind(action: string): ChangeKind {
  const a = action.trim();
  if ((FIELD_ACTIONS as readonly string[]).includes(a)) return "Field";
  if (MONEY_PREFIXES.some((p) => (p.endsWith(".") ? a.startsWith(p) : a === p))) return "Money";
  // "knockout." — a player's report of their tie, and staff approving or
  // turning it down, are all about a result.
  if (SCORE_ACTIONS.includes(a) || a.startsWith("card.") || a.startsWith("knockout.")) return "Scores & results";
  if (ROUND_ACTIONS.includes(a)) return "Rounds";
  if (SETTINGS_ACTIONS.includes(a)) return "Settings";
  return "Other";
}
