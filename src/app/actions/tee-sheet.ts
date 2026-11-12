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
import { afterTeeSheetChange, teeSheetVerdictFor } from "@/lib/services/tee-sheet-change";
import { startedGroupsRefusal } from "@/lib/domain/tee-sheet-change";
import { revokePlayerAccount } from "@/lib/services/player-access";
import { withdrawEntry } from "@/lib/services/playing-history";
import { isLaunched } from "@/lib/domain/lifecycle-state";
import { isMatch } from "@/lib/tournament-shape";
import {
  applyReplace,
  candidateWhy,
  clubTimeWords,
  groupOf,
  handicapUsedWords,
  pairNameAfter,
  readReplaceReason,
  REPLACE_CUP_NOTE,
  REPLACE_EVERY_ROUND_NOTE,
  REPLACE_GROUPS_NOTE,
  replaceAuditLine,
  guestFigureRefusal,
  replaceRefusal,
  swapPairMember,
  voidedGamesWords,
} from "@/lib/domain/tee-sheet-replace";
import { replaceWorldFor, sidesHavePlay, voidSideEntries, type RoundSide } from "@/lib/services/tee-sheet-replace";
import { settingsOf } from "@/lib/services/tournament";
import { STAND_IN_MARK, tracksPerRound, type AttendanceMode } from "@/lib/domain/attendance";
import { zoneOfEvent } from "@/lib/services/club-clock";
import { clubWallClock } from "@/lib/domain/club-clock";
import { roundWordsFor } from "@/lib/services/action-shared";
import { nameRefusal, PERSON_NAME_MAX } from "@/lib/domain/typed-limits";
import { indexFigure, NO_INDEX, readHandicapIndex } from "@/lib/domain/handicap-label";
import { GUEST } from "@/lib/domain/entry-standing";
import { upsertMember, memberGender } from "@/lib/services/roster";
import { TEAM_SESSION } from "@/lib/services/cup";

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
  /** A change to a sheet players were already sent: what they were told (`teeSheetWarnWords`). Said beside the button pressed. */
  warning?: string;
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

/** The round's own label ("Round 2", or "" for a one-round tournament), for Recent changes. */
async function labelOf(eventId: string, stageId: string): Promise<string> {
  const stages = await prisma.stage.findMany({ where: { eventId }, select: { id: true, type: true, holes: true, nine: true }, orderBy: { position: "asc" } });
  return roundLabel(stages, stageId);
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
  // THE ONE TEE-SHEET RULE (`teeSheetChangeAllowed`): a completed tournament's sheet is final.
  const verdict = await teeSheetVerdictFor(session.eventId, stageId, { kind: "save", publish: publish === true });
  if (verdict && !verdict.ok) return { ok: false, error: verdict.says };

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
  // A group that has started (teed off by the club's clock, or a card in) stays as it was, scores or none, as the moves
  // hold it; the rest may be drawn again.
  const before = parseTeeSheet(stage.teeSheet ?? "");
  if (verdict?.ok && before) {
    const kept = startedGroupsRefusal(before, clean, await slotLocksFor(session.eventId, stageId, before));
    if (kept) return { ok: false, error: kept };
  }

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

  const warning = await afterTeeSheetChange(session.eventId, verdict, { label: await labelOf(session.eventId, stageId) }, { previous: before, next: clean });
  await refresh();
  return warning ? { ok: true, warning } : { ok: true };
}

/** Show or hide the saved sheet from players — the announcement, undone-able. */
export async function setTeeSheetPublished(stageId: string, published: boolean): Promise<TeeSheetResult> {
  const session = await requireStaffSession();
  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId: session.eventId },
    select: { teeSheet: true, teeSheetPublished: true },
  });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };
  const verdict = await teeSheetVerdictFor(session.eventId, stageId, { kind: published ? "publish" : "unpublish" });
  if (verdict && !verdict.ok) return { ok: false, error: verdict.says };
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

  // Taking an announced sheet back is the one change here that a published sheet has to say.
  const warning = !published && stage.teeSheetPublished ? await afterTeeSheetChange(session.eventId, verdict, { label: await labelOf(session.eventId, stageId) }, { previous: parseTeeSheet(stage.teeSheet ?? ""), next: null }) : null;
  await refresh();
  return warning ? { ok: true, warning } : { ok: true };
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
 * and only while the one tee-sheet rule allows it (`teeSheetChangeAllowed`,
 * "place": open until the tournament is completed). Every argument is
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
  const verdict = await teeSheetVerdictFor(session.eventId, stageId, { kind: "place" });
  if (verdict && !verdict.ok) return { ok: false, error: verdict.says };

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

  const warning = await afterTeeSheetChange(session.eventId, verdict, { label: await labelOf(session.eventId, stageId) }, { previous: sheet, next });
  await refresh();
  const when = placed.group.time ? `, off at ${placed.group.time}` : "";
  return { ok: true, said: `${player.name} is in ${placed.group.name || "the group"}${when}.${warning ? ` ${warning}` : ""}` };
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
 * Organizer, and only while the tee-sheet rule allows it (`teeSheetChangeAllowed`, "move"). A player
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
  const verdict = await teeSheetVerdictFor(session.eventId, stageId, { kind: "move" });
  if (verdict && !verdict.ok) return { ok: false, error: verdict.says };

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
  const settled = settleSheet(applied.sheet, field, locks, stage.teeSheetPublished);
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

  const warning = await afterTeeSheetChange(session.eventId, verdict, { label: await labelOf(session.eventId, stageId) }, { previous: sheet, next });
  await refresh();
  const saved = settled.removed.length ? `The sheet is saved. ${settled.removed.join(", ")} removed (no players left).` : "The sheet is saved with your changes.";
  return { ok: true, said: warning ? `${saved} ${warning}` : saved };
}

/** Who steps in: a member of the tournament, or a guest typed in on the spot (the index as typed, "" for none). */
export type ReplaceWho = { kind: "member"; playerId: string } | { kind: "guest"; name: string; index: string };

const STARTED_SIDE = "A card is in for this group, so it has started. A group that has started can’t have a player swapped in. If somebody has gone home, that is a withdrawal.";

/** A refusal found inside the transaction: rolls everything back and is said as a sentence. */
class ReplaceRefused extends Error {
  constructor(public says: string) {
    super(says);
  }
}

/**
 * REPLACE A PLAYER ON THE SAVED SHEET WITH SOMEBODY ELSE — a no-show, a last-minute cancellation (B43).
 *
 * ONE PRESS, ONE SLOT. The substitute takes the absentee's exact place: group, time, hole and — where
 * partners play together — their place in the pair (`TeamMember`, keeping `position`; the side and its match
 * are unchanged, so the pair stays eligible and its partner keeps their result). Nobody else moves, and the
 * whole Teams screen stays locked. The rules are `domain/tee-sheet-replace.ts`, the same functions the screen
 * drew its choices with. Allowed until the absentee's group has started (`slotLocksFor`, the CLUB's clock or
 * a card in); the late-entry cutoff does NOT apply — the field stays the same size.
 *
 * WHO MAY CALL IT: staff of the tournament, an Assistant as much as the Organizer — a substitution is a
 * withdrawal plus a late entry, both of which the day-of field rule already gives the desk.
 *
 * WHAT IS WRITTEN, IN ONE TRANSACTION (or nothing): the sheet (compare-and-set on `savedAt`, as the moves);
 * the guest's entry (`standing: guest`, no email stored, "no index" when blank — never a scratch golfer); the
 * pair's member; the week's attendance where the tournament asks one (out for the absentee, in for the sub,
 * each naming the other and the staff member); the absentee's side-game entries for this round, marked out
 * (never the record of who paid); and the audit line. NOTHING IS DELETED: the absentee's player row stays,
 * marked "replaced by" in the week's attendance and on the record. In a tournament that asks nothing each
 * week the absentee is WITHDRAWN in the same transaction (`withdrawEntry`, the one keep path the Withdraw
 * press uses, never deleting), so the field holds the substitute and not both.
 *
 * A GUEST WITH NO FIGURE is refused in a round scored net (`guestFigureRefusal`): the handicap resolver reads
 * the stored number, not "no index", and would play them off nought. The guest's roster row is made inside the
 * transaction, and "has this group started" is read again inside it, so a refusal leaves nothing behind.
 */
export async function replaceInTeeSheet(
  stageId: string,
  baseSavedAt: string,
  absenteeId: string,
  who: ReplaceWho,
  reasonIn: string,
): Promise<TeeSheetResult & { said?: string }> {
  const session = await requireStaffSession();
  if (typeof stageId !== "string" || !stageId || typeof baseSavedAt !== "string" || !baseSavedAt || typeof absenteeId !== "string" || !absenteeId) {
    return { ok: false, error: "Look at the sheet again and choose." };
  }
  const reason = readReplaceReason(reasonIn);
  if (!reason) return { ok: false, error: "Choose why: no-show, cancelled or other." };
  if (!who || typeof who !== "object" || (who.kind !== "member" && who.kind !== "guest")) return { ok: false, error: "Choose who steps in." };
  const verdict = await teeSheetVerdictFor(session.eventId, stageId, { kind: "replace" });
  if (verdict && !verdict.ok) return { ok: false, error: verdict.says };

  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId: session.eventId },
    select: { id: true, type: true, format: true, teeSheet: true, teeSheetPublished: true, scoringBasis: true },
  });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };
  const sheet = parseTeeSheet(stage.teeSheet ?? "");
  if (!sheet) return { ok: false, error: "Save a sheet for this round first." };
  if (sheet.savedAt !== baseSavedAt) return { ok: false, error: "The sheet changed while you were choosing. Look again and choose." };

  const mode = moveModeOf(stage);
  if (mode === "groups") return { ok: false, error: REPLACE_GROUPS_NOTE };
  if (stage.type === TEAM_SESSION) return { ok: false, error: REPLACE_CUP_NOTE };

  const absentee = await prisma.player.findFirst({ where: { id: absenteeId, eventId: session.eventId }, select: { id: true, name: true, email: true, status: true } });
  if (!absentee) return { ok: false, error: "That player isn't in this tournament." };

  const locks = await slotLocksFor(session.eventId, stageId, sheet);
  const { world, candidates, sides } = await replaceWorldFor(session.eventId, stageId, sheet, mode === "sides");
  const slotRefusal = replaceRefusal(sheet, absenteeId, locks);
  if (slotRefusal) return { ok: false, error: slotRefusal };

  // Where partners play together, the pair the absentee holds a place in. A side's own card or a match's
  // holes are not a player's `Scorecard`, so the lock above cannot see them: they are read here.
  let pair: RoundSide | null = null;
  let groupSideIds: string[] = [];
  if (mode === "sides") {
    pair = sides.find((t) => t.members.some((m) => m.playerId === absenteeId)) ?? null;
    if (pair && pair.stageId === null) return { ok: false, error: REPLACE_EVERY_ROUND_NOTE };
    const inGroup = new Set(sheet.groups[groupOf(sheet, absenteeId)].playerIds);
    const groupSides = sides.filter((t) => t.members.some((m) => inGroup.has(m.playerId))).map((t) => t.id);
    groupSideIds = groupSides;
    if (await sidesHavePlay(session.eventId, stageId, groupSides)) return { ok: false, error: STARTED_SIDE };
  }

  // WHO STEPS IN, and the handicap they will play off.
  let sub: { id: string; name: string; index: string };
  let guestToMake: { name: string; index: number | null } | null = null;
  if (who.kind === "member") {
    if (typeof who.playerId !== "string" || !who.playerId) return { ok: false, error: "Choose who steps in." };
    const picked = candidates.find((c) => c.id === who.playerId);
    if (!picked) return { ok: false, error: "That player isn't in the field." };
    const why = candidateWhy(picked, absenteeId, world);
    if (why) return { ok: false, error: `${picked.name}: ${why}` };
    sub = { id: picked.id, name: picked.name, index: picked.index };
  } else {
    const name = String(who.name ?? "").trim();
    const badName = nameRefusal(name, PERSON_NAME_MAX, "Enter the guest’s name.");
    if (badName) return { ok: false, error: badName };
    const typed = readHandicapIndex(typeof who.index === "string" ? who.index : "");
    if (typed.kind === "unreadable") return { ok: false, error: "Enter the handicap as a number, like 12.4 — or +2.4 for a plus handicap. Leave it blank if they have none." };
    if (typed.kind === "out-of-range") return { ok: false, error: "A handicap index runs from +10 to 54." };
    const clash = await prisma.player.findFirst({ where: { eventId: session.eventId, name: { equals: name, mode: "insensitive" } }, select: { name: true } });
    if (clash) return { ok: false, error: `${clash.name} is already in this tournament. Choose them from the list.` };
    const index = typed.kind === "index" ? typed.value : null;
    const needsFigure = guestFigureRefusal(stage.scoringBasis, name, index !== null);
    if (needsFigure) return { ok: false, error: needsFigure };
    guestToMake = { name, index };
    sub = { id: "", name, index: index === null ? NO_INDEX : indexFigure(index) };
  }

  const [event, zone, stages] = await Promise.all([
    prisma.event.findUnique({ where: { id: session.eventId } }),
    zoneOfEvent(session.eventId),
    prisma.stage.findMany({ where: { eventId: session.eventId }, select: { id: true, type: true, holes: true, nine: true }, orderBy: { position: "asc" } }),
  ]);
  if (!event) return { ok: false, error: "Tournament not found." };
  const weekly = tracksPerRound(settingsOf(event).attendanceMode as AttendanceMode);
  // WHERE NOTHING IS ASKED EACH WEEK the absentee is WITHDRAWN in the same press, so the field holds the
  // sub and not both ("one slot, one name"; the field cap does not overshoot). That is the Withdraw press's
  // own rule (`fieldRefusal(…, "withdraw")`): where it refuses at this stage, so does the replace.
  if (!weekly) {
    const withdrawRefused = await fieldRefusal(session.eventId, "withdraw");
    if (withdrawRefused) return { ok: false, error: withdrawRefused };
  }
  const round = await roundWordsFor(session.eventId, stageId);
  const clubTime = clubTimeWords(clubWallClock(zone));

  const result = await prisma
    .$transaction(async (tx) => {
      // THE GROUP HAS NOT STARTED — asked again, here, on this transaction's own reads, so a card or a hole
      // that arrived since the checks above is not written over (and a refusal leaves nothing behind).
      const lateRefusal = replaceRefusal(sheet, absenteeId, await slotLocksFor(session.eventId, stageId, sheet, tx));
      if (lateRefusal) throw new ReplaceRefused(lateRefusal);
      if (groupSideIds.length > 0 && (await sidesHavePlay(session.eventId, stageId, groupSideIds, tx))) throw new ReplaceRefused(STARTED_SIDE);

      let subId = sub.id;
      if (guestToMake) {
        // A guest is a roster row of their own (never matched onto a member of the same name) and an entry.
        const guestMemberId = event.organizationId
          ? await upsertMember(event.organizationId, { name: guestToMake.name, guest: true, handicap: guestToMake.index ?? undefined, handicapSource: guestToMake.index === null ? "none" : "manual" }, "staff", tx)
          : null;
        const guestGender = await memberGender(guestMemberId, tx);
        const maxSeed = await tx.player.aggregate({ where: { eventId: session.eventId }, _max: { seed: true } });
        const made = await tx.player.create({
          select: { id: true },
          data: {
            eventId: session.eventId,
            memberId: guestMemberId,
            // In an interclub league a pair is drawn from its club: the guest plays for the absentee's.
            groupId: world.sameFlight ? world.flights[absenteeId] || null : null,
            name: guestToMake.name,
            handicap: guestToMake.index ?? 0,
            seed: (maxSeed._max.seed ?? 0) + 1,
            status: "confirmed",
            standing: GUEST,
            email: "",
            phone: "",
            // NO FIGURE, NO CLAIM: a blank is stored as "none" — gross only, never a scratch golfer nobody declared.
            handicapSource: guestToMake.index === null ? "none" : "manual",
            handicapType: "18",
            gender: guestGender,
          },
        });
        subId = made.id;
      }

      // The sheet, only if it is still the one read above: two desks must not both succeed.
      const final = applyReplace(sheet, absenteeId, subId, locks);
      if (!final.ok) throw new ReplaceRefused(final.says);
      const next: TeeSheet = { ...final.sheet, savedAt: new Date().toISOString() };
      const written = await tx.stage.updateMany({
        where: { id: stageId, eventId: session.eventId, teeSheet: stage.teeSheet },
        data: { teeSheet: JSON.stringify(next) },
      });
      if (written.count === 0) throw new ReplaceRefused("The sheet changed while you were choosing. Look again and choose.");

      // The pair: the substitute takes the absentee's place in it, position kept; a pair named for its players is renamed.
      if (pair) {
        const swapped = swapPairMember(pair.members, absenteeId, subId);
        if (!swapped.ok) throw new ReplaceRefused(swapped.says);
        await tx.teamMember.updateMany({ where: { teamId: pair.id, playerId: absenteeId }, data: { playerId: subId } });
        const names = new Map(
          (await tx.player.findMany({ where: { id: { in: [...pair.members.map((m) => m.playerId), subId] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]),
        );
        const renamed = pairNameAfter(
          pair.name,
          pair.members.map((m) => names.get(m.playerId) ?? ""),
          swapped.members.map((m) => names.get(m.playerId) ?? ""),
        );
        if (renamed !== pair.name) await tx.team.update({ where: { id: pair.id }, data: { name: renamed } });
      }

      // The week: out for the absentee, in for the sub — each naming the other, and who pressed.
      if (weekly) {
        const out = `${session.name} (replaced by ${sub.name})`;
        const inn = `${session.name} (replacing ${absentee.name})`;
        await tx.roundAttendance.upsert({
          where: { stageId_playerId: { stageId, playerId: absenteeId } },
          update: { status: "out", decidedAt: new Date(), decidedBy: out },
          create: { eventId: session.eventId, stageId, playerId: absenteeId, status: "out", decidedBy: out },
        });
        await tx.roundAttendance.upsert({
          where: { stageId_playerId: { stageId, playerId: subId } },
          update: { status: "in", decidedAt: new Date(), decidedBy: inn },
          create: { eventId: session.eventId, stageId, playerId: subId, status: "in", decidedBy: inn },
        });
        // A STAND-IN IS IN THIS WEEK ONLY. Every other round of the season gets an explicit OUT for them, written
        // now, so their silence never turns them up in a later week. Nobody else changes: a guest entered any
        // other way (a CSV row, the entry form) is in by the mode's default exactly as before, because the
        // default is never asked who somebody is. The desk can still put them in for a week by saying so.
        if (guestToMake) {
          const others = stages.filter((s) => s.id !== stageId);
          if (others.length > 0) {
            await tx.roundAttendance.createMany({
              data: others.map((s) => ({ eventId: session.eventId, stageId: s.id, playerId: subId, status: "out", decidedBy: `${session.name} ${STAND_IN_MARK}${round || "one round"} only)` })),
              skipDuplicates: true,
            });
          }
        }
      }

      // No weekly sign-up: the absentee leaves the field through the ONE keep path the Withdraw press uses
      // (`withdrawEntry`: withdrawn, their stakes by default written down as taken), never deleted.
      if (!weekly) {
        const gone = await withdrawEntry(tx, session.eventId, { id: absenteeId, status: absentee.status }, { launched: isLaunched(event.status) && !isMatch(event.shape), mustKeep: true });
        await tx.auditLog.create({
          data: { eventId: session.eventId, actor: session.name, action: "removed", detail: gone.played ? `${absentee.name} was withdrawn from the field (their results are kept).` : `${absentee.name} was withdrawn from the field.` },
        });
      }

      const voided = await voidSideEntries(tx, session.eventId, stageId, absenteeId);
      await tx.auditLog.create({
        data: {
          eventId: session.eventId,
          actor: session.name,
          action: "replaced",
          detail: replaceAuditLine({
            absentee: absentee.name,
            sub: sub.name,
            staff: session.name,
            clubTime,
            round,
            group: final.groupName,
            reason,
            handicap: handicapUsedWords(sub.index),
            games: voidedGamesWords(voided),
          }),
        },
      });
      return { next, groupName: final.groupName, time: sheet.groups[final.group].time };
    })
    .catch((e: unknown) => {
      if (e instanceof ReplaceRefused) return e;
      throw e;
    });
  if (result instanceof ReplaceRefused) return { ok: false, error: result.says };

  // A published sheet tells the one who stepped in their time, and nobody else: the notice is the diff.
  if (stage.teeSheetPublished) {
    await notifyTeeTimesPublished({
      eventId: session.eventId,
      stageId,
      previous: sheet,
      next: result.next,
      firstPublish: false,
      roundLabel: roundLabel(stages, stageId),
      eventName: event.name,
      firstHole: firstHoleForRound(stages.find((s) => s.id === stageId)),
    });
  }

  const warning = await afterTeeSheetChange(session.eventId, verdict, { label: roundLabel(stages, stageId) }, { previous: sheet, next: result.next });
  await refresh();
  const where = result.time ? `${result.groupName}, ${result.time}` : result.groupName;
  // A withdrawn entry has no way in, as with the Withdraw press (an address still used by somebody in the field is kept).
  if (!weekly && absentee.email.trim()) await revokePlayerAccount(session.eventId, absentee.email);
  const stays = weekly ? "" : ` ${absentee.name} is withdrawn from the field (their row is kept).`;
  return { ok: true, said: `${sub.name} is in ${where}, in place of ${absentee.name}.${stays}${warning ? ` ${warning}` : ""}` };
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
