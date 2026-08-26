import { ghinAuthority, ghinReporter } from "./ghin";
import type { HandicapAuthority, ScoreReporter } from "./types";

/**
 * Which associations this app can talk to, and how a club picks one.
 *
 * A registry rather than an `if (provider === "ghin")` somewhere, because the
 * second association is not hypothetical: a club in England answers to England
 * Golf under CONGU and one in Australia to Golf Australia, and this app
 * already records what country a club is in. The cost of the registry now is
 * about twenty lines; the cost of not having it is every handicap read in the
 * codebase growing a second branch later.
 *
 * Reading an index and posting a score are registered SEPARATELY even though
 * GHIN appears in both. A club is routinely entitled to look a golfer up and
 * not to write to their record — posting to somebody's official handicap is a
 * larger permission than reading it — and a single list would force a club to
 * take both or neither.
 */

const AUTHORITIES: HandicapAuthority[] = [ghinAuthority];
const REPORTERS: ScoreReporter[] = [ghinReporter];

export function handicapAuthorities(): HandicapAuthority[] {
  return [...AUTHORITIES];
}

export function scoreReporters(): ScoreReporter[] {
  return [...REPORTERS];
}

/**
 * The authority a club has chosen, or null.
 *
 * Null for an unknown id ON PURPOSE, rather than falling back to the first one
 * registered. A club whose stored provider no longer exists has a settings
 * problem, and quietly reading indexes from a DIFFERENT association than the
 * one they configured is a worse outcome than reading none: the figures would
 * arrive, look entirely plausible, and belong to somebody else's system.
 */
export function handicapAuthority(id: string): HandicapAuthority | null {
  return AUTHORITIES.find((a) => a.id === id.trim().toLowerCase()) ?? null;
}

export function scoreReporter(id: string): ScoreReporter | null {
  return REPORTERS.find((r) => r.id === id.trim().toLowerCase()) ?? null;
}
