/**
 * THE EVENT PAGE: ONE LINK FOR BEFORE, DURING AND AFTER (2026-10-24).
 *
 * `/live/<token>/event` is what a secretary sends once — in the newsletter, on
 * the noticeboard, in the group chat — and it is right on every day of the
 * tournament's life because it changes what it leads with:
 *
 *   before   the entry link and its QR poster, while entries are open; the board
 *   during   the live board and the clubhouse screen; late entries if still open
 *   after    the final report's summary and its link; the board
 *
 * It joins what already exists and adds nothing a spectator could not already
 * reach: the entry form is `/register/<token>`, the board `/live/<token>`, the
 * report `/live/<token>/report`, the sponsors the contests' own. And it sits
 * behind the board's credential and the board's visibility rule, so a board
 * held from players (or kept to them) has no event page either.
 *
 * Pure: which phase, and which sections in which order.
 */

import { isFinished, tournamentPhase } from "./lifecycle-state";

export type EventPhase = "before" | "during" | "after";

/**
 * Where the tournament is, through the app's one reader of it
 * (`tournamentPhase`): finished when the committee has completed it, under way
 * once it is launched or a result is in, and before that, before.
 */
export function eventPhase(status: string, scored: boolean): EventPhase {
  const phase = tournamentPhase({ status, scored, setupComplete: false });
  return phase === "results" ? "after" : phase === "play" ? "during" : "before";
}

export type EventSection = "report" | "entries" | "board" | "clubhouse";

/**
 * The sections, in the order the page shows them.
 *
 * The report leads whenever there is one to read. Entries lead before the day
 * and follow the board during it (late entries); a finished tournament takes
 * none. The board is always there — the link that has been in the group chat
 * since the draw should still go somewhere. The clubhouse screen is for the
 * day itself.
 */
export function eventSections(input: { phase: EventPhase; entriesOpen: boolean; reportReady: boolean }): EventSection[] {
  const out: EventSection[] = [];
  if (input.reportReady) out.push("report");
  const entries = input.entriesOpen && input.phase !== "after";
  if (input.phase === "before") {
    if (entries) out.push("entries");
    out.push("board");
  } else if (input.phase === "during") {
    out.push("board", "clubhouse");
    if (entries) out.push("entries");
  } else {
    out.push("board");
  }
  return out;
}

/**
 * WHETHER A FINISHED TOURNAMENT'S REPORT IS THERE TO LINK — the board's rule
 * for its "Read the final report" button: a cup once its result is decided
 * (`cupVerdict` is the cup's verdict kind, null for a tournament that is not a
 * cup); any other tournament once it is complete; a casual round never.
 */
export function finalReportReady(input: { status: string; casual: boolean; cupVerdict: string | null }): boolean {
  if (input.cupVerdict !== null) return input.cupVerdict !== "open";
  return isFinished(input.status) && !input.casual;
}

/** The addresses the page joins, all under the board's own token. */
export function eventLinks(shareToken: string): { event: string; board: string; clubhouse: string; report: string } {
  const board = `/live/${shareToken}`;
  return { event: `${board}/event`, board, clubhouse: `${board}?screen=clubhouse`, report: `${board}/report` };
}
