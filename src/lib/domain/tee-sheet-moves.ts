/**
 * MOVING PEOPLE AND GROUPS ON A SAVED TEE SHEET — without a re-draw.
 *
 * A saved sheet could change only by Re-draw, a full reshuffle: on a cup
 * morning "the third group goes first" took about 320 reshuffles, and in a
 * league the night before, "swap Ann into the foursome Bea dropped out of" was
 * the same. This is the ONE place the rules of a move live. The screen replays
 * its draft through `applyMoves` to show it; the server action replays the same
 * list over the STORED sheet and refuses on the same words, so the two cannot
 * disagree.
 *
 * THE TIMES STAY WITH THE SLOTS. A group is a slot (name, tee time, start
 * hole, shotgun half) holding players. Moving a group moves its PLAYERS to
 * another slot; the slots do not move, so "third group goes first" is the third
 * group's players now holding the first slot's time and hole, and the others
 * slide down a slot. A shotgun slot carries its hole the same way.
 *
 * A SLOT THAT HAS BEGUN IS LOCKED: a group whose starting time has come at the
 * club (`markTeedOff`, told the club's day and wall clock) or any group with a
 * card in for the round. Nobody moves out of or into it and its players do not
 * change slot.
 */

import { needsTeams } from "../formats";
import { roundIsStroke } from "../stage-types";
import { GROUP_MOST, markTeedOff, type GroupWithRoom, type TeeSheet, type TeeSheetGroup } from "./tee-sheet";

export type SheetMove =
  | { kind: "player"; playerId: string; toGroup: number }
  /** A whole side (a pair, or a match's four): they move together or not at all. */
  | { kind: "side"; playerIds: string[]; toGroup: number }
  | { kind: "group"; from: number; to: number };

/** Locked slot index -> the sentence that says why ("Group 2 teed off at 8:10."). */
export type SlotLocks = Record<number, string>;

const nameOf = (sheet: TeeSheet, i: number) => sheet.groups[i]?.name || `Group ${i + 1}`;

/**
 * WHICH SLOTS HAVE BEGUN. `roundDay` "" (no day) marks nobody teed off; the
 * club's day and wall clock are TOLD, never read here. A teed-off reason wins
 * over a card-in one, being the plainer fact.
 */
export function slotLocks(
  sheet: TeeSheet,
  facts: { roundDay: string; now: { day: string; minutes: number }; cardsIn: ReadonlySet<string> },
): SlotLocks {
  const rows: GroupWithRoom[] = sheet.groups.map((g, index) => ({
    index,
    name: nameOf(sheet, index),
    time: g.time,
    startHole: g.startHole,
    half: g.half,
    players: g.playerIds.length,
  }));
  const out: SlotLocks = {};
  for (const r of markTeedOff(rows, facts.roundDay, facts.now)) {
    if (r.teedOff) out[r.index] = `${r.name} teed off${r.time ? ` at ${r.time}` : ""}.`;
  }
  sheet.groups.forEach((g, i) => {
    if (!(i in out) && g.playerIds.some((id) => facts.cardsIn.has(id))) out[i] = `${nameOf(sheet, i)} has a card in.`;
  });
  return out;
}

const inField = (g: TeeSheetGroup, field: ReadonlySet<string>) => g.playerIds.filter((id) => field.has(id)).length;

/** Whether a move is a no-change (a player to their own group, a group to its own place). */
function same(m: SheetMove, sheet: TeeSheet): boolean {
  if (m.kind === "group") return m.from === m.to;
  if (m.kind === "side") return Array.isArray(m.playerIds) && m.playerIds.length > 0 && m.playerIds.every((id) => sheet.groups[m.toGroup]?.playerIds.includes(id));
  return sheet.groups[m.toGroup]?.playerIds.includes(m.playerId) ?? false;
}

/** One move over a sheet: the new sheet, or the sentence that refuses it. */
export function applyMove(
  sheet: TeeSheet,
  move: SheetMove,
  field: ReadonlySet<string>,
  locks: SlotLocks,
): { ok: true; sheet: TeeSheet } | { ok: false; says: string } {
  const n = sheet.groups.length;
  const slot = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < n;

  if (move.kind === "side") {
    const ids = Array.isArray(move.playerIds) ? [...new Set(move.playerIds)] : [];
    if (ids.length === 0 || ids.some((id) => typeof id !== "string") || !slot(move.toGroup)) return { ok: false, says: "That group isn’t on the sheet." };
    if (ids.some((id) => !field.has(id))) return { ok: false, says: "Somebody in that pair isn’t in this round’s field." };
    const homes = ids.map((id) => sheet.groups.findIndex((g) => g.playerIds.includes(id)));
    if (homes.some((h) => h < 0)) return { ok: false, says: "Somebody in that pair isn’t in a group yet. Put them in a group first." };
    if (same(move, sheet)) return { ok: true, sheet };
    for (const h of new Set(homes)) if (locks[h]) return { ok: false, says: `${locks[h]} Nobody moves out of it.` };
    if (locks[move.toGroup]) return { ok: false, says: `${locks[move.toGroup]} Nobody moves into it.` };
    const target = sheet.groups[move.toGroup];
    const arriving = ids.filter((id) => !target.playerIds.includes(id)).length;
    if (inField(target, field) + arriving > GROUP_MOST) {
      return { ok: false, says: `${nameOf(sheet, move.toGroup)} has no room for ${arriving}. Choose a group with room.` };
    }
    const leaving = new Set(ids);
    return {
      ok: true,
      sheet: {
        ...sheet,
        groups: sheet.groups.map((g, i) =>
          i === move.toGroup
            ? { ...g, playerIds: [...g.playerIds, ...ids.filter((id) => !g.playerIds.includes(id))] }
            : { ...g, playerIds: g.playerIds.filter((id) => !leaving.has(id)) },
        ),
      },
    };
  }

  if (move.kind === "player") {
    if (typeof move.playerId !== "string" || !slot(move.toGroup)) return { ok: false, says: "That group isn’t on the sheet." };
    const from = sheet.groups.findIndex((g) => g.playerIds.includes(move.playerId));
    if (from < 0) return { ok: false, says: "That player isn’t in a group yet. Put them in a group first." };
    if (!field.has(move.playerId)) return { ok: false, says: "That player isn’t in this round’s field." };
    if (same(move, sheet)) return { ok: true, sheet };
    if (locks[from]) return { ok: false, says: `${locks[from]} Nobody moves out of it.` };
    if (locks[move.toGroup]) return { ok: false, says: `${locks[move.toGroup]} Nobody moves into it.` };
    if (inField(sheet.groups[move.toGroup], field) >= GROUP_MOST) {
      return { ok: false, says: `${nameOf(sheet, move.toGroup)} is full. Choose a group with room.` };
    }
    // Moving the last player out is ALLOWED: the group stays in the draft as an empty slot
    // (so a later group can be moved up into it) and is removed when the draft is saved (`settleSheet`).
    return {
      ok: true,
      sheet: {
        ...sheet,
        groups: sheet.groups.map((g, i) =>
          i === from
            ? { ...g, playerIds: g.playerIds.filter((id) => id !== move.playerId) }
            : i === move.toGroup
              ? { ...g, playerIds: [...g.playerIds, move.playerId] }
              : g,
        ),
      },
    };
  }

  if (!slot(move.from) || !slot(move.to)) return { ok: false, says: "That group isn’t on the sheet." };
  if (same(move, sheet)) return { ok: true, sheet };
  if (locks[move.from]) return { ok: false, says: `${locks[move.from]} It stays where it is.` };
  if (locks[move.to]) return { ok: false, says: `${locks[move.to]} Nothing moves into its place.` };
  // Into a slot with nobody in it (a freed one) the group simply takes that slot and its time; the
  // slot it leaves is the one left empty. Nothing else is re-timed.
  if (inField(sheet.groups[move.to], field) === 0) {
    return {
      ok: true,
      sheet: {
        ...sheet,
        groups: sheet.groups.map((g, i) =>
          i === move.to ? { ...g, playerIds: sheet.groups[move.from].playerIds } : i === move.from ? { ...g, playerIds: sheet.groups[move.to].playerIds } : g,
        ),
      },
    };
  }
  // The players of the slots between, in order, skipping any locked slot:
  // the mover takes the target slot and the rest slide one place the other way.
  const lo = Math.min(move.from, move.to);
  const hi = Math.max(move.from, move.to);
  const open: number[] = [];
  for (let i = lo; i <= hi; i++) if (!locks[i]) open.push(i);
  const contents = open.map((i) => sheet.groups[i].playerIds);
  const at = open.indexOf(move.from);
  const [mover] = contents.splice(at, 1);
  contents.splice(open.indexOf(move.to), 0, mover);
  const groups = sheet.groups.map((g, i) => {
    const k = open.indexOf(i);
    return k < 0 ? g : { ...g, playerIds: contents[k] };
  });
  return { ok: true, sheet: { ...sheet, groups } };
}

/** The whole draft: every move in order over `sheet`, stopping at the first one refused. */
export function applyMoves(
  sheet: TeeSheet,
  moves: readonly SheetMove[],
  field: ReadonlySet<string>,
  locks: SlotLocks,
): { ok: true; sheet: TeeSheet } | { ok: false; says: string } {
  let cur = sheet;
  for (const m of moves) {
    const r = applyMove(cur, m, field, locks);
    if (!r.ok) return r;
    cur = r.sheet;
  }
  return { ok: true, sheet: cur };
}

/**
 * THE GROUPS A DRAFT LEAVES WITH NOBODY IN THEM — to be removed on Save. Counted against the field, so a
 * group whose only players are marked out for the week is empty too. A locked group (teed off, a card in)
 * is never listed: it is never emptied and never removed.
 */
export function emptiedGroups(sheet: TeeSheet, field: ReadonlySet<string>, locks: SlotLocks): number[] {
  return sheet.groups.flatMap((g, i) => (!locks[i] && inField(g, field) === 0 ? [i] : []));
}

/** Said in the draft bar for each group that will go: "Group 5 will be removed (no players left)." */
export function removalLines(sheet: TeeSheet, field: ReadonlySet<string>, locks: SlotLocks): string[] {
  return emptiedGroups(sheet, field, locks).map((i) => `${nameOf(sheet, i)} will be removed (no players left).`);
}

/**
 * THE DRAFT AS IT IS SAVED: the emptied groups are removed. The groups that remain keep their OWN times and
 * start holes (nothing is silently re-timed; the organizer closes a gap by moving a group up into the
 * freed slot, which then carries that slot's time).
 *
 * NAMES: on a PUBLISHED sheet the others KEEP their names — the signs, scorecards and starting sheet are
 * printed with group numbers and players were told "Group 4, 8:30", so a gap (Group 1, 2, 4) is normal at
 * a starter's hut and renaming would make every printed paper disagree with the screen. On an unpublished
 * sheet a group called by its number is renumbered to its place, so the draft does not read 1, 2, 4.
 * `published` is REQUIRED: the caller must say which.
 */
export function settleSheet(
  sheet: TeeSheet,
  field: ReadonlySet<string>,
  locks: SlotLocks,
  published: boolean,
): { sheet: TeeSheet; removed: string[] } {
  const gone = new Set(emptiedGroups(sheet, field, locks));
  if (gone.size === 0) return { sheet, removed: [] };
  const removed = [...gone].map((i) => nameOf(sheet, i));
  const kept = sheet.groups.filter((_, i) => !gone.has(i));
  const groups = published ? kept : kept.map((g, i) => (/^Group \d+$/.test(g.name) ? { ...g, name: `Group ${i + 1}` } : g));
  return { sheet: { ...sheet, groups }, removed };
}

/** The slot a group's up (-1) or down (+1) arrow sends it to, skipping locked slots; null at the end. */
export function groupStep(sheet: TeeSheet, locks: SlotLocks, from: number, dir: -1 | 1): number | null {
  if (locks[from]) return null;
  for (let i = from + dir; i >= 0 && i < sheet.groups.length; i += dir) if (!locks[i]) return i;
  return null;
}

/** A group a player could be moved to, or why not. */
export interface MoveOption {
  index: number;
  name: string;
  time: string;
  players: number;
  /** Set when listed but not choosable: the reason, in words. */
  disabled?: string;
}

/** The other groups for one player's "Move … to" select; the full and the begun are listed and disabled. */
export function playerMoveOptions(sheet: TeeSheet, playerId: string, field: ReadonlySet<string>, locks: SlotLocks): MoveOption[] {
  const from = sheet.groups.findIndex((g) => g.playerIds.includes(playerId));
  return sheet.groups.flatMap((g, index) => {
    if (index === from) return [];
    const players = inField(g, field);
    const disabled = locks[index] ? locks[index] : players >= GROUP_MOST ? `${nameOf(sheet, index)} is full.` : undefined;
    return [{ index, name: nameOf(sheet, index), time: g.time, players, ...(disabled ? { disabled } : {}) }];
  });
}

/** Said under the sheet: every group the draft leaves short, in the club's words. */
export function shortGroupWarnings(
  sheet: TeeSheet,
  field: ReadonlySet<string>,
  terms: { groupOfTwo: string; groupOfThree: string },
): string[] {
  return sheet.groups.flatMap((g, i) => {
    const n = inField(g, field);
    if (n === 3) return [`${nameOf(sheet, i)} goes out as a ${terms.groupOfThree}.`];
    if (n === 2) return [`${nameOf(sheet, i)} goes out as a ${terms.groupOfTwo}.`];
    if (n === 1) return [`${nameOf(sheet, i)} goes out with one player.`];
    return [];
  });
}

/**
 * WHAT MAY MOVE IN A ROUND — the one answer, asked by the screen (which draws
 * the controls) and by `moveInTeeSheet` (which refuses): "players" in an
 * individual stroke round with no sides; "sides" where partners play together
 * (a format with sides, whether stroke or match); "groups" where the pairings
 * are the draw and nobody is a unit of their own (singles match play, a
 * knockout) — only a whole group's slot moves.
 */
export type MoveMode = "players" | "sides" | "groups";

export function moveModeOf(round: { type: string; format: string }): MoveMode {
  if (needsTeams(round.format)) return "sides";
  return roundIsStroke(round.type, round.format) ? "players" : "groups";
}

/** The kinds of move a mode takes. A whole group moves in every mode. */
export function moveKindsOf(mode: MoveMode): { player: boolean; side: boolean; group: true } {
  return { player: mode === "players", side: mode === "sides", group: true };
}

/** Said where a player cannot be moved on their own: a round played in sides or matches. */
export const GROUPS_NOTE = "The pairings are the draw here, so a player can\u2019t be moved on their own. You can still move a whole group earlier or later.";
export const SIDES_NOTE = "Partners play together here, so a player can’t be moved on their own. You can still move a whole group.";
