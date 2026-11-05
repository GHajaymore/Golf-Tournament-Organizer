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

/**
 * THE KEYS, in one place (2026-11-04): a match is `match:<id>` and a group off
 * the tee sheet is `tee:<n>`, `n` its place in the sheet. The list on `/play`
 * (`matchPlayGroups`, `sheetPlayGroups`) and the printed signs (`print-kit.ts`)
 * both name a group through these, so a sign's QR can only point at a group the
 * list will draw.
 */
export const matchGroupKey = (matchId: string): string => `match:${matchId}`;
export const teeGroupKey = (index: number): string => `tee:${index}`;

// A cuid is 25 letters and figures; the bounds leave room for a different id scheme without admitting anything odd.
const MATCH_ID = /^[A-Za-z0-9_-]{4,40}$/;
const TEE_INDEX = /^(0|[1-9]\d{0,2})$/;

/**
 * A GROUP IN A LINK (2026-11-05): `m<match id>` or `t<n>` — the key with its
 * word cut to one letter, because a printed QR grows with every character
 * (a match's id is 25 of them already). A link is `/play#ABCD-EFGH.t3`.
 * Case matters in the id, so it is never upper-cased the way the code is.
 * Null for a key that is neither shape, which a link then simply omits.
 */
export function groupFragment(key: string): string | null {
  if (key.startsWith("match:") && MATCH_ID.test(key.slice(6))) return `m${key.slice(6)}`;
  if (key.startsWith("tee:") && TEE_INDEX.test(key.slice(4))) return `t${key.slice(4)}`;
  return null;
}

/** The key a link's group part names, or null when it is not a group part at all. */
export function groupKeyFromFragment(fragment: string): string | null {
  if (fragment.startsWith("m") && MATCH_ID.test(fragment.slice(1))) return matchGroupKey(fragment.slice(1));
  if (fragment.startsWith("t") && TEE_INDEX.test(fragment.slice(1))) return teeGroupKey(Number(fragment.slice(1)));
  return null;
}

/**
 * WHAT A PHONE REMEMBERS OF ITS GROUP, ACROSS A TOURNAMENT (2026-11-05).
 * Kept per event on the phone: the key it had (for the words) and the people in
 * it. A group is the SAME group when it holds the same people — a match's key
 * changes every round, and a tee sheet that was redrawn keeps its numbers —
 * so the people are what is compared.
 */
export interface RememberedGroup {
  key: string;
  ids: string[];
}

/** What to store for a group just confirmed. */
export function rememberGroup(g: Pick<PlayGroup, "key" | "players">): RememberedGroup {
  return { key: g.key, ids: g.players.map((p) => p.id) };
}

/** Reads what was stored, or null for anything that is not a remembered group. */
export function parseRemembered(raw: string | null): RememberedGroup | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return null;
    const { key, ids } = v as Record<string, unknown>;
    if (typeof key !== "string" || !Array.isArray(ids) || ids.length === 0 || !ids.every((x) => typeof x === "string")) return null;
    return { key, ids: ids as string[] };
  } catch {
    return null;
  }
}

/**
 * THE GROUP THIS PHONE KEPT LAST TIME, if it is still a group of this round —
 * else null. The same people in one group, whatever the group is now called or
 * numbered; a group that has lost or gained anybody is not the same group, and
 * the list is then all that is offered.
 */
export function rememberedGroup(stored: RememberedGroup | null, groups: readonly PlayGroup[]): PlayGroup | null {
  if (!stored || stored.ids.length === 0) return null;
  const want = [...stored.ids].sort().join("\u0000");
  const same = groups.filter((g) => g.players.map((p) => p.id).sort().join("\u0000") === want);
  return same.find((g) => g.key === stored.key) ?? same[0] ?? null;
}

/** The line over a remembered group: "Last time: Group 3 — Rakesh & Snehal v Subhas & Prashant". */
export function lastTimeSentence(g: Pick<PlayGroup, "title" | "names">): string {
  return `Last time: ${g.title} — ${g.names}`;
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
        key: matchGroupKey(m.id),
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

/**
 * WHICH GROUPS A ROUND LISTS — the one answer (2026-11-05), asked by `/play`
 * when the code is typed and by the print kit when it draws a sign's QR, so a
 * sign can only name a group the list will draw. A round that draws matches,
 * announced, lists its matches (none for a round robin, which keeps the names);
 * otherwise the published tee sheet's groups; otherwise none.
 */
export function groupsOfRound(input: {
  lineupHidden: boolean;
  matches: Array<{ id: string; a: string[]; b: string[] }>;
  names: ReadonlyMap<string, string>;
  sheet: readonly TeeSheetGroup[] | null;
  oneMatch: boolean;
}): PlayGroup[] {
  if (!input.lineupHidden && input.matches.length > 0) {
    return matchPlayGroups({ matches: input.matches, names: input.names, sheet: input.sheet, oneMatch: input.oneMatch }) ?? [];
  }
  return input.sheet ? sheetPlayGroups(input.sheet, input.names) : [];
}

/**
 * THE GROUP A TEE-SHEET GROUP'S SIGN OPENS: the one list entry its players are
 * in. A tee group whose players sit in two entries (a foursome playing two
 * singles matches) has no single group, so its sign opens the round's list.
 */
export function groupKeyForPlayers(groups: readonly PlayGroup[], playerIds: readonly string[]): string | undefined {
  const mine = groups.filter((g) => g.players.some((p) => playerIds.includes(p.id)));
  return mine.length === 1 ? mine[0].key : undefined;
}

/** A stroke round's groups, off its published tee sheet: each with all its names. */
export function sheetPlayGroups(sheet: readonly TeeSheetGroup[], names: ReadonlyMap<string, string>): PlayGroup[] {
  return sheet
    .map((g, i) => {
      const players = g.playerIds.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id) ?? "" }));
      return {
        key: teeGroupKey(i),
        title: g.name.trim() || `Group ${i + 1}`,
        names: players.map((p) => p.name).join(", "),
        tee: teeWords(g),
        players,
        oneMatch: false,
      };
    })
    .filter((g) => g.players.length > 0);
}
