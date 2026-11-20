import "server-only";
import { clubToday } from "../domain/club-clock";
import { teeSheetChangeAllowed, teeSheetChangeFactsOf, teeSheetChangedLine, teeSheetDoors, teeSheetWarnWords, toldCount, type TeeSheetChangeAsk, type TeeSheetDoors, type TeeSheetVerdict } from "../domain/tee-sheet-change";
import type { TeeSheet } from "../domain/tee-sheet";
import { logAudit } from "./action-shared";
import { zoneOfEvent } from "./club-clock";
import { tournamentFactsFor } from "./tournament-facts";

/**
 * THE SERVER'S DOOR TO THE ONE TEE-SHEET RULE (`domain/tee-sheet-change.ts`,
 * J12, state machine PR 7c).
 *
 * Every action that writes a tee sheet — `saveTeeSheet`, `setTeeSheetPublished`,
 * `placeInTeeGroup`, `moveInTeeSheet`, `replaceInTeeSheet` — asks
 * `teeSheetVerdictFor` in place of the field rule, so a refusal has one
 * spelling and is RETURNED, never thrown (state machine J10). The facts are the
 * state machine's own, told the club's day, never the server's. The screen asks
 * the same function (`teeSheetDoorsFor`), so a control is never offered that the
 * action refuses.
 */
export async function teeSheetVerdictFor(eventId: string, stageId: string, ask: TeeSheetChangeAsk): Promise<TeeSheetVerdict | null> {
  const facts = await tournamentFactsFor(eventId, clubToday(await zoneOfEvent(eventId)));
  const one = facts ? teeSheetChangeFactsOf(facts, String(stageId)) : null;
  return one ? teeSheetChangeAllowed(one, ask) : null;
}

/** Every change's refusal for one round, for the screen that draws its controls before they are pressed. */
export async function teeSheetDoorsFor(eventId: string, stageId: string): Promise<TeeSheetDoors | null> {
  const facts = await tournamentFactsFor(eventId, clubToday(await zoneOfEvent(eventId)));
  const one = facts ? teeSheetChangeFactsOf(facts, String(stageId)) : null;
  return one ? teeSheetDoors(one) : null;
}

/**
 * AFTER A CHANGE TO A PUBLISHED SHEET HAS BEEN MADE: the warning to say, and the
 * Recent changes line (by count, so no name is stored). Null where the sheet was
 * not out, or the verdict has nothing to say.
 */
export async function afterTeeSheetChange(
  eventId: string,
  verdict: TeeSheetVerdict | null,
  round: { label: string },
  sheets: { previous: TeeSheet | null; next: TeeSheet | null },
): Promise<string | null> {
  if (!verdict || !verdict.ok || !verdict.warn) return null;
  const told = verdict.warn === "told" && sheets.next ? toldCount(sheets.previous, sheets.next) : 0;
  const detail = verdict.warn === "told" ? teeSheetChangedLine(round.label, told) : `${round.label ? `${round.label} tee` : "The tee"} sheet was hidden from players after publish.`;
  await logAudit(eventId, "tee-sheet.changed", detail);
  return teeSheetWarnWords(verdict.warn, told);
}
