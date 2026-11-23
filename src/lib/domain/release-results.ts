import type { NextAction, Step } from "./tournament-status";

/**
 * RESULTS HAS ONE VERB FOR RELEASING (R12). The tournament's last act is the machine's `complete` move, which closes every
 * round and makes the final report final; people called it Complete, Publish and Finish on different screens. On the
 * redesigned Results it is said ONE way, from here, and the press itself is still the machine's own (`nextAction`, asked
 * first about a round nobody played): this module chooses WORDS and a destination, never an action.
 *
 * THE VERB IS THE DESIGN'S ("Release results", phase 2 R12) and is waiting for the UX Writer to confirm it or name another:
 * it is one constant, so changing it changes this screen and its guide line together and nothing else.
 *
 * NO DIRECTIVE: the page (server) and a test both read it.
 */
export const RELEASE_VERB = "Release results";

export type ReleaseView =
  /** Every round is closed and the tournament may be completed: the one verb, pointing at the machine's press. */
  | { kind: "ready"; says: string; verb: typeof RELEASE_VERB; href: string; asks: string | null }
  /** Refused in place, with the reason the machine gave. */
  | { kind: "blocked"; says: string }
  /** The results are out. Reopening to correct a card is the way back. */
  | { kind: "released"; says: string; reopen: { label: string; href: string } | null }
  /** Not yet: there is still golf to close. No verb is offered. */
  | { kind: "later"; says: string };

export function releaseView(step: Step, next: Pick<NextAction, "kind" | "href" | "enabled" | "disabledBecause" | "asks"> | null): ReleaseView {
  if (step === "completed") {
    const reopen = next && next.kind === "reopen" && next.enabled ? { label: "Reopen to correct a card", href: next.href } : null;
    return {
      kind: "released",
      says: "The results are released: the final report is the record, shown to whoever the report settings allow.",
      reopen,
    };
  }
  if (step === "play-over" && next && next.kind === "complete") {
    if (!next.enabled) {
      return { kind: "blocked", says: next.disabledBecause ?? "The results cannot be released yet." };
    }
    return {
      kind: "ready",
      says: `Every round is closed. ${RELEASE_VERB} completes the tournament and makes the final report final.`,
      verb: RELEASE_VERB,
      href: next.href,
      asks: next.asks,
    };
  }
  return { kind: "later", says: `${RELEASE_VERB} is offered here once the last round is closed.` };
}
