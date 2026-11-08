/**
 * THE STEP ALONE — what a screen that only NAMES where a tournament is reads
 * from the machine (state machine PR 6; proposal 3 Nov, readers #3, #8, #19).
 *
 * Three screens say where a tournament is and do nothing about it: the
 * Tournaments list's status word, the player switcher's note ("Playing now",
 * "Play complete") and the public event page's phase (before, during, after).
 * Each decided it for itself — the stored status through `STATUS_META`,
 * `datesPassedUnlaunched`, `eventStatus === "live"` with `playOverOf`, and
 * `tournamentPhase` over a count of three tables of its own — and so a knockout
 * whose Final was decided was "Live" on every one of them (D3), and a draft
 * being played was "not started" on two (D2, D5).
 *
 * Now they read `tournamentStatus(facts)`, narrowed to the step by `stepOf`,
 * so none of them can hold a second answer. Pure.
 */
import { DATES_PASSED_UNLAUNCHED, STEP_TAG, type Step, type TournamentStatus } from "./tournament-status";

export interface TournamentStep {
  step: Step;
  /** "Setting up", "Setting up · results in", "Live", "Live · Suspended", "Play over", "Completed". */
  chip: string;
  /** The chip's tone — `STEP_TAG[step]`. */
  tag: string;
  /** Under "Play over": what ended play, and that results are not released. "" otherwise. */
  chipDetail: string;
  /** Setup, launch, play or results — the journey the public event page leads with. */
  journey: TournamentStatus["journey"];
  /** Results are in on a tournament never launched. */
  underWayUnlaunched: boolean;
  /** Its last day has gone by and it was never launched — the machine's own warning. */
  datesPassed: boolean;
}

export function stepOf(st: TournamentStatus): TournamentStep {
  return {
    step: st.step,
    chip: st.chip,
    tag: STEP_TAG[st.step],
    chipDetail: st.chipDetail,
    journey: st.journey,
    underWayUnlaunched: st.underWayUnlaunched,
    datesPassed: st.warnings.some((w) => w.says === DATES_PASSED_UNLAUNCHED),
  };
}

/**
 * THE TOURNAMENTS LIST'S STATUS WORD. The machine's chip, in its tone — except
 * a tournament whose dates went by unlaunched, which the list says in words:
 * "Setting up" a month after its last day is what nobody is doing (Ajay's
 * matchplay, 30 Jul to 26 Sep, read "Draft" in October).
 */
export const DATES_PASSED_WORD = { label: "Dates passed, not launched", tag: "tag-outline" } as const;

export function listWordOf(s: TournamentStep): { label: string; tag: string } {
  return s.datesPassed ? { ...DATES_PASSED_WORD } : { label: s.chip, tag: s.tag };
}
