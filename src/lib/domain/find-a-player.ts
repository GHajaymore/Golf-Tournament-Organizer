/**
 * FIND A PLAYER (R9a; step 3 §2.2, simplicity review finding 11): "where do I go?" for the starter on
 * the day, in one press plus the name. Pure, over what the screen has ALREADY loaded: every round's
 * published groups and the field's names, so a dropped signal does not stop it. It reads published
 * sheets only and draws nothing; the component draws the answer.
 *
 * SEVEN STATES, each worded with a way on (the UX Writer's, step 3 N2):
 *   empty     the box is empty              placeholder "Find a player", nothing is said
 *   short     one letter                    "Type two letters or more"
 *   found     on a published sheet          one row per round, "Ana Whitlow · Round 2 · Group 5 · 9:20 · Tee 1"
 *   more      more than three rows          the first three, then "3 of 7: keep typing"
 *   unplaced  entered, no published sheet   "Ana Whitlow is entered but not on a published sheet yet." + Open the sheet
 *   gone      withdrew / disqualified       "Ana Whitlow withdrew." + See Entries
 *   nobody    no such name                  "Nobody called ‘Whitlo’ is in this event." + See Entries
 * Every state but the first three has a link, so none is a dead end.
 */

import { hasLeftTheField } from "./left-the-field";

export const FIND_MIN_LETTERS = 2;
/** Rows drawn, never more: on a 375px phone they sit above the keyboard. */
export const FIND_MAX_ROWS = 3;

export interface FindPlayer {
  id: string;
  name: string;
  /** `Player.status`: confirmed | pending | waitlisted | withdrawn | disqualified. */
  status: string;
}

export interface FindGroup {
  /** "Group 5". */
  name: string;
  /** Display time, "9:20 AM". */
  time: string;
  startHole: number;
  half?: "A" | "B";
  playerIds: readonly string[];
}

export interface FindRound {
  id: string;
  /** "Round 2". */
  label: string;
  /** The sheet is out. An unpublished sheet is never searched. */
  published: boolean;
  groups: readonly FindGroup[];
}

export interface FindRow {
  key: string;
  playerId: string;
  /** "Ana Whitlow · Round 2 · Group 5 · 9:20 · Tee 1". */
  text: string;
  /** The round's tab, opened at the draw section. */
  href: string;
}

export interface FindWay {
  says: string;
  href: string;
}

export type FindState =
  | { state: "empty" }
  | { state: "short"; text: string }
  | { state: "found"; rows: FindRow[]; more: string | null }
  | { state: "unplaced"; text: string; way: FindWay }
  | { state: "gone"; text: string; way: FindWay }
  | { state: "nobody"; text: string; way: FindWay };

const ENTRIES: FindWay = { says: "See Entries", href: "/registration" };

/** "9:20 AM" → "9:20": the starter reads a time, not a meridiem (the sheet itself says which). */
function shortTime(time: string): string {
  return time.replace(/\s*[AP]M$/i, "");
}

function norm(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function teeWords(g: FindGroup): string {
  return `Tee ${g.startHole}${g.half ? ` ${g.half}` : ""}`;
}

function isGone(p: FindPlayer): boolean {
  return hasLeftTheField(p.status);
}

/**
 * @param query what was typed
 * @param players every player in the event, in every status
 * @param rounds the event's playing rounds, in play order
 * @param nextUnplayedId the round whose sheet to open for a player on no published sheet (the tee sheet's own default)
 */
export function findAPlayer(
  query: string,
  players: readonly FindPlayer[],
  rounds: readonly FindRound[],
  nextUnplayedId: string | null,
): FindState {
  const typed = query.trim().replace(/\s+/g, " ");
  if (typed.length === 0) return { state: "empty" };
  if (typed.length < FIND_MIN_LETTERS) return { state: "short", text: "Type two letters or more" };

  const needle = norm(typed);
  const matches = players.filter((p) => norm(p.name).includes(needle));
  if (matches.length === 0) {
    return { state: "nobody", text: `Nobody called ‘${typed}’ is in this event.`, way: ENTRIES };
  }

  const rows: FindRow[] = [];
  for (const p of matches) {
    // Somebody out of the field is not on a sheet that is looked at: a stale name on a published sheet
    // is the drift warning's business, never an answer to "where do I go?".
    if (isGone(p)) continue;
    for (const r of rounds) {
      if (!r.published) continue;
      for (const [gi, g] of r.groups.entries()) {
        if (!g.playerIds.includes(p.id)) continue;
        rows.push({
          key: `${p.id}:${r.id}:${g.name}`,
          playerId: p.id,
          text: `${p.name} · ${r.label} · ${g.name} · ${shortTime(g.time)} · ${teeWords(g)}`,
          href: `/foursomes?round=${encodeURIComponent(r.id)}#group-${gi + 1}`,
        });
      }
    }
  }
  if (rows.length > 0) {
    const shown = rows.slice(0, FIND_MAX_ROWS);
    return {
      state: "found",
      rows: shown,
      more: rows.length > shown.length ? `${shown.length} of ${rows.length}: keep typing` : null,
    };
  }

  // Nobody matched is on a published sheet. An entered player first (the way on is a sheet), then the gone.
  const inField = matches.find((p) => !isGone(p));
  if (inField) {
    const open = rounds.find((r) => !r.published && r.id === nextUnplayedId) ?? rounds.find((r) => !r.published) ?? rounds.find((r) => r.id === nextUnplayedId);
    const label = open?.label ?? "the sheet";
    return {
      state: "unplaced",
      text: `${inField.name} is entered but not on a published sheet yet.`,
      way: { says: open ? `Open ${label}’s sheet` : "Open the tee sheet", href: open ? `/foursomes?round=${encodeURIComponent(open.id)}` : "/foursomes" },
    };
  }
  const gone = matches[0];
  return {
    state: "gone",
    text: `${gone.name} ${gone.status === "disqualified" ? "was disqualified" : "withdrew"}.`,
    way: ENTRIES,
  };
}
