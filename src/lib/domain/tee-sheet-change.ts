/**
 * MAY THE TEE SHEET BE CHANGED NOW — the one rule for the J12 tee-sheet rows
 * (state machine PR 7c; the proposal's section 3, "Tee sheet", lock scope
 * `teeSheet`; the main session's ruling of 12 Nov as Technical Director and
 * Golf Pro).
 *
 * Until this, the tee sheet's writers asked nothing about the tournament
 * (`saveTeeSheet`, `setTeeSheetPublished`) or asked a field rule that has no
 * view of the sheet (`place-in-group`, for `placeInTeeGroup`, `moveInTeeSheet`
 * and `replaceInTeeSheet`). So a COMPLETED tournament's sheet could still be
 * rewritten and re-published, and a re-publish told players of a new time on a
 * tournament whose results are final. Every writer now asks `teeSheetChangeAllowed`.
 *
 * THE ROW (before the draw · after the draw · after scores in the round · completed):
 *
 *   open · open · open · REFUSE
 *
 *   - BEFORE AND AFTER THE DRAW: open. A sheet nobody has been sent is a draft.
 *   - A PUBLISHED SHEET: the change is made and SAID (`warn`): players were
 *     already sent their time, and how many players' times changed (a push reaches only those with notifications on). It
 *     is a warning, not a refusal: a no-show at 9:00 is the everyday case.
 *   - AFTER SCORES IN THIS ROUND: open, and the GROUPS decide. A round with scores
 *     does not shut its whole sheet: a no-show at 9:00 while 7:30 is out playing
 *     is the league day this was built for. A group that has teed off or holds a
 *     card is held by `slotLocks` (tee-sheet-moves.ts, the club's clock), which
 *     the moves and the replace already ask; a whole re-draw keeps every such
 *     group as it was (`startedGroupsRefusal`). Later rounds are their own rounds
 *     and are asked on their own facts.
 *   - COMPLETED: refused, every change. Results are final (Rule 20.2e); Reopen on
 *     the dashboard is the deliberate way out.
 *
 * THE STEP is the ROUND's, derived from its facts (`teeSheetStepOf`) and never
 * handed in beside them. No committee correction is ever named: the only refusal
 * is completion, and Reopen is its way out.
 *
 * Pure: no prisma, no clock. The server's door is `services/tee-sheet-change.ts`;
 * the Teams screen draws its controls from `teeSheetDoors`.
 */
import { isFinished } from "./lifecycle-state";
import { teeTimeNotices } from "./tee-time-notice";
import type { SlotLocks } from "./tee-sheet-moves";
import type { TeeSheet } from "./tee-sheet";
import type { RoundFacts, TournamentFacts, WayOut } from "./tournament-status";

/** What each of the tee sheet's writers does, as the rule is asked it. */
export const TEE_SHEET_CHANGES = ["save", "publish", "unpublish", "place", "move", "replace"] as const;
export type TeeSheetChange = (typeof TEE_SHEET_CHANGES)[number];

/** The ask. A save says whether it publishes, REQUIRED: a save that publishes tells players, one that does not hides the sheet. */
export type TeeSheetChangeAsk = { kind: "save"; publish: boolean } | { kind: Exclude<TeeSheetChange, "save"> };

/** The column a round's sheet stands in (the header). */
export const TEE_SHEET_STEPS = ["before-draw", "after-draw", "after-scores", "completed"] as const;
export type TeeSheetStep = (typeof TEE_SHEET_STEPS)[number];

/** What a taken change leaves to say: players already told, or the sheet hidden from them. */
export type TeeSheetWarn = "told" | "hidden";

/** The slice of a round this rule reads (`RoundFacts`), so the round judged is the state machine's own. */
export type TeeSheetRound = Pick<RoundFacts, "id" | "label" | "hasResult" | "teeSheetSaved" | "teeSheetPublished">;

export interface TeeSheetChangeFacts {
  /** Stored status: draft | registration | ready | live | completed. */
  status: string;
  round: TeeSheetRound;
}

export type TeeSheetVerdict =
  | { ok: true; scope: "teeSheet"; step: TeeSheetStep; warn: TeeSheetWarn | null; groupsDecide: boolean }
  | { ok: false; scope: "teeSheet"; step: TeeSheetStep; says: string; wayOut: WayOut };

const REOPEN: WayOut = { says: "Reopen it on the dashboard", href: "/dashboard" };

/** A completed tournament's tee sheet, refused. */
export const COMPLETED_TEE_SHEET = "The tournament is completed, so its tee sheets are final. An Organizer can reopen it on the dashboard.";

/** The round's facts out of the tournament's — the state machine's reading, never a second one. */
export function teeSheetChangeFactsOf(f: Pick<TournamentFacts, "status" | "rounds">, roundId: string): TeeSheetChangeFacts | null {
  const round = f.rounds.find((r) => r.id === roundId);
  return round ? { status: f.status, round } : null;
}

/** The column, from the facts alone (header). */
export function teeSheetStepOf(f: TeeSheetChangeFacts): TeeSheetStep {
  if (isFinished(f.status)) return "completed";
  if (f.round.hasResult) return "after-scores";
  if (f.round.teeSheetSaved === true) return "after-draw";
  return "before-draw";
}

/** What a change to a PUBLISHED sheet leaves to say (null for an unpublished sheet, and for publishing what is already out). */
function warnFor(ask: TeeSheetChangeAsk, published: boolean): TeeSheetWarn | null {
  if (!published) return null;
  switch (ask.kind) {
    case "save":
      return ask.publish ? "told" : "hidden";
    case "unpublish":
      return "hidden";
    case "publish":
      return null;
    case "place":
    case "move":
    case "replace":
      return "told";
  }
}

/**
 * MAY THIS CHANGE BE MADE TO THE ROUND'S SHEET NOW — the one rule. The step
 * from the facts, the warning from the sheet's published state; the table in
 * the header. `groupsDecide` is set where the per-group locks still hold a
 * change back (a round with scores).
 */
export function teeSheetChangeAllowed(facts: TeeSheetChangeFacts, ask: TeeSheetChangeAsk): TeeSheetVerdict {
  const step = teeSheetStepOf(facts);
  if (step === "completed") return { ok: false, scope: "teeSheet", step, says: COMPLETED_TEE_SHEET, wayOut: REOPEN };
  return { ok: true, scope: "teeSheet", step, warn: warnFor(ask, facts.round.teeSheetPublished), groupsDecide: step === "after-scores" && ask.kind !== "publish" && ask.kind !== "unpublish" };
}

/** How many players a change to a published sheet tells — the notice's own diff (`teeTimeNotices`), so the count is the push. */
export function toldCount(previous: TeeSheet | null, next: TeeSheet): number {
  return teeTimeNotices(previous, next, false).length;
}

/**
 * The warning, said after a change to a published sheet: players were sent their time; how many players' times
 * changed. It never says how many were TOLD — a push reaches only a player with an email and notifications on, and
 * a demo club's reaches nobody (`push.ts`) — so the count is of times changed, and the alert is said as a may.
 */
export function teeSheetWarnWords(warn: TeeSheetWarn, told: number): string {
  if (warn === "hidden") return "Players were already sent their times. The sheet is now hidden from them.";
  if (told === 0) return "Players were already sent their times. Nobody’s time or start hole moved.";
  return `Players were already sent their times. ${told} ${told === 1 ? "player’s time" : "players’ times"} changed. Those with notifications on get an alert; everyone sees it in TourneyHQ.`;
}

/**
 * A WHOLE RE-DRAW OF A ROUND WITH SCORES keeps every group that has started
 * (`slotLocks`: teed off, or a card in) exactly as it was — the same players,
 * the same time, the same hole — somewhere in the new sheet. The first group
 * that was not kept is the sentence, or null.
 */
export function startedGroupsRefusal(previous: TeeSheet, next: TeeSheet, locks: SlotLocks): string | null {
  const key = (g: TeeSheet["groups"][number]) => `${[...g.playerIds].sort().join("|")}@${g.time}#${g.startHole}`;
  const kept = new Set(next.groups.map(key));
  for (const [index, why] of Object.entries(locks)) {
    const group = previous.groups[Number(index)];
    if (group && !kept.has(key(group))) return `${why} Its players, time and hole stay as they are. Change the groups that have not started.`;
  }
  return null;
}

/** EVERY CHANGE'S REFUSAL AS A SENTENCE for one round, or null where open — what the screen draws its controls from. */
export type TeeSheetDoors = Record<TeeSheetChange, string | null>;

export function teeSheetDoors(facts: TeeSheetChangeFacts): TeeSheetDoors {
  const door = (ask: TeeSheetChangeAsk) => {
    const v = teeSheetChangeAllowed(facts, ask);
    return v.ok ? null : v.says;
  };
  return {
    save: door({ kind: "save", publish: false }),
    publish: door({ kind: "publish" }),
    unpublish: door({ kind: "unpublish" }),
    place: door({ kind: "place" }),
    move: door({ kind: "move" }),
    replace: door({ kind: "replace" }),
  };
}

/** The line Recent changes shows for a change to a published sheet: by count, so no name is stored. */
export function teeSheetChangedLine(roundLabel: string, told: number): string {
  const r = roundLabel ? `${roundLabel} tee sheet` : "The tee sheet";
  return `${r} changed after it was published: ${told} ${told === 1 ? "player’s time" : "players’ times"} changed.`;
}
