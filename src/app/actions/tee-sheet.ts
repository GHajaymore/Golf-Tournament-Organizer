"use server";
import { getSession } from "@/lib/auth";
import { assertEventWritable } from "@/lib/services/club-archive";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { boardChanged } from "@/lib/services/board-refresh";
import { GROUP_MOST, parseTeeSheet, placeInGroup, validateTeeSheet, type TeeSheet } from "@/lib/domain/tee-sheet";
import { applyMoves, GROUPS_NOTE, moveKindsOf, moveModeOf, settleSheet, SIDES_NOTE, type SheetMove } from "@/lib/domain/tee-sheet-moves";
import { sheetFieldFor } from "@/lib/services/sheet-field";
import { slotLocksFor } from "@/lib/services/tee-sheet-locks";
import { needsTeams } from "@/lib/formats";
import { teamsForStage } from "@/lib/services/teams";
import { sidesByMatch } from "@/lib/domain/draw";
import { holesPlayed } from "@/lib/domain/handicap";
import { roundLabel } from "@/lib/domain/round-label";
import { notifyTeeTimesPublished } from "@/lib/services/tee-time-notify";
import { firstHoleForRound } from "@/lib/domain/hole-number";
import { strokeCutField } from "@/lib/services/stroke-cut";
import { fieldRefusal } from "@/lib/services/field-change";

/**
 * Everything on this screen changed — and so did the public board.
 *
 * `revalidatePath` clears the router cache; it does NOT touch the per-event
 * board entry, which is an `unstable_cache` keyed and tagged separately.
 * Without this, a change here waits out the board's sixty-second backstop
 * before a spectator sees it.
 *
 * The event comes from the SESSION, because every action in this file
 * already operates on the caller's own tournament.
 */
async function refresh() {
  revalidatePath("/", "layout");
  const session = await getSession();
  if (session?.eventId) boardChanged(session.eventId);
}

/**
 * Saving and publishing the tee sheet.
 *
 * Staff only, both of them. A tee sheet decides who plays with whom and when
 * — it is the organizer's decision to make and the organizer's to announce,
 * and no player input reaches these actions at all.
 */

export interface TeeSheetResult {
  ok: boolean;
  error?: string;
}

async function requireStaffSession() {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") {
    throw new Error("Organizer access required");
  }
  await assertEventWritable(session.eventId);
  return session;
}

/** A sheet has at most a field's worth of groups; anything bigger is not one. */
const MAX_SHEET_BYTES = 64 * 1024;

/**
 * Save the drawn sheet, optionally publishing it in the same act.
 *
 * Validated against the confirmed field before anything is stored: a player
 * drawn twice tees off in two places at once, and a name outside the field
 * is one nobody can find on the day. Refused whole rather than saved with
 * holes — half a tee sheet is a queue on the first tee.
 */
export async function saveTeeSheet(
  stageId: string,
  sheet: TeeSheet,
  publish: boolean,
): Promise<TeeSheetResult> {
  const session = await requireStaffSession();

  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId: session.eventId },
    // The old sheet and its published flag are the baseline for the change
    // diff — read before the update overwrites them.
    select: { id: true, teeSheet: true, teeSheetPublished: true },
  });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };

  // Serialize through the parser so only the known shape is ever stored —
  // whatever arrived is arbitrary caller input, not the component's object.
  const clean = parseTeeSheet(JSON.stringify(sheet ?? {}));
  if (!clean) return { ok: false, error: "That isn't a tee sheet." };
  clean.savedAt = new Date().toISOString();

  const json = JSON.stringify(clean);
  if (json.length > MAX_SHEET_BYTES) return { ok: false, error: "That sheet is too large to be one round." };

  const confirmed = await prisma.player.findMany({
    where: { eventId: session.eventId, status: "confirmed" },
    select: { id: true },
  });
  // A round a cut has been made into is played by those who made it — the
  // screen draws from them, and a caller sending anybody else is refused here.
  const cutField = await strokeCutField(session.eventId, stageId);
  const field = confirmed.map((p) => p.id).filter((id) => !cutField || cutField.has(id));
  const confirmedIds = new Set(confirmed.map((p) => p.id));
  if (cutField && clean.groups.some((g) => g.playerIds.some((id) => confirmedIds.has(id) && !cutField.has(id)))) {
    return { ok: false, error: "That sheet includes a player who missed the cut — this round is for those who made it." };
  }
  const problems = validateTeeSheet(clean, new Set(field));
  if (problems.length) return { ok: false, error: problems[0] };

  await prisma.stage.update({
    where: { id: stageId },
    data: { teeSheet: json, teeSheetPublished: publish },
  });

  /**
   * Publishing is the confirm, so it is the only act that notifies. A draft
   * save changes nothing a player can see and pings nobody. The diff baseline
   * is the sheet as it stood BEFORE this write; a first publish (the stage was
   * not published) tells everyone drawn, a re-publish only whom it moved.
   */
  if (publish) {
    const [event, stages] = await Promise.all([
      prisma.event.findUnique({ where: { id: session.eventId }, select: { name: true } }),
      prisma.stage.findMany({
        where: { eventId: session.eventId },
        select: { id: true, type: true, holes: true, nine: true },
        orderBy: { position: "asc" },
      }),
    ]);
    await notifyTeeTimesPublished({
      eventId: session.eventId,
      stageId,
      previous: parseTeeSheet(stage.teeSheet ?? ""),
      next: clean,
      firstPublish: !stage.teeSheetPublished,
      roundLabel: roundLabel(stages, stageId),
      eventName: event?.name ?? "",
      firstHole: firstHoleForRound(stages.find((s) => s.id === stageId)),
    });
  }

  await refresh();
  return { ok: true };
}

/** Show or hide the saved sheet from players — the announcement, undone-able. */
export async function setTeeSheetPublished(stageId: string, published: boolean): Promise<TeeSheetResult> {
  const session = await requireStaffSession();
  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId: session.eventId },
    select: { teeSheet: true, teeSheetPublished: true },
  });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };
  if (published && !stage.teeSheet) {
    return { ok: false, error: "Save a sheet before publishing it — there's nothing to show yet." };
  }
  await prisma.stage.updateMany({
    where: { id: stageId, eventId: session.eventId },
    data: { teeSheetPublished: published },
  });

  // Publishing an already-drawn sheet from behind the toggle is a first
  // announcement too — tell everyone drawn. Only on the false->true edge, so
  // re-affirming a published sheet pings nobody, and unpublishing never does.
  if (published && !stage.teeSheetPublished) {
    const sheet = parseTeeSheet(stage.teeSheet ?? "");
    if (sheet) {
      const [event, stages] = await Promise.all([
        prisma.event.findUnique({ where: { id: session.eventId }, select: { name: true } }),
        prisma.stage.findMany({
          where: { eventId: session.eventId },
          select: { id: true, type: true, holes: true, nine: true },
          orderBy: { position: "asc" },
        }),
      ]);
      await notifyTeeTimesPublished({
        eventId: session.eventId,
        stageId,
        previous: null,
        next: sheet,
        firstPublish: true,
        roundLabel: roundLabel(stages, stageId),
        eventName: event?.name ?? "",
        firstHole: firstHoleForRound(stages.find((s) => s.id === stageId)),
      });
    }
  }

  await refresh();
  return { ok: true };
}

/**
 * PUT ONE NAMED PLAYER INTO A GROUP WITH ROOM (day-of field changes, PR B).
 *
 * The tee sheet stays open after launch, but the only way to give a late entry
 * or a reserve a tee time was to re-draw the whole sheet — which moves
 * everybody, and republishing it sends every moved player a notice on the
 * morning. This writes ONE undrawn player into ONE group that has room
 * (`placeInGroup`): nobody else moves, nobody's time changes, and the sheet
 * keeps its published state. Moving a player already drawn stays a re-draw.
 *
 * WHO MAY CALL IT: staff of the tournament (`requireStaffSession`), an
 * Assistant as much as the Organizer — it is the desk's job on the morning —
 * and only while the one field rule allows it (`fieldRefusal`, change
 * "place-in-group": open until the tournament is completed). Every argument is
 * checked here, because a `"use server"` export is called with whatever the
 * caller sends.
 *
 * A published sheet tells the placed player their time, and nobody else: the
 * notice is the diff between the sheet before and after (`notifyTeeTimesPublished`).
 */
export async function placeInTeeGroup(
  stageId: string,
  playerId: string,
  groupIndex: number,
): Promise<TeeSheetResult & { said?: string }> {
  const session = await requireStaffSession();
  if (typeof stageId !== "string" || !stageId || typeof playerId !== "string" || !playerId) {
    return { ok: false, error: "Choose a player and a group." };
  }
  if (typeof groupIndex !== "number" || !Number.isInteger(groupIndex) || groupIndex < 0) {
    return { ok: false, error: "Choose a group." };
  }
  const refused = await fieldRefusal(session.eventId, "place-in-group");
  if (refused) return { ok: false, error: refused };

  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId: session.eventId },
    select: { id: true, teeSheet: true, teeSheetPublished: true },
  });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };
  const sheet = parseTeeSheet(stage.teeSheet ?? "");
  if (!sheet) return { ok: false, error: "Save a sheet for this round first." };

  const player = await prisma.player.findFirst({
    where: { id: playerId, eventId: session.eventId, status: "confirmed" },
    select: { id: true, name: true },
  });
  if (!player) return { ok: false, error: "That player isn't in the field." };

  // The round's field, as the screen counts it (`sheetFieldFor`): confirmed, the week's attendees
  // in a league, and those who made the cut once one has been made.
  const field = (await sheetFieldFor(session.eventId, stageId)).ids;

  const placed = placeInGroup(sheet, player.id, groupIndex, field);
  if (!placed.ok) return { ok: false, error: placed.says };
  const next: TeeSheet = { ...placed.sheet, savedAt: new Date().toISOString() };

  // Only if the stored sheet is still the one read above: two desks placing
  // into the same last place must not both succeed.
  const written = await prisma.stage.updateMany({
    where: { id: stageId, eventId: session.eventId, teeSheet: stage.teeSheet },
    data: { teeSheet: JSON.stringify(next) },
  });
  if (written.count === 0) return { ok: false, error: "The sheet changed while you were choosing. Look again and choose." };

  if (stage.teeSheetPublished) {
    const [event, stages] = await Promise.all([
      prisma.event.findUnique({ where: { id: session.eventId }, select: { name: true } }),
      prisma.stage.findMany({
        where: { eventId: session.eventId },
        select: { id: true, type: true, holes: true, nine: true },
        orderBy: { position: "asc" },
      }),
    ]);
    await notifyTeeTimesPublished({
      eventId: session.eventId,
      stageId,
      previous: sheet,
      next,
      firstPublish: false,
      roundLabel: roundLabel(stages, stageId),
      eventName: event?.name ?? "",
      firstHole: firstHoleForRound(stages.find((s) => s.id === stageId)),
    });
  }

  await refresh();
  const when = placed.group.time ? `, off at ${placed.group.time}` : "";
  return { ok: true, said: `${player.name} is in ${placed.group.name || "the group"}${when}.` };
}

/** The most moves one Save carries: a draft is a few taps, never a re-draw. */
const MOST_MOVES = 60;

/**
 * MOVE PEOPLE AND GROUPS ON THE SAVED SHEET, WITHOUT A RE-DRAW (tee sheet moves).
 *
 * The screen keeps a draft of moves and sends them once, on Save. The rules
 * are `applyMoves` (`domain/tee-sheet-moves.ts`) — the same function the screen
 * drew the draft with — replayed here over the STORED sheet, so a caller sending
 * anything at all is held to the same words. Times and start holes stay with
 * the slots; a group that has teed off (the club's clock) or holds a card is
 * locked; nobody ends a group above four; a group left with nobody is removed on Save.
 *
 * WHO MAY CALL IT: staff of the tournament, an Assistant as much as the
 * Organizer, and only while the field rule allows (`place-in-group`). A player
 * is moved on their own only in an individual stroke round; where the round is
 * played in sides or matches only a whole side (`kind: "side"`, exactly one of
 * the round's own sides) or a whole group moves — partners are not split.
 *
 * `baseSavedAt` is the `savedAt` of the sheet the person was looking at: a
 * sheet saved by anybody since is refused with a sentence and nothing written
 * (compare-and-set, as `placeInTeeGroup`). The published state is kept; the
 * players whose time changed are told ONCE, and only those.
 */
export async function moveInTeeSheet(
  stageId: string,
  baseSavedAt: string,
  moves: SheetMove[],
): Promise<TeeSheetResult & { said?: string }> {
  const session = await requireStaffSession();
  if (typeof stageId !== "string" || !stageId || typeof baseSavedAt !== "string" || !baseSavedAt) {
    return { ok: false, error: "Look at the sheet again and choose." };
  }
  if (!Array.isArray(moves) || moves.length === 0) return { ok: false, error: "There is nothing to save." };
  if (moves.length > MOST_MOVES) return { ok: false, error: "That is too many changes at once. Save, then carry on." };
  const refused = await fieldRefusal(session.eventId, "place-in-group");
  if (refused) return { ok: false, error: refused };

  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId: session.eventId },
    select: { id: true, teeSheet: true, teeSheetPublished: true, type: true, format: true, holes: true, handicapAllowance: true, allowanceWeights: true },
  });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };
  const sheet = parseTeeSheet(stage.teeSheet ?? "");
  if (!sheet) return { ok: false, error: "Save a sheet for this round first." };
  if (sheet.savedAt !== baseSavedAt) return { ok: false, error: "The sheet changed while you were choosing. Look again and choose." };

  // Anything but a clean shape of move is refused before it is read further.
  const clean: SheetMove[] = [];
  for (const m of moves) {
    if (m && m.kind === "player" && typeof m.playerId === "string" && Number.isInteger(m.toGroup)) clean.push({ kind: "player", playerId: m.playerId, toGroup: m.toGroup });
    else if (m && m.kind === "group" && Number.isInteger(m.from) && Number.isInteger(m.to)) clean.push({ kind: "group", from: m.from, to: m.to });
    else if (
      m &&
      m.kind === "side" &&
      Array.isArray(m.playerIds) &&
      m.playerIds.length > 0 &&
      m.playerIds.length <= GROUP_MOST &&
      m.playerIds.every((id) => typeof id === "string") &&
      Number.isInteger(m.toGroup)
    ) {
      clean.push({ kind: "side", playerIds: [...m.playerIds], toGroup: m.toGroup });
    } else return { ok: false, error: "That isn't a change to a tee sheet." };
  }

  // The round's units. A player moves alone only in an individual stroke round.
  // What may move is `moveModeOf`, the same answer the screen drew its controls from.
  const mode = moveModeOf(stage);
  const kinds = moveKindsOf(mode);
  if (!kinds.player && clean.some((m) => m.kind === "player")) return { ok: false, error: mode === "sides" ? SIDES_NOTE : GROUPS_NOTE };
  if (!kinds.side && clean.some((m) => m.kind === "side")) {
    return { ok: false, error: mode === "groups" ? GROUPS_NOTE : "This round is played one by one. Move a player, not a side." };
  }
  if (kinds.side && clean.some((m) => m.kind === "side")) {
    const sides = await sidesOfRound(session.eventId, stage);
    const known = new Set(sides.map((s) => [...s].sort().join("|")));
    if (clean.some((m) => m.kind === "side" && !known.has([...m.playerIds].sort().join("|")))) {
      return { ok: false, error: "That isn't one of this round's sides." };
    }
  }

  // The round's field, as the screen counts it (`sheetFieldFor`): a player marked out for the week,
  // or who missed the cut, leaves a place though their id is still stored in the group.
  const field = (await sheetFieldFor(session.eventId, stageId)).ids;

  const locks = await slotLocksFor(session.eventId, stageId, sheet);
  const applied = applyMoves(sheet, clean, field, locks);
  if (!applied.ok) return { ok: false, error: applied.says };
  // A group the moves left with nobody is removed; the others keep their own times.
  const settled = settleSheet(applied.sheet, field, locks);
  const next: TeeSheet = { ...settled.sheet, savedAt: new Date().toISOString() };

  const written = await prisma.stage.updateMany({
    where: { id: stageId, eventId: session.eventId, teeSheet: stage.teeSheet },
    data: { teeSheet: JSON.stringify(next) },
  });
  if (written.count === 0) return { ok: false, error: "The sheet changed while you were choosing. Look again and choose." };

  if (stage.teeSheetPublished) {
    const [event, stages] = await Promise.all([
      prisma.event.findUnique({ where: { id: session.eventId }, select: { name: true } }),
      prisma.stage.findMany({
        where: { eventId: session.eventId },
        select: { id: true, type: true, holes: true, nine: true },
        orderBy: { position: "asc" },
      }),
    ]);
    await notifyTeeTimesPublished({
      eventId: session.eventId,
      stageId,
      previous: sheet,
      next,
      firstPublish: false,
      roundLabel: roundLabel(stages, stageId),
      eventName: event?.name ?? "",
      firstHole: firstHoleForRound(stages.find((s) => s.id === stageId)),
    });
  }

  await refresh();
  return { ok: true, said: settled.removed.length ? `The sheet is saved. ${settled.removed.join(", ")} removed (no players left).` : "The sheet is saved with your changes." };
}

/** The round's own sides, as the tee sheet goes out in them (`sidesByMatch`): whole pairs, or a match's four. */
async function sidesOfRound(
  eventId: string,
  stage: { id: string; format: string; holes: number | null; handicapAllowance: number; allowanceWeights: number[] },
): Promise<string[][]> {
  if (!needsTeams(stage.format)) return [];
  const [teams, matches] = await Promise.all([
    teamsForStage(eventId, stage.id, stage.format, stage.handicapAllowance, holesPlayed(stage.holes), stage.allowanceWeights),
    prisma.match.findMany({ where: { eventId, stageId: stage.id }, select: { teamAId: true, teamBId: true } }),
  ]);
  return sidesByMatch(
    teams.map((t) => ({ id: t.id, playerIds: t.members.map((m) => m.playerId) })),
    matches.flatMap((m) => (m.teamAId && m.teamBId ? [{ teamAId: m.teamAId, teamBId: m.teamBId }] : [])),
  );
}
