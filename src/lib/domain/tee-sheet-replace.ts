/**
 * "REPLACE … WITH …" ON A TEE-SHEET SLOT — a no-show, or a cancellation the
 * morning of (backlog B43; Golf Pro and Tournament Director, 2026-11-11).
 *
 * THE PRINCIPLE: a substitution is a change of NAME in a slot before that slot
 * has played a stroke. The substitute takes the EXACT slot — the group, the
 * time, the hole — and, where partners play together, the exact place in the
 * pair. Nobody else moves and nothing is re-drawn. This is the ONE place its
 * rules live: the screen draws its choices with `replaceCandidates` and the
 * server action refuses with the same function, so the two cannot disagree.
 *
 * UNTIL WHEN: until the absentee's group has started — its tee time passed by
 * the CLUB's clock, or any hole scored by anyone in it (`slotLocks`, the same
 * answer the moves use). The late-entry cutoff does not apply: a replacement
 * is not a late entry, the field stays the same size. Once the absentee has
 * holes scored it is a withdrawal, which is another flow.
 *
 * WHO STEPS IN: a member of the tournament who is not already playing that
 * week — refused if they hold a place in another group or pair (one player,
 * one card per round), are marked out for the week, missed the cut, or play for
 * another club in an interclub league. Or a guest with a handicap typed at
 * the moment; blank is allowed and means "no index": gross only, never
 * silently scratch, and never a reason to refuse the swap.
 *
 * Pure: told the sheet, the locks and the facts; reads no clock.
 */

import type { TeeSheet } from "./tee-sheet";
import type { SlotLocks } from "./tee-sheet-moves";

export const REPLACE_REASONS = ["no-show", "cancelled", "other"] as const;
export type ReplaceReason = (typeof REPLACE_REASONS)[number];

export const REPLACE_REASON_WORDS: Record<ReplaceReason, string> = {
  "no-show": "No-show",
  cancelled: "Cancelled",
  other: "Other",
};

/** A reason somebody sent, or null when it is not one of the three. */
export function readReplaceReason(v: unknown): ReplaceReason | null {
  return typeof v === "string" && (REPLACE_REASONS as readonly string[]).includes(v) ? (v as ReplaceReason) : null;
}

const groupName = (sheet: TeeSheet, i: number) => sheet.groups[i]?.name || `Group ${i + 1}`;

/** Where a player stands on the sheet: the index of their group, or -1. */
export function groupOf(sheet: TeeSheet, playerId: string): number {
  return sheet.groups.findIndex((g) => g.playerIds.includes(playerId));
}

/**
 * WHETHER THIS SLOT MAY STILL CHANGE HANDS, or the sentence that says why not.
 * `locks` is `slotLocks` — told the club's day and clock, never read here.
 */
export function replaceRefusal(sheet: TeeSheet, absenteeId: string, locks: SlotLocks): string | null {
  const at = groupOf(sheet, absenteeId);
  if (at < 0) return "That player isn’t in a group on this sheet.";
  if (locks[at]) return `${locks[at]} A group that has started can’t have a player swapped in. If somebody has gone home, that is a withdrawal.`;
  return null;
}

/** What the screen and the server know about the round, as plain lists (it crosses to the browser). */
export interface ReplaceWorld {
  /** The saved sheet. */
  sheet: TeeSheet;
  /** Ids in the round's field (`sheetFieldFor`). */
  field: string[];
  /** Ids explicitly marked OUT for this week (a player merely silent in an opt-in league is not here). */
  out: string[];
  /** Player id -> the pair they hold a place in this round, where the round is played in sides. */
  sides: Record<string, string>;
  /** Ids who made the cut once one has been made into this round; null before. */
  cut: string[] | null;
  /** Player id -> their flight (a club, in an interclub league), "" for none. */
  flights: Record<string, string>;
  /** An interclub league: a pair is drawn from its own club, so the substitute must be too. */
  sameFlight: boolean;
}

export interface ReplaceCandidate {
  id: string;
  name: string;
  /** Said as the screens say it: "12.4", "+2.4", "no index". */
  index: string;
}

export interface ReplaceChoice extends ReplaceCandidate {
  /** Set when listed but not choosable: why, in words. */
  why?: string;
}

/** Why one person cannot step into this slot, or null when they can. */
export function candidateWhy(c: ReplaceCandidate, absenteeId: string, world: ReplaceWorld): string | null {
  if (c.id === absenteeId) return "The player being replaced.";
  if (world.out.includes(c.id)) return "Marked out for this week. Put them back in first.";
  if (world.cut && !world.cut.includes(c.id)) return "Missed the cut.";
  const at = groupOf(world.sheet, c.id);
  if (at >= 0 && world.field.includes(c.id)) return `Already in ${groupName(world.sheet, at)}.`;
  const side = world.sides[c.id];
  if (side) return `Already playing in ${side}.`;
  if (world.sameFlight) {
    const mine = world.flights[absenteeId] ?? "";
    if (mine && (world.flights[c.id] ?? "") !== mine) return "Plays for another club.";
  }
  return null;
}

/** Everybody offered for one slot, choosable first, the rest listed with their reason. */
export function replaceCandidates(candidates: readonly ReplaceCandidate[], absenteeId: string, world: ReplaceWorld): ReplaceChoice[] {
  const rows = candidates
    .filter((c) => c.id !== absenteeId)
    .map((c): ReplaceChoice => {
      const why = candidateWhy(c, absenteeId, world);
      return why ? { ...c, why } : { ...c };
    });
  return [...rows.filter((r) => !r.why), ...rows.filter((r) => r.why)];
}

/**
 * THE SHEET WITH THE SUBSTITUTE IN THE ABSENTEE'S PLACE: same group, same position in it.
 * Refused on the same words the screen shows.
 */
export function applyReplace(
  sheet: TeeSheet,
  absenteeId: string,
  subId: string,
  locks: SlotLocks,
): { ok: true; sheet: TeeSheet; group: number; groupName: string } | { ok: false; says: string } {
  const refused = replaceRefusal(sheet, absenteeId, locks);
  if (refused) return { ok: false, says: refused };
  if (absenteeId === subId) return { ok: false, says: "Choose somebody other than the player being replaced." };
  const at = groupOf(sheet, absenteeId);
  const groups = sheet.groups.map((g, i) => (i === at ? { ...g, playerIds: g.playerIds.map((id) => (id === absenteeId ? subId : id)) } : g));
  return { ok: true, sheet: { ...sheet, groups }, group: at, groupName: groupName(sheet, at) };
}

export interface PairMember {
  playerId: string;
  position: number;
}

/**
 * A PAIR WITH ONE PARTNER CHANGED: the substitute takes the absentee's `position`
 * (foursomes alternate on it, a scramble prices by it), the side and its match stay.
 */
export function swapPairMember(members: readonly PairMember[], absenteeId: string, subId: string): { ok: true; members: PairMember[] } | { ok: false; says: string } {
  if (!members.some((m) => m.playerId === absenteeId)) return { ok: false, says: "That player isn’t in this pair." };
  if (members.some((m) => m.playerId === subId)) return { ok: false, says: "That player is already in this pair." };
  return { ok: true, members: members.map((m) => (m.playerId === absenteeId ? { ...m, playerId: subId } : { ...m })) };
}

/**
 * A pair NAMED FOR ITS PLAYERS ("Ann / Bea", as a captain's nomination names it)
 * is renamed for the new ones; a name somebody chose is left alone.
 */
export function pairNameAfter(name: string, before: readonly string[], after: readonly string[]): string {
  return name === before.join(" / ") ? after.join(" / ") : name;
}

/** The handicap a substitute plays off, said for the record: "12.4", "+2.4", "no index (gross only)". */
export function handicapUsedWords(index: string): string {
  return index === "no index" ? "no index (gross only)" : index;
}

/** "7 Nov 2026 08:05" — the club's own day and wall clock, told, for the audit line. */
export function clubTimeWords(at: { day: string; minutes: number }): string {
  const h = Math.floor(at.minutes / 60);
  const m = at.minutes % 60;
  return `${at.day} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface ReplaceRecord {
  absentee: string;
  sub: string;
  staff: string;
  clubTime: string;
  round: string;
  group: string;
  reason: ReplaceReason;
  /** `handicapUsedWords`. */
  handicap: string;
  /** What happened to the absentee's side-game entries, in a clause; "" for none. */
  games: string;
}

/** THE AUDIT LINE: who, whom, when, where, why, what handicap. */
export function replaceAuditLine(r: ReplaceRecord): string {
  const where = [r.round, r.group].filter(Boolean).join(", ");
  return (
    `Replaced ${r.absentee} with ${r.sub} by ${r.staff} at ${r.clubTime}${where ? `, ${where}` : ""}, ` +
    `reason ${REPLACE_REASON_WORDS[r.reason].toLowerCase()}, handicap used ${r.handicap}.` +
    (r.games ? ` ${r.games}` : "")
  );
}

/** The one sentence the confirm button states before anything is done. */
export function replaceWillSay(args: { absentee: string; sub: string; group: string; time: string; handicap: string; inSides: boolean; weekly: boolean }): string {
  const slot = args.time ? `${args.group}, ${args.time}` : args.group;
  return (
    `${args.sub} takes ${args.absentee}’s place in ${slot}, playing off ${handicapUsedWords(args.handicap)}` +
    (args.inSides ? ", keeping the pair and its match" : "") +
    `; ${args.absentee} comes off the sheet${args.weekly ? " and is marked out for the week" : " and is withdrawn from the field (the row is kept)"}, and their side-game entries for this round are voided.`
  );
}

/** What a side-game voiding says in the audit line. */
export function voidedGamesWords(v: { contests: number; sideGames: number; skins: number; paid: number }): string {
  const total = v.contests + v.sideGames + v.skins;
  if (total === 0) return "";
  const parts = [
    v.contests ? `${v.contests} contest${v.contests === 1 ? "" : "s"}` : "",
    v.sideGames ? `${v.sideGames} side game${v.sideGames === 1 ? "" : "s"}` : "",
    v.skins ? `${v.skins} skins pot${v.skins === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return `Voided the absentee’s entries in ${parts.join(", ")}${v.paid > 0 ? ` (${v.paid} already paid, to be settled by hand)` : ""}.`;
}

export const REPLACE_GROUPS_NOTE = "The pairings are the draw in this round, so a player can’t be swapped on the sheet. Re-draw, or withdraw the player and add the new one.";
export const REPLACE_EVERY_ROUND_NOTE = "This pair plays every round, so changing a partner changes every round. Change it on the Teams screen.";
export const REPLACE_CUP_NOTE = "A team cup session’s lineup is set on the Team cup screen.";
