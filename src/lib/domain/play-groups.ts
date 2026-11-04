import { placeOrdinal } from "@/lib/format";
import type { TeeSheetGroup } from "./tee-sheet";

/**
 * PICK YOUR GROUP, NOT YOUR NAME (2026-11-04).
 *
 * At a real team cup on 18 Oct the round-code page (`/play`) listed every
 * player — "Tap your name to start entering your score" — and two scorers
 * tapped a name from the OPPOSING pair. The match card then turned round to
 * face that pair, and they kept the whole match from the wrong side. A name is
 * a small target among twenty; a group is a large one among five, and it is
 * what a scorer already knows ("we're the 12:54 off the 10th").
 *
 * So after the code the page lists GROUPS:
 *   - a match round: each match is a group, both sides named
 *     ("Rakesh & Snehal v Subhas & Prashant"), with its tee time and starting
 *     hole where the round has a published tee sheet;
 *   - a stroke round with a published tee sheet: its groups, all their names;
 *   - a stroke round with no tee sheet: the names, as before.
 * Whichever is tapped is confirmed ONCE on that phone (`keepingSentence`).
 */
export interface PlayGroup {
  /** Stable for the round — what a phone remembers it confirmed. */
  key: string;
  /** "Group 3" off the tee sheet, otherwise "Match 2" in draw order. */
  title: string;
  /** Who is in it: "Rakesh & Snehal v Subhas & Prashant", or a stroke group's names. */
  names: string;
  /** "12:54 off the 10th", or "" where the round has no published tee sheet. */
  tee: string;
  /** Its players, in order — a match's side A first. */
  players: Array<{ id: string; name: string }>;
  /**
   * One match kept by tapping who won each hole: the card IS the match, the
   * same whoever opens it, so nobody's card is picked inside the group. False
   * for a stroke group, and for a match kept on stroke cards, where each ball
   * is somebody's own card.
   */
  oneMatch: boolean;
}

/** What a phone is about to keep: a group, or — on a round with no groups — one player's card. */
export type PlayTarget = { kind: "group"; group: PlayGroup } | { kind: "player"; id: string; name: string };

/** What the phone remembers it confirmed, for this round. */
export function targetKey(t: PlayTarget): string {
  return t.kind === "group" ? t.group.key : `player:${t.id}`;
}

/** "12:54 off the 10th" — a group's tee time and starting hole, as a starter says it. */
export function teeWords(g: Pick<TeeSheetGroup, "time" | "startHole" | "half">): string {
  const hole = Number.isInteger(g.startHole) && g.startHole >= 1 ? g.startHole : 1;
  const off = `off the ${placeOrdinal(hole)}${g.half ? ` (${g.half})` : ""}`;
  const time = (g.time ?? "").trim();
  return time ? `${time} ${off}` : off;
}

/**
 * The one confirmation, in the UX Writer's words: what this phone is about to
 * keep, said in full. "You're keeping Group 3: Rakesh & Snehal v Subhas &
 * Prashant · 12:54 off the 10th" — the tee details left out with no tee sheet.
 */
export function keepingSentence(t: PlayTarget): string {
  if (t.kind === "player") return `You're keeping ${t.name}'s card`;
  const g = t.group;
  return `You're keeping ${g.title}: ${g.names}${g.tee ? ` · ${g.tee}` : ""}`;
}

/** The answer that says yes, for each kind of target. */
export function keepingYes(t: PlayTarget): string {
  return t.kind === "group" ? "Yes, that's my group" : "Yes, that's right";
}

/** The two sides of a match, in a group's words. */
function matchNames(a: string[], b: string[], name: (id: string) => string): string {
  return `${a.map(name).join(" & ")} v ${b.map(name).join(" & ")}`;
}

/**
 * A MATCH ROUND'S GROUPS: one per match, in draw order, both sides named, side
 * A first. Where the round has a published tee sheet each takes its group's
 * tee time and starting hole ("Group 3 · 12:54 off the 10th") and the list
 * goes in tee order; a match nobody on the sheet plays keeps its draw place.
 *
 * Null for a round robin, where one player is drawn into several matches: each
 * name would be listed over and over, which is longer than the field, so that
 * round keeps the plain list of names.
 */
export function matchPlayGroups(input: {
  matches: Array<{ id: string; a: string[]; b: string[] }>;
  names: ReadonlyMap<string, string>;
  sheet: readonly TeeSheetGroup[] | null;
  oneMatch: boolean;
}): PlayGroup[] | null {
  const { names, sheet, oneMatch } = input;
  const listed = (ids: string[]) => ids.filter((id) => names.has(id));
  const matches = input.matches
    .map((m) => ({ id: m.id, a: listed(m.a), b: listed(m.b) }))
    .filter((m) => m.a.length + m.b.length > 0);
  if (matches.length === 0) return [];
  const all = matches.flatMap((m) => [...m.a, ...m.b]);
  if (new Set(all).size !== all.length) return null;
  const name = (id: string) => names.get(id) ?? "";
  const groups = matches.map((m, i) => {
    const at = sheet ? sheet.findIndex((g) => [...m.a, ...m.b].some((id) => g.playerIds.includes(id))) : -1;
    const teeGroup = at >= 0 && sheet ? sheet[at] : null;
    return {
      order: at >= 0 ? at : Number.MAX_SAFE_INTEGER,
      draw: i,
      group: {
        key: `match:${m.id}`,
        title: teeGroup?.name.trim() || `Match ${i + 1}`,
        names: matchNames(m.a, m.b, name),
        tee: teeGroup ? teeWords(teeGroup) : "",
        players: [...m.a, ...m.b].map((id) => ({ id, name: name(id) })),
        oneMatch,
      } satisfies PlayGroup,
    };
  });
  return groups.sort((x, y) => x.order - y.order || x.draw - y.draw).map((g) => g.group);
}

/** A stroke round's groups, off its published tee sheet: each with all its names. */
export function sheetPlayGroups(sheet: readonly TeeSheetGroup[], names: ReadonlyMap<string, string>): PlayGroup[] {
  return sheet
    .map((g, i) => {
      const players = g.playerIds.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id) ?? "" }));
      return {
        key: `tee:${i}`,
        title: g.name.trim() || `Group ${i + 1}`,
        names: players.map((p) => p.name).join(", "),
        tee: teeWords(g),
        players,
        oneMatch: false,
      };
    })
    .filter((g) => g.players.length > 0);
}
